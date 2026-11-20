/**
 * The assistant's hands: everything the user can CREATE, REMOVE or EDIT by hand
 * — an exercise, a routine and its rows, the loop's switch and cursor, a saved
 * workout and its sets, the workout in flight — said as one item of a
 * `changes_proposal`, checked against the stores, and described for the card.
 *
 *   model's items ──validateEdit──► EditChange ──describeEdit──► a card row
 *                                        └──(state/aiActions.ts)──► the SAME
 *                                           store actions the screens call
 *
 * ── WHY THE SETTINGS CARD, AND NOT A FOURTH KIND OF SUGGESTION ────────────
 *
 * "Delete my old Legs routine, rename Push to Push A and log 62.5 on Tuesday's
 * second bench set" is one request. Three cards for it would be three Applies
 * and three Undos for one thought, so every manual action is an item of the one
 * card `aiChanges.ts` already draws — `from → to`, one Apply, one Undo. A routine
 * proposal still exists for what it is good at (a whole plan, reviewed row by
 * row); these items are the discrete edits a screen makes one tap at a time.
 *
 * ── THE CONTRACT IS THE SAME AS EVERY OTHER SUGGESTION ────────────────────
 *
 * Nothing is written without a tap. Every id must be one CONTEXT named or one an
 * earlier item of the SAME card created (a handle such as `new_1`, mapped to the
 * real id at Apply); every number is held to the range its own control allows;
 * a set is pointed at by its place and resolved to its row id HERE, so two
 * deletions in one card cannot shift each other onto the wrong row. Anything
 * that fails is dropped and counted, and the card says how many.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
 *
 * Finishing, saving or discarding a workout, opening one, the rest and set
 * timers, export/import/reset, deleting all history, the backup folder and the
 * AI key. And dragging one SET above another inside a live card (`moveSet`):
 * the rows are numbered by place, so the model would be moving a row by a
 * number that the move itself changes — a request nobody makes in words.
 *
 * ── A WHOLE ORDER ─────────────────────────────────────────────────────────
 *
 * `reorder` on a routine, the loop or the workout in flight is one item holding
 * the whole new order — `aiOrder.ts`, which also says why the card draws it as
 * a list the user can still drag before Apply. Each is either a moment (a rest that ends before the reply arrives),
 * a choice the user must make looking at the screen (the Finish sheet), or a
 * whole-app operation that has its own confirmation for a reason.
 *
 * Pure, like everything in `lib/`: the stores are read by the caller.
 */

import { dayKey, parseDay } from '../days';
import { draftToExercise, emptyExerciseDraft, type ExerciseDraft } from '../exerciseDraft';
import { MUSCLE_GROUPS } from '../muscles';
import { ladderOf } from '../repLadder';
import {
  TARGET_COUNT_LIMITS,
  TARGET_SETS_LIMITS,
  bumpTargetCount,
  bumpTargetMin,
  bumpTargetSets,
} from '../routinePlan';
import { warmupToggleState } from '../warmup';
import { clampDurationMinutes } from '../workoutEdit';
import { t, type Language } from '../i18n';
import type { ChangeRow } from './aiChanges';
import {
  REORDER_FIELDS,
  orderTokens,
  orderedRows,
  resolveOrder,
  type OrderChange,
  type OrderList,
  type OrderRow,
} from './aiOrder';
import type {
  CountUnit,
  Exercise,
  ID,
  LoadMode,
  MuscleGroup,
  RoutineItem,
  TrainingSequence,
} from '../../types/models';

/* ------------------------------------------------------------------ */
/* Reading an item                                                     */
/* ------------------------------------------------------------------ */

export type Rec = Record<string, unknown>;

export function num(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed === '' ? null : trimmed.slice(0, max);
}

/** "Rest Seconds", "rest-seconds" → `rest_seconds`. */
export function key(value: unknown): string {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
    : '';
}

function idOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A whole number ≥ 1 — a place in a list, as the user counts it. */
function place(value: unknown): number | null {
  const n = num(value);
  return n != null && Number.isInteger(n) && n >= 1 ? n : null;
}

/** Kilograms on the 0.25 grid the steppers can reach, 0–500. */
function kg(value: number): number {
  return Math.round(clamp(value, 0, 500) * 4) / 4;
}

/* ------------------------------------------------------------------ */
/* What kind of exercise                                                */
/* ------------------------------------------------------------------ */

/**
 * The editor's two controls — `Requires weight` with its three loads, and
 * `Counted in` without it — folded into one word a model can say.
 */
export type ExerciseKind =
  'weighted' | 'bodyweight_plus' | 'assisted' | 'reps' | 'seconds' | 'meters' | 'rounds';

const KIND_ALIASES: Record<string, ExerciseKind> = {
  weighted: 'weighted',
  external: 'weighted',
  plates: 'weighted',
  barbell: 'weighted',
  dumbbell: 'weighted',
  machine: 'weighted',
  bodyweight_plus: 'bodyweight_plus',
  added_bodyweight: 'bodyweight_plus',
  weighted_bodyweight: 'bodyweight_plus',
  assisted: 'assisted',
  reps: 'reps',
  bodyweight: 'reps',
  none: 'reps',
  seconds: 'seconds',
  time: 'seconds',
  timed: 'seconds',
  meters: 'meters',
  metres: 'meters',
  distance: 'meters',
  rounds: 'rounds',
};

export function parseKind(value: unknown): ExerciseKind | null {
  return KIND_ALIASES[key(value)] ?? null;
}

const KIND_LOAD: Partial<Record<ExerciseKind, LoadMode>> = {
  weighted: 'external',
  bodyweight_plus: 'added_bodyweight',
  assisted: 'assisted',
};

/** What an exercise is now, in the same words. */
export function kindOf(exercise: Pick<Exercise, 'requiresWeight' | 'loadMode' | 'countUnit'>) {
  if (exercise.requiresWeight) {
    if (exercise.loadMode === 'added_bodyweight') return 'bodyweight_plus';
    if (exercise.loadMode === 'assisted') return 'assisted';
    return 'weighted';
  }
  return exercise.countUnit as ExerciseKind;
}

/**
 * The draft with its kind changed, by the same rules the editor's toggles keep
 * (`CreateExerciseScreen`): weighted work is rep-counted with a manual timer,
 * unweighted work has load `none`, and only time can keep a timer.
 */
export function draftWithKind(draft: ExerciseDraft, kind: ExerciseKind): ExerciseDraft {
  const load = KIND_LOAD[kind];
  if (load) {
    return {
      ...draft,
      requiresWeight: true,
      countUnit: 'reps',
      loadMode: load,
      timerMode: 'manual',
    };
  }
  const countUnit = kind as CountUnit;
  return {
    ...draft,
    requiresWeight: false,
    loadMode: 'none',
    countUnit,
    timerMode: countUnit === 'seconds' || countUnit === 'rounds' ? draft.timerMode : 'manual',
  };
}

export function kindLabel(kind: ExerciseKind, lang: Language): string {
  const words: Record<ExerciseKind, string> = {
    weighted: 'Plates or machine',
    bodyweight_plus: 'Bodyweight + extra',
    assisted: 'Assisted',
    reps: 'Bodyweight reps',
    seconds: 'Time',
    meters: 'Metres',
    rounds: 'Rounds',
  };
  return t(words[kind], lang);
}

/** Muscle groups from `"chest, triceps"` or a list — the app's own names only. */
export function parseMuscles(value: unknown): MuscleGroup[] {
  const words = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,;/]+/)
      : [];
  const out: MuscleGroup[] = [];
  for (const word of words) {
    const k = key(word);
    const muscle = MUSCLE_GROUPS.find((m) => m === k || `${m}s` === k || m === `${k}s`);
    if (muscle && !out.includes(muscle)) out.push(muscle);
  }
  return out.slice(0, 4);
}

/**
 * A brand-new library row, the way `New exercise` → `Create` builds one:
 * `emptyExerciseDraft` (which also honours `Make every exercise a rep ladder`),
 * the kind applied, then `draftToExercise`.
 */
export function newExercise(params: {
  id: ID;
  ownerId: ID;
  name: string;
  muscle?: MuscleGroup;
  kind: ExerciseKind;
  restSeconds: number;
  ladderAll: boolean;
  now?: Date;
}): Exercise {
  const base = emptyExerciseDraft(params.name, params.muscle, params.restSeconds, params.ladderAll);
  return draftToExercise(draftWithKind(base, params.kind), params.id, params.ownerId, params.now);
}

/* ------------------------------------------------------------------ */
/* The edits                                                           */
/* ------------------------------------------------------------------ */

export type RoutineField = 'create' | 'rename' | 'duplicate' | 'delete';
export type RoutineItemField = 'add' | 'remove' | 'sets' | 'reps' | 'reps_min' | 'move';
export type SequenceField = 'on' | 'next' | 'vary';
export type WorkoutField =
  | 'rename'
  | 'date'
  | 'start_time'
  | 'duration'
  | 'number'
  | 'delete'
  | 'add_exercise'
  | 'remove_exercise';
export type PastSetField = 'weight' | 'reps' | 'delete' | 'add';
export type LiveField = 'add_exercise' | 'remove_exercise' | 'add_set' | 'move_exercise' | 'warmup';
export type LiveSetField = 'weight' | 'reps' | 'log' | 'unlog' | 'remove';

/**
 * One edit, already checked. `was` is the value it replaces, read when the reply
 * was filed — the card's `from`, which the stores no longer hold after Apply.
 * Names are carried for the same reason: a deleted routine has no name to look up.
 */
export type EditChange =
  | {
      target: 'exercise_create';
      field: 'create';
      /** The handle later items of the card use for it; a real id at Apply. */
      ref: ID;
      name: string;
      muscle?: MuscleGroup;
      kind: ExerciseKind;
      value?: undefined;
    }
  | { target: 'exercise_delete'; field: 'delete'; id: ID; name: string; value?: undefined }
  | {
      target: 'routine';
      field: RoutineField;
      /** The routine, or for `create` the handle. */
      id: ID;
      /** Its name now — for `create`, the name it gets. */
      name: string;
      /** `rename`: the new name. `duplicate`: the copy's name, if one was asked for. */
      value?: string;
    }
  | {
      target: 'routine_item';
      field: RoutineItemField;
      id: ID;
      exerciseId: ID;
      routineName: string;
      exerciseName: string;
      was?: number | null;
      /** sets/reps/reps_min: the number (`null` clears a range); add/move: 0-based place. */
      value?: number | null;
    }
  | {
      target: 'sequence';
      field: SequenceField;
      /** `on`: the switch. `next`/`vary`: the 0-based step. */
      value: number | boolean;
      /** The routine at that step, or the one up next now. */
      routineName?: string;
      wasName?: string;
      wasOn?: boolean;
    }
  | {
      target: 'workout';
      field: WorkoutField;
      id: ID;
      day: string;
      title: string;
      /** rename: text; date: `YYYY-MM-DD`; start_time: `HH:MM`; duration/number: a number. */
      value?: string | number;
      was?: string | number;
      exerciseId?: ID;
      exerciseName?: string;
    }
  | {
      target: 'workout_set';
      field: PastSetField;
      id: ID;
      exerciseId: ID;
      exerciseName: string;
      day: string;
      /** The row, resolved from its place when the reply was filed. Absent for `add`. */
      setId?: ID;
      position?: number;
      was?: number | null;
      value?: number;
    }
  | {
      target: 'live';
      field: LiveField;
      exerciseId: ID;
      exerciseName: string;
      /** The card in the session; absent for `add_exercise`. */
      entryId?: ID;
      was?: number;
      /** move_exercise: the 0-based place. */
      value?: number;
      /** warmup: true adds the first-set warm-up, false takes it off. */
      on?: boolean;
    }
  | {
      target: 'live_set';
      field: LiveSetField;
      entryId: ID;
      setId: ID;
      exerciseId: ID;
      exerciseName: string;
      position: number;
      was?: number | null;
      value?: number;
    }
  /** A whole new order for a routine, the loop or the workout in flight — `aiOrder.ts`. */
  | OrderChange;

/** A change that takes something away — drawn in red, so a delete is never a surprise. */
export function isDestructive(change: { target: string; field: string; on?: boolean }): boolean {
  switch (change.target) {
    case 'exercise_delete':
      return true;
    case 'routine':
    case 'workout':
      return change.field === 'delete' || change.field === 'remove_exercise';
    case 'routine_item':
      return change.field === 'remove';
    case 'workout_set':
      return change.field === 'delete';
    case 'live':
      // Taking the warm-up off removes a row, as a `−` in edit mode would.
      return (
        change.field === 'remove_exercise' || (change.field === 'warmup' && change.on === false)
      );
    case 'live_set':
      return change.field === 'remove';
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ */
/* What the validator is told                                          */
/* ------------------------------------------------------------------ */

export interface EditRoutine {
  id: ID;
  name: string;
  items: readonly RoutineItem[];
}

export interface EditWorkout {
  id: ID;
  startedAt: string;
  title?: string;
  durationMinutes?: number;
  unnumbered?: boolean;
  sets: readonly {
    id: ID;
    exerciseId: ID;
    setIndex: number;
    isWarmup: boolean;
    weightKg?: number | null;
    count?: number;
    countUnit?: CountUnit;
  }[];
  exercises?: readonly { exerciseId: ID; name: string }[];
}

export interface EditSession {
  entries: readonly {
    localId: ID;
    exercise: Pick<Exercise, 'id' | 'name' | 'requiresWeight' | 'countUnit'>;
    sets: readonly {
      localId: ID;
      weightKg: number | null;
      count: number;
      isWarmup: boolean;
      isCompleted: boolean;
    }[];
  }[];
}

/** The stores as the validator sees them, with what earlier items of the card created. */
export interface EditEnv {
  exercises: ReadonlyMap<ID, Exercise>;
  routines: ReadonlyMap<ID, EditRoutine>;
  workouts: readonly EditWorkout[];
  sequence?: TrainingSequence;
  session?: EditSession | null;
  /** `YYYY-MM-DD`, for "a workout cannot move into the future". */
  today?: string;
  /** `routineId:exerciseId` pairs an earlier `add` in this card put in place. */
  added: Set<string>;
}

/* ------------------------------------------------------------------ */
/* Validating                                                          */
/* ------------------------------------------------------------------ */

/** A handle for something this card creates: not empty, not an id already taken. */
function freshHandle(value: unknown, taken: (id: string) => boolean): string | null {
  const id = idOf(value);
  return id !== '' && id.length <= 40 && !taken(id) ? id : null;
}

export function validateExerciseCreate(
  item: Rec,
  env: Pick<EditEnv, 'exercises'>,
): Extract<EditChange, { target: 'exercise_create' }> | null {
  const ref = freshHandle(item.id, (id) => env.exercises.has(id));
  const name = str(item.name ?? item.text, 40);
  if (!ref || !name) return null;
  const [muscle] = parseMuscles(item.muscle ?? item.muscles);
  const kind = parseKind(item.kind) ?? 'weighted';
  return {
    target: 'exercise_create',
    field: 'create',
    ref,
    name,
    kind,
    ...(muscle ? { muscle } : {}),
  };
}

export function validateRoutineCreate(
  item: Rec,
  env: Pick<EditEnv, 'routines'>,
): Extract<EditChange, { target: 'routine' }> | null {
  const ref = freshHandle(item.id, (id) => env.routines.has(id));
  const name = str(item.name ?? item.text, 40);
  return ref && name ? { target: 'routine', field: 'create', id: ref, name } : null;
}

/**
 * A `reorder` item for one list, or null. A list of one has no order to change —
 * every screen hides its drag handle then too.
 */
function reorder(
  item: Rec,
  list: OrderList,
  rows: OrderRow[],
  routine?: { id: ID; name: string },
): OrderChange | null {
  if (rows.length < 2) return null;
  const order = resolveOrder(rows, orderTokens(item));
  if (!order) return null;
  return {
    target: 'order',
    field: 'reorder',
    list,
    id: routine?.id ?? '',
    name: routine?.name ?? '',
    rows,
    order,
  };
}

function validateRoutine(item: Rec, env: EditEnv): EditChange | null {
  const field = key(item.field) as RoutineField;
  const routine = env.routines.get(idOf(item.id));
  if (!routine) return null;
  if (REORDER_FIELDS.has(field)) {
    const rows = [...routine.items]
      .sort((a, b) => a.order - b.order)
      .map((i) => ({
        key: i.id,
        ref: i.exerciseId,
        name: env.exercises.get(i.exerciseId)?.name ?? '',
      }));
    return reorder(item, 'routine', rows, routine);
  }
  const base = { target: 'routine' as const, id: routine.id, name: routine.name };
  if (field === 'rename') {
    const value = str(item.text ?? item.name, 40);
    return value && value !== routine.name ? { ...base, field, value } : null;
  }
  if (field === 'duplicate') {
    const value = str(item.text ?? item.name, 40);
    return { ...base, field, ...(value ? { value } : {}) };
  }
  if (field === 'delete') return { ...base, field };
  return null;
}

const ITEM_ALIASES: Record<string, RoutineItemField> = {
  add: 'add',
  add_exercise: 'add',
  remove: 'remove',
  remove_exercise: 'remove',
  delete: 'remove',
  sets: 'sets',
  reps: 'reps',
  reps_max: 'reps',
  target: 'reps',
  reps_min: 'reps_min',
  range_min: 'reps_min',
  move: 'move',
  position: 'move',
};

function validateRoutineItem(item: Rec, env: EditEnv): EditChange | null {
  const field = ITEM_ALIASES[key(item.field)];
  const routine = env.routines.get(idOf(item.id));
  const exercise = env.exercises.get(idOf(item.exerciseId));
  if (!field || !routine || !exercise) return null;
  const pair = `${routine.id}:${exercise.id}`;
  const row = routine.items.find((i) => i.exerciseId === exercise.id);
  const base = {
    target: 'routine_item' as const,
    id: routine.id,
    exerciseId: exercise.id,
    routineName: routine.name,
    exerciseName: exercise.name,
  };
  if (field === 'add') {
    const at = place(item.number);
    env.added.add(pair);
    return { ...base, field, value: at == null ? null : at - 1 };
  }
  // Everything else needs the row to be there — now, or added earlier on this card.
  if (!row && !env.added.has(pair)) return null;
  const n = num(item.number);
  switch (field) {
    case 'remove':
      env.added.delete(pair);
      return { ...base, field };
    case 'sets':
      if (n == null) return null;
      return {
        ...base,
        field,
        was: row?.targetSets ?? null,
        value: clamp(Math.round(n), TARGET_SETS_LIMITS.min, TARGET_SETS_LIMITS.max),
      };
    case 'reps':
    case 'reps_min': {
      // A ladder or MAX plans its own reps — the editor shows no reps control for it.
      if (ladderOf(exercise) || exercise.countToMax === true) return null;
      const { min, max } = TARGET_COUNT_LIMITS[exercise.countUnit];
      if (field === 'reps') {
        if (n == null) return null;
        return {
          ...base,
          field,
          was: row?.targetRepsMax ?? row?.targetRepsMin ?? null,
          value: clamp(Math.round(n), min, max),
        };
      }
      // 0, or `on:false`, turns the range off.
      const off = item.on === false || n === 0;
      if (!off && n == null) return null;
      return {
        ...base,
        field,
        was: row?.targetRepsMin ?? null,
        value: off ? null : clamp(Math.round(n as number), min, max),
      };
    }
    case 'move': {
      const at = place(item.number);
      if (at == null) return null;
      const now = row ? [...routine.items].sort((a, b) => a.order - b.order).indexOf(row) : -1;
      return { ...base, field, was: now >= 0 ? now : null, value: at - 1 };
    }
    default:
      return null;
  }
}

function validateSequence(item: Rec, env: EditEnv): EditChange | null {
  const field = key(item.field);
  const sequence = env.sequence;
  if (!sequence) return null;
  const nameAt = (index: number) => env.routines.get(sequence.routineIds[index] ?? '')?.name;
  const current = sequence.routineIds.length
    ? nameAt(
        ((sequence.cursor % sequence.routineIds.length) + sequence.routineIds.length) %
          sequence.routineIds.length,
      )
    : undefined;
  if (REORDER_FIELDS.has(field)) {
    // Keyed by position: the loop may hold one routine at several steps.
    const rows = sequence.routineIds.map((id, index) => ({
      key: String(index),
      ref: id,
      name: nameAt(index) ?? '',
    }));
    return reorder(item, 'sequence', rows);
  }
  if (field === 'on' || field === 'active' || field === 'use') {
    const on = typeof item.on === 'boolean' ? item.on : null;
    // A loop with no steps cannot be switched on — the screen's switch refuses too.
    if (on == null || (on && sequence.routineIds.length === 0)) return null;
    return { target: 'sequence', field: 'on', value: on, wasOn: sequence.isActive };
  }
  if (field === 'next' || field === 'vary') {
    const at = place(item.number);
    if (at == null || at > sequence.routineIds.length) return null;
    const index = at - 1;
    const id = sequence.routineIds[index];
    // A step that is the only one on its routine has nothing to be separated from.
    if (field === 'vary' && sequence.routineIds.filter((r) => r === id).length < 2) return null;
    return {
      target: 'sequence',
      field,
      value: index,
      routineName: nameAt(index),
      ...(field === 'next' && current ? { wasName: current } : {}),
    };
  }
  return null;
}

const WORKOUT_ALIASES: Record<string, WorkoutField> = {
  rename: 'rename',
  name: 'rename',
  title: 'rename',
  date: 'date',
  day: 'date',
  move: 'date',
  start_time: 'start_time',
  time: 'start_time',
  duration: 'duration',
  length: 'duration',
  minutes: 'duration',
  number: 'number',
  workout_number: 'number',
  delete: 'delete',
  add_exercise: 'add_exercise',
  remove_exercise: 'remove_exercise',
};

function timeText(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function workoutName(w: EditWorkout, exerciseId: ID): string | null {
  return w.exercises?.find((e) => e.exerciseId === exerciseId)?.name ?? null;
}

function validateWorkout(item: Rec, env: EditEnv): EditChange | null {
  const field = WORKOUT_ALIASES[key(item.field)];
  const workout = env.workouts.find((w) => w.id === idOf(item.id));
  if (!field || !workout) return null;
  const base = {
    target: 'workout' as const,
    id: workout.id,
    day: dayKey(workout.startedAt),
    title: workout.title ?? '',
  };
  switch (field) {
    case 'rename': {
      const value = str(item.text ?? item.name, 80);
      return value ? { ...base, field, value, was: workout.title ?? '' } : null;
    }
    case 'date': {
      const value = idOf(item.text);
      if (!parseDay(value) || value === base.day) return null;
      if (env.today && value > env.today) return null;
      return { ...base, field, value, was: base.day };
    }
    case 'start_time': {
      const match = /^(\d{1,2}):(\d{2})$/.exec(idOf(item.text));
      if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
      const value = `${match[1].padStart(2, '0')}:${match[2]}`;
      return { ...base, field, value, was: timeText(workout.startedAt) };
    }
    case 'duration': {
      const n = num(item.number);
      if (n == null) return null;
      return { ...base, field, value: clampDurationMinutes(n), was: workout.durationMinutes };
    }
    case 'number': {
      const n = place(item.number);
      return n != null && !workout.unnumbered ? { ...base, field, value: n } : null;
    }
    case 'delete':
      return { ...base, field };
    case 'add_exercise': {
      const exercise = env.exercises.get(idOf(item.exerciseId));
      if (!exercise || workout.sets.some((s) => s.exerciseId === exercise.id)) return null;
      return { ...base, field, exerciseId: exercise.id, exerciseName: exercise.name };
    }
    case 'remove_exercise': {
      const exerciseId = idOf(item.exerciseId);
      const present = workout.sets.some((s) => s.exerciseId === exerciseId);
      const others = workout.sets.some((s) => s.exerciseId !== exerciseId);
      // The last exercise is the workout — that is `delete`, which says so.
      if (!present || !others) return null;
      const name = workoutName(workout, exerciseId) ?? env.exercises.get(exerciseId)?.name ?? '';
      return { ...base, field, exerciseId, exerciseName: name };
    }
  }
}

const SET_ALIASES: Record<string, PastSetField> = {
  weight: 'weight',
  weight_kg: 'weight',
  kg: 'weight',
  reps: 'reps',
  count: 'reps',
  delete: 'delete',
  remove: 'delete',
  add: 'add',
  add_set: 'add',
};

/** Whether a `workout_set` item is one of these edits — else it is a set's kind (`aiChanges`). */
export function isPastSetEdit(field: unknown): boolean {
  return SET_ALIASES[key(field)] != null;
}

/**
 * A saved set's weight, count, removal — or one more row. The set is pointed at
 * by `set`: its place among that exercise's WORKING sets in the workout, the
 * order `sessions[].ex` lists them, as `aiChanges` reads a set's kind.
 */
export function validatePastSet(item: Rec, env: EditEnv): EditChange | null {
  const field = SET_ALIASES[key(item.field)];
  const workout = env.workouts.find((w) => w.id === idOf(item.id));
  const exerciseId = idOf(item.exerciseId);
  if (!field || !workout) return null;
  const rows = workout.sets
    .filter((s) => s.exerciseId === exerciseId)
    .sort((a, b) => a.setIndex - b.setIndex);
  if (rows.length === 0) return null;
  const base = {
    target: 'workout_set' as const,
    id: workout.id,
    exerciseId,
    exerciseName: workoutName(workout, exerciseId) ?? env.exercises.get(exerciseId)?.name ?? '',
    day: dayKey(workout.startedAt),
  };
  if (field === 'add') return { ...base, field };
  const position = place(item.set);
  const row = position == null ? undefined : rows.filter((s) => !s.isWarmup)[position - 1];
  if (!row || position == null) return null;
  const at = { ...base, setId: row.id, position };
  if (field === 'delete') return workout.sets.length > 1 ? { ...at, field } : null;
  const n = num(item.number);
  if (n == null) return null;
  if (field === 'weight') {
    // An unweighted set has no weight to correct — it has nowhere to show one.
    if (row.weightKg == null) return null;
    return { ...at, field, was: row.weightKg, value: kg(n) };
  }
  const unit = row.countUnit ?? 'reps';
  return {
    ...at,
    field,
    was: row.count ?? null,
    value: clamp(Math.round(n), 1, TARGET_COUNT_LIMITS[unit].max),
  };
}

const LIVE_ALIASES: Record<string, LiveField> = {
  add_exercise: 'add_exercise',
  add: 'add_exercise',
  remove_exercise: 'remove_exercise',
  remove: 'remove_exercise',
  add_set: 'add_set',
  move_exercise: 'move_exercise',
  move: 'move_exercise',
  warmup: 'warmup',
  warm_up: 'warmup',
  toggle_warmup: 'warmup',
};

function validateLive(item: Rec, env: EditEnv): EditChange | null {
  const session = env.session;
  if (session && REORDER_FIELDS.has(key(item.field))) {
    // Keyed by the card, not the exercise: one exercise can be in a session twice.
    const rows = session.entries.map((e) => ({
      key: e.localId,
      ref: e.exercise.id,
      name: e.exercise.name,
    }));
    return reorder(item, 'live', rows);
  }
  const field = LIVE_ALIASES[key(item.field)];
  if (!session || !field) return null;
  const exerciseId = idOf(item.exerciseId);
  if (field === 'add_exercise') {
    const exercise = env.exercises.get(exerciseId);
    return exercise ? { target: 'live', field, exerciseId, exerciseName: exercise.name } : null;
  }
  const index = session.entries.findIndex((e) => e.exercise.id === exerciseId);
  const entry = session.entries[index];
  if (!entry) return null;
  const base = {
    target: 'live' as const,
    exerciseId,
    exerciseName: entry.exercise.name,
    entryId: entry.localId,
  };
  if (field === 'move_exercise') {
    const at = place(item.number);
    if (at == null || at > session.entries.length) return null;
    return { ...base, field, was: index, value: at - 1 };
  }
  if (field === 'warmup') {
    /* The first-row toggle, and only where the toggle is offered
       (`warmupToggleState`): no warm-up added above a set already logged, none
       taken off once it is logged. `on` says which way; without it, whichever
       way the toggle would go — and an `on` it cannot honour is dropped rather
       than flipped the other way. */
    const state = warmupToggleState(entry.sets);
    if (state == null) return null;
    const on = typeof item.on === 'boolean' ? item.on : state === 'add';
    return (state === 'add') === on ? { ...base, field, on } : null;
  }
  return { ...base, field };
}

const LIVE_SET_ALIASES: Record<string, LiveSetField> = {
  weight: 'weight',
  weight_kg: 'weight',
  reps: 'reps',
  count: 'reps',
  log: 'log',
  done: 'log',
  complete: 'log',
  unlog: 'unlog',
  undo_log: 'unlog',
  uncomplete: 'unlog',
  not_done: 'unlog',
  remove: 'remove',
  delete: 'remove',
};

/** A row of the workout in flight, by its place among ALL its exercise's rows. */
function validateLiveSet(item: Rec, env: EditEnv): EditChange | null {
  const session = env.session;
  const field = LIVE_SET_ALIASES[key(item.field)];
  if (!session || !field) return null;
  const entry = session.entries.find((e) => e.exercise.id === idOf(item.exerciseId));
  const position = place(
    item.set ?? (field === 'log' || field === 'unlog' || field === 'remove' ? item.number : null),
  );
  const set = entry && position != null ? entry.sets[position - 1] : undefined;
  if (!entry || !set || position == null) return null;
  const base = {
    target: 'live_set' as const,
    entryId: entry.localId,
    setId: set.localId,
    exerciseId: entry.exercise.id,
    exerciseName: entry.exercise.name,
    position,
  };
  if (field === 'log') return set.isCompleted ? null : { ...base, field };
  // The ✓ tapped again: only a set that is logged has one to take back.
  if (field === 'unlog') return set.isCompleted ? { ...base, field } : null;
  if (field === 'remove') return { ...base, field };
  const n = num(item.number);
  if (n == null) return null;
  if (field === 'weight') {
    if (!entry.exercise.requiresWeight) return null;
    return { ...base, field, was: set.weightKg, value: kg(n) };
  }
  return {
    ...base,
    field,
    was: set.count,
    value: clamp(Math.round(n), 0, TARGET_COUNT_LIMITS[entry.exercise.countUnit].max),
  };
}

/**
 * One item of a target this file owns, or null. `exercise` create/delete are
 * routed here by `aiChanges.validateChanges`; creates are pre-registered by it
 * so a later item of the card can point at them.
 */
export function validateEdit(target: string, item: Rec, env: EditEnv): EditChange | null {
  switch (target) {
    case 'exercise_delete': {
      const exercise = env.exercises.get(idOf(item.id));
      return exercise && !exercise.isArchived
        ? { target: 'exercise_delete', field: 'delete', id: exercise.id, name: exercise.name }
        : null;
    }
    case 'routine':
      return validateRoutine(item, env);
    case 'routine_item':
      return validateRoutineItem(item, env);
    case 'sequence':
      return validateSequence(item, env);
    case 'workout':
      return validateWorkout(item, env);
    case 'workout_set':
      return validatePastSet(item, env);
    case 'live':
      return validateLive(item, env);
    case 'live_set':
      return validateLiveSet(item, env);
    default:
      return null;
  }
}

/**
 * The key two items of one card collide on — the later one is what the model
 * settled on. `seq` (the item's place) keeps apart the edits that are meant to
 * repeat: two `add_set`s are two sets, not one said twice.
 */
export function editIdentity(change: EditChange, seq: number): string {
  switch (change.target) {
    case 'exercise_create':
      return `exercise_create:${change.ref}`;
    case 'exercise_delete':
      return `exercise_delete:${change.id}`;
    case 'routine':
      return `routine:${change.id}:${change.field}`;
    case 'routine_item':
      return `routine_item:${change.id}:${change.exerciseId}:${change.field}`;
    case 'sequence':
      return `sequence:${change.field}`;
    case 'workout':
      return `workout:${change.id}:${change.field}:${change.exerciseId ?? ''}`;
    case 'workout_set':
      return `workout_set:${change.id}:${change.exerciseId}:${change.setId ?? `add${seq}`}:${change.field}`;
    case 'live':
      return `live:${change.exerciseId}:${change.field}:${change.field === 'add_set' || change.field === 'add_exercise' ? seq : ''}`;
    case 'live_set':
      return `live_set:${change.setId}:${change.field}`;
    case 'order':
      return `order:${change.list}:${change.id}`;
  }
}

/* ------------------------------------------------------------------ */
/* Applying a routine row                                               */
/* ------------------------------------------------------------------ */

function renumber(items: readonly RoutineItem[]): RoutineItem[] {
  return items.map((item, order) => ({ ...item, order }));
}

/** `items` with the row moved to `index` (clamped), every `order` rewritten. */
export function moveItem(items: readonly RoutineItem[], itemId: ID, index: number): RoutineItem[] {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  const from = sorted.findIndex((i) => i.id === itemId);
  if (from < 0) return renumber(sorted);
  const [row] = sorted.splice(from, 1);
  sorted.splice(clamp(index, 0, sorted.length), 0, row);
  return renumber(sorted);
}

/**
 * A routine's rows with one change made, through the editor's own steppers
 * (`lib/routinePlan.ts`) — so a range floor follows the target down exactly as
 * it does by hand. Null when the row is gone. `add` is the store's
 * (`appendToRoutine`); only its placing comes through here, as a `move`.
 */
export function patchRoutineItems(
  items: readonly RoutineItem[],
  change: Extract<EditChange, { target: 'routine_item' }>,
  countUnit: CountUnit,
): RoutineItem[] | null {
  const row = [...items]
    .sort((a, b) => a.order - b.order)
    .find((i) => i.exerciseId === change.exerciseId);
  if (!row) return null;
  const v = change.value;
  const replace = (next: RoutineItem) => items.map((i) => (i.id === row.id ? next : i));
  switch (change.field) {
    case 'remove':
      return renumber([...items].sort((a, b) => a.order - b.order).filter((i) => i.id !== row.id));
    case 'sets':
      return replace(bumpTargetSets(row, (v ?? row.targetSets) - row.targetSets));
    case 'reps': {
      const current = row.targetRepsMax ?? row.targetRepsMin ?? TARGET_COUNT_LIMITS[countUnit].min;
      return replace(bumpTargetCount(row, countUnit, (v ?? current) - current));
    }
    case 'reps_min': {
      if (v == null) {
        const { targetRepsMin: _off, ...rest } = row;
        return replace(rest);
      }
      const current = row.targetRepsMin ?? row.targetRepsMax ?? v;
      return replace(bumpTargetMin(row, countUnit, v - current));
    }
    case 'move':
    case 'add':
      return v == null ? [...items] : moveItem(items, row.id, v);
  }
}

/* ------------------------------------------------------------------ */
/* What the card says                                                   */
/* ------------------------------------------------------------------ */

function kgText(value: number | null | undefined, lang: Language): string {
  return value == null ? '' : `${value} ${t('kg', lang)}`;
}

/** One card row for an edit. `formatDay` prints `27 Oct`. */
export function describeEdit(
  change: EditChange,
  lang: Language,
  formatDay: (day: string) => string,
): ChangeRow {
  const tr = (k: string, vars?: Record<string, string | number>) => t(k, lang, vars);
  const destructive = isDestructive(change);
  const row = (subject: string, label: string, from: string, to: string): ChangeRow =>
    destructive ? { subject, label, from, to, destructive } : { subject, label, from, to };
  switch (change.target) {
    case 'exercise_create':
      return row(change.name, tr('New exercise'), '', kindLabel(change.kind, lang));
    case 'exercise_delete':
      return row(change.name, tr('Delete exercise'), '', tr('Deleted'));
    case 'routine':
      switch (change.field) {
        case 'create':
          return row(change.name, tr('New routine'), '', tr('Created'));
        case 'rename':
          return row(change.name, tr('Name'), change.name, change.value ?? '');
        case 'duplicate':
          return row(change.name, tr('Duplicate this routine'), '', change.value ?? tr('Copy'));
        case 'delete':
          return row(change.name, tr('Delete routine'), '', tr('Deleted'));
      }
      break;
    case 'routine_item': {
      const subject = `${change.routineName} · ${change.exerciseName}`;
      const was = change.was == null ? '' : String(change.was);
      switch (change.field) {
        case 'add':
          return row(change.routineName, change.exerciseName, '', tr('Added'));
        case 'remove':
          return row(change.routineName, change.exerciseName, '', tr('Removed'));
        case 'sets':
          return row(subject, tr('Sets'), was, String(change.value));
        case 'reps':
          return row(subject, tr('Reps'), was, String(change.value));
        case 'reps_min':
          return row(
            subject,
            tr('Lowest reps'),
            change.was == null ? tr('Off') : was,
            change.value == null ? tr('Off') : String(change.value),
          );
        case 'move':
          return row(
            change.routineName,
            change.exerciseName,
            change.was == null ? '' : `#${change.was + 1}`,
            `#${(change.value ?? 0) + 1}`,
          );
      }
      break;
    }
    case 'sequence': {
      const subject = tr('Training sequence');
      if (change.field === 'on') {
        const word = (on: boolean | undefined) => (on ? tr('On') : tr('Off'));
        return row(
          subject,
          tr('Use this sequence'),
          word(change.wasOn),
          word(change.value === true),
        );
      }
      if (change.field === 'next') {
        return row(subject, tr('Next'), change.wasName ?? '', change.routineName ?? '');
      }
      return row(
        subject,
        tr('Own copy for step {n}', { n: (change.value as number) + 1 }),
        '',
        change.routineName ?? '',
      );
    }
    case 'workout': {
      const subject = `${change.title} · ${formatDay(change.day)}`;
      switch (change.field) {
        case 'rename':
          return row(subject, tr('Name'), String(change.was ?? ''), String(change.value));
        case 'date':
          return row(subject, tr('Day'), formatDay(change.day), formatDay(String(change.value)));
        case 'start_time':
          return row(subject, tr('Start time'), String(change.was ?? ''), String(change.value));
        case 'duration':
          return row(
            subject,
            tr('Length'),
            change.was == null ? '' : `${change.was} ${tr('min')}`,
            `${change.value} ${tr('min')}`,
          );
        case 'number':
          return row(subject, tr('Workout number'), '', `#${change.value}`);
        case 'delete':
          return row(subject, tr('Delete this workout'), '', tr('Deleted'));
        case 'add_exercise':
          return row(subject, change.exerciseName ?? '', '', tr('Added'));
        case 'remove_exercise':
          return row(subject, change.exerciseName ?? '', '', tr('Removed'));
      }
      break;
    }
    case 'workout_set': {
      const subject = `${change.exerciseName} · ${formatDay(change.day)}`;
      const setLabel = tr('Set {n}', { n: change.position ?? 0 });
      switch (change.field) {
        case 'add':
          return row(subject, tr('New set'), '', tr('Added'));
        case 'delete':
          return row(subject, setLabel, '', tr('Removed'));
        case 'weight':
          return row(
            subject,
            `${setLabel} · ${tr('Weight')}`,
            kgText(change.was, lang),
            kgText(change.value, lang),
          );
        case 'reps':
          return row(
            subject,
            `${setLabel} · ${tr('Reps')}`,
            change.was == null ? '' : String(change.was),
            String(change.value),
          );
      }
      break;
    }
    case 'live': {
      const subject = tr('This workout');
      switch (change.field) {
        case 'add_exercise':
          return row(subject, change.exerciseName, '', tr('Added'));
        case 'remove_exercise':
          return row(subject, change.exerciseName, '', tr('Removed'));
        case 'add_set':
          return row(subject, change.exerciseName, '', tr('+1 set'));
        case 'move_exercise':
          return row(
            subject,
            change.exerciseName,
            change.was == null ? '' : `#${change.was + 1}`,
            `#${(change.value ?? 0) + 1}`,
          );
        case 'warmup':
          return row(
            subject,
            `${change.exerciseName} · ${tr('Warm-up')}`,
            change.on ? tr('Off') : tr('On'),
            change.on ? tr('On') : tr('Off'),
          );
      }
      break;
    }
    case 'live_set': {
      const subject = `${change.exerciseName} · ${tr('This workout')}`;
      const setLabel = tr('Set {n}', { n: change.position });
      switch (change.field) {
        case 'log':
          return row(subject, setLabel, '', tr('Logged'));
        case 'unlog':
          return row(subject, setLabel, tr('Logged'), tr('Not logged'));
        case 'remove':
          return row(subject, setLabel, '', tr('Removed'));
        case 'weight':
          return row(
            subject,
            `${setLabel} · ${tr('Weight')}`,
            kgText(change.was, lang),
            kgText(change.value, lang),
          );
        case 'reps':
          return row(
            subject,
            `${setLabel} · ${tr('Reps')}`,
            change.was == null ? '' : String(change.was),
            String(change.value),
          );
      }
      break;
    }
    case 'order': {
      /* The card draws the order itself as rows to drag (`AiChangesCard`); this
         row is its heading, and `to` the order as filed — what a reader of the
         stored card, or a test, sees in one line. */
      const subject =
        change.list === 'routine'
          ? change.name
          : change.list === 'sequence'
            ? tr('Training sequence')
            : tr('This workout');
      const label = change.list === 'sequence' ? tr('Step order') : tr('Exercise order');
      return row(
        subject,
        label,
        '',
        orderedRows(change)
          .map((r) => r.name)
          .join(', '),
      );
    }
  }
  return row('', '', '', '');
}
