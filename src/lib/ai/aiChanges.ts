/**
 * Settings the assistant may suggest changing — everything the user can set by
 * hand that is NOT a routine's rows — checked, described, and applied.
 *
 *   model's items ──validateChanges──► AiChange[] ──describeChanges──► the card
 *                                          └────applyExerciseChange──► the library
 *                                               (settings, logs: aiActions)
 *
 * ── WHY A SECOND KIND OF SUGGESTION ────────────────────────────────────────
 *
 * A routine proposal is a list of rows — sets, reps, weight — and that is all it
 * can say. Everything else the user tunes lived out of the assistant's reach: an
 * exercise's rest, its ladder max, its cue; the app's own rest and weekly goal.
 * Asked "my pull-up max is 14 now", the
 * model could only reply in prose and leave the user to find the field. Now it
 * writes one card listing each change as `from → to`, and Apply writes them all,
 * with one Undo.
 *
 * ── THE SAME CONTRACT AS EVERY OTHER SUGGESTION ────────────────────────────
 *
 * Nothing is written without a tap. Every id must be one the context named (an
 * unknown one is dropped, never guessed at); every number is clamped to the
 * range its own editor allows; a change the exercise cannot take — a ladder on a
 * timed exercise, an increment on a bodyweight one — is dropped rather than
 * forced. The card is drawn from what SURVIVED, so it never shows a change Apply
 * would not make.
 *
 * ── AND THE THINGS THE USER LOGS, NOT ONLY THE THINGS THEY TUNE ───────────
 *
 * "I weigh 81 today", "that first bench set on Monday was a warm-up". Each is a
 * thing the user does by hand in a screen, so the chat can draft it too — as a
 * card, through the same Apply and the same Undo, never written behind the
 * user's back. A weigh-in adds a row; a past set's kind is a correction of a
 * saved workout, which is how a warm-up that went unmarked stops counting.
 *
 * Pure, like everything in `lib/`: the stores are read by the caller and passed
 * in, and the writes happen in `state/aiActions.ts`.
 */

import { BODYWEIGHT_LIMITS } from '../bodyweightLog';
import { dayKey } from '../days';
import { clampMax, ladderOf, supportsLadder } from '../repLadder';
import { TARGET_SETS_LIMITS } from '../routinePlan';
import { REST_LIMITS, clampRest, ownRestSeconds } from '../rest';
import { formatClock } from '../units';
import { WEEKLY_GOAL_LIMITS, usableWeeklyGoal } from '../weeklyGoal';
import { t, type Language } from '../i18n';
import { kindName, setKindOf, type SetKind, type SetType } from '../setType';
import type { Exercise, ID } from '../../types/models';

/* ------------------------------------------------------------------ */
/* The changes                                                         */
/* ------------------------------------------------------------------ */

export type ExerciseField =
  | 'rest_seconds'
  | 'sets'
  | 'rep_target'
  | 'max_reps'
  | 'ladder'
  | 'increment_kg'
  | 'cue'
  | 'prepare_seconds';

export type SettingField =
  'rest_between_sets' | 'rest_between_exercises' | 'auto_rest' | 'weekly_goal';

/**
 * One change, already checked. `value` is the new value in the field's own
 * terms: seconds, a count, a flag, a cue — `null` where the field can be
 * cleared (an exercise's rest back to the setting, a ladder off).
 */
export type AiChange =
  | { target: 'exercise'; id: ID; field: ExerciseField; value: number | boolean | string | null }
  | { target: 'setting'; field: SettingField; value: number | boolean }
  /** Today's weigh-in, kg. */
  | { target: 'bodyweight'; field: 'log'; value: number }
  /** A saved set's kind — `that first set was a warm-up`. */
  | {
      target: 'workout_set';
      field: 'kind';
      /** The workout. */
      id: ID;
      exerciseId: ID;
      setId: ID;
      /** What the set was, for the card's `from`. */
      from: SetKind;
      value: SetKind;
      /** For the card: the workout's day and the set's place, `Bench · 27 Oct · set 1`. */
      day: string;
      position: number;
    };

/** What the validator needs to know about the stores. */
export interface ChangeContext {
  exercises: readonly Exercise[];
  /** Saved workouts, for a set correction. */
  workouts?: readonly {
    id: ID;
    startedAt: string;
    sets: readonly {
      id: ID;
      exerciseId: ID;
      setIndex: number;
      isWarmup: boolean;
      setType?: SetType;
    }[];
  }[];
}

/** An exercise cue is one line — the editor's own cap. */
export const CUE_MAX = 120;
/** The weight increments a gym actually has. */
const INCREMENT_LIMITS = { min: 0.25, max: 50 } as const;
/** A get-ready countdown, as Settings holds it. */
const PREPARE_LIMITS = { min: 0, max: 60 } as const;
/** A rep target someone could actually be asked for. */
const REP_TARGET_LIMITS = { min: 1, max: 100 } as const;

/* ------------------------------------------------------------------ */
/* Reading the model's items                                           */
/* ------------------------------------------------------------------ */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed === '' ? null : trimmed.slice(0, max);
}

/** A flag, from `on`, or from the words a model writes instead of one. */
function flag(item: Rec): boolean | null {
  if (typeof item.on === 'boolean') return item.on;
  const word = typeof item.text === 'string' ? item.text.trim().toLowerCase() : '';
  if (['on', 'true', 'yes', 'enable', 'enabled'].includes(word)) return true;
  if (['off', 'false', 'no', 'disable', 'disabled'].includes(word)) return false;
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** "rest", "Rest Seconds", "rest-seconds" → `rest_seconds`. */
function fieldKey(value: unknown): string {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
    : '';
}

/** The names a model uses for each field — the schema's name first. */
const EXERCISE_ALIASES: Record<string, ExerciseField> = {
  rest_seconds: 'rest_seconds',
  rest: 'rest_seconds',
  sets: 'sets',
  default_sets: 'sets',
  rep_target: 'rep_target',
  reps: 'rep_target',
  target_reps: 'rep_target',
  max_reps: 'max_reps',
  count_to_max: 'max_reps',
  ladder: 'ladder',
  ladder_max: 'ladder',
  rep_ladder: 'ladder',
  increment_kg: 'increment_kg',
  increment: 'increment_kg',
  cue: 'cue',
  form_cue: 'cue',
  prepare_seconds: 'prepare_seconds',
  countdown: 'prepare_seconds',
};

const SETTING_ALIASES: Record<string, SettingField> = {
  rest_between_sets: 'rest_between_sets',
  rest_seconds_between_sets: 'rest_between_sets',
  rest_between_exercises: 'rest_between_exercises',
  rest_seconds_between_exercises: 'rest_between_exercises',
  auto_rest: 'auto_rest',
  auto_start_rest: 'auto_rest',
  weekly_goal: 'weekly_goal',
  weekly_workout_goal: 'weekly_goal',
};

/** The kind names a model writes for a set — the app's own first. */
const KIND_ALIASES: Record<string, SetKind> = {
  warmup: 'warmup',
  warm_up: 'warmup',
  working: 'working',
  work: 'working',
  normal: 'working',
  drop: 'drop',
  drop_set: 'drop',
  failure: 'failure',
  to_failure: 'failure',
  amrap: 'amrap',
};

function validateExerciseItem(item: Rec, exercise: Exercise): AiChange | null {
  const field = EXERCISE_ALIASES[fieldKey(item.field)];
  if (!field) return null;
  const n = num(item.number);
  const on = flag(item);
  const id = exercise.id;
  const reps = exercise.countUnit === 'reps';
  switch (field) {
    case 'rest_seconds': {
      // `on: false`, "follow" or "default": back to the between-sets setting.
      const word = fieldKey(item.text);
      if (on === false || word === 'follow' || word === 'default' || word === 'settings') {
        return { target: 'exercise', id, field, value: null };
      }
      return n == null ? null : { target: 'exercise', id, field, value: clampRest(n) };
    }
    case 'sets':
      return n == null
        ? null
        : {
            target: 'exercise',
            id,
            field,
            value: clamp(Math.round(n), TARGET_SETS_LIMITS.min, TARGET_SETS_LIMITS.max),
          };
    case 'rep_target':
      // A ladder's rep number IS its max — said through `ladder`, not here.
      if (!reps || n == null || ladderOf(exercise)) return null;
      return {
        target: 'exercise',
        id,
        field,
        value: clamp(Math.round(n), REP_TARGET_LIMITS.min, REP_TARGET_LIMITS.max),
      };
    case 'max_reps':
      return reps && on != null ? { target: 'exercise', id, field, value: on } : null;
    case 'ladder': {
      if (!supportsLadder(exercise.countUnit)) return null;
      if (on === false)
        return ladderOf(exercise) ? { target: 'exercise', id, field, value: null } : null;
      // A max switches it on; `on: true` alone starts it at the exercise's current number.
      const max = n ?? (on ? (ladderOf(exercise)?.max ?? exercise.defaultCount ?? null) : null);
      return max == null ? null : { target: 'exercise', id, field, value: clampMax(max) };
    }
    case 'increment_kg':
      if (!exercise.requiresWeight || n == null || n <= 0) return null;
      return {
        target: 'exercise',
        id,
        field,
        value: Math.round(clamp(n, INCREMENT_LIMITS.min, INCREMENT_LIMITS.max) * 4) / 4,
      };
    case 'cue': {
      // An empty text clears it — "drop that note" is a request too.
      if (typeof item.text !== 'string') return null;
      return { target: 'exercise', id, field, value: str(item.text, CUE_MAX) ?? '' };
    }
    case 'prepare_seconds':
      if (reps || n == null) return null;
      return {
        target: 'exercise',
        id,
        field,
        value: clamp(Math.round(n), PREPARE_LIMITS.min, PREPARE_LIMITS.max),
      };
  }
}

function validateSettingItem(item: Rec): AiChange | null {
  const field = SETTING_ALIASES[fieldKey(item.field)];
  if (!field) return null;
  const n = num(item.number);
  if (field === 'auto_rest') {
    const on = flag(item);
    return on == null ? null : { target: 'setting', field, value: on };
  }
  if (n == null) return null;
  if (field === 'weekly_goal') {
    const goal = usableWeeklyGoal(n);
    return goal == null ? null : { target: 'setting', field, value: goal };
  }
  // On the setting's own 15-second grid, as its ± chips move it.
  const snapped = Math.round(n / REST_LIMITS.step) * REST_LIMITS.step;
  return { target: 'setting', field, value: clampRest(snapped) };
}

function validateBodyweightItem(item: Rec): AiChange | null {
  const n = num(item.number);
  if (n == null || n < BODYWEIGHT_LIMITS.min || n > BODYWEIGHT_LIMITS.max) return null;
  return { target: 'bodyweight', field: 'log', value: Math.round(n * 10) / 10 };
}

/**
 * `number` is the set's place among the exercise's WORKING sets in that workout —
 * the order `sessions[].ex` lists them, which never shows a warm-up. So "set 1"
 * is the first number the user sees in the log, and an already-warm-up set is
 * out of reach (it is not on the page to point at).
 */
function validateWorkoutSetItem(item: Rec, ctx: ChangeContext): AiChange | null {
  const kind = KIND_ALIASES[fieldKey(item.text)];
  if (!kind) return null;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const workout = ctx.workouts?.find((w) => w.id === id);
  if (!workout) return null;
  const exerciseId = typeof item.exerciseId === 'string' ? item.exerciseId.trim() : '';
  const position = num(item.number);
  if (position == null || !Number.isInteger(position) || position < 1) return null;
  const working = workout.sets
    .filter((s) => s.exerciseId === exerciseId && !s.isWarmup)
    .sort((a, b) => a.setIndex - b.setIndex);
  const set = working[position - 1];
  if (!set || setKindOf(set) === kind) return null;
  return {
    target: 'workout_set',
    field: 'kind',
    id,
    exerciseId,
    setId: set.id,
    from: setKindOf(set),
    value: kind,
    // The phone's own day, as `aiContext` dates the log the model read: the UTC
    // prefix put a session started before dawn east of Greenwich on the day before.
    day: dayKey(workout.startedAt),
    position,
  };
}

/** Same thing changed twice in one card — the later one is what the model settled on. */
function identity(change: AiChange): string {
  if (change.target === 'setting') return `setting:${change.field}`;
  if (change.target === 'bodyweight') return 'bodyweight';
  if (change.target === 'workout_set') return `workout_set:${change.setId}`;
  return `${change.target}:${change.id}:${change.field}`;
}

/**
 * The changes worth offering out of what the model wrote. Unknown targets,
 * unknown ids and fields an exercise cannot take are all dropped — see the file header.
 */
export function validateChanges(items: readonly unknown[], ctx: ChangeContext): AiChange[] {
  const byExercise = new Map(ctx.exercises.filter((e) => !e.isArchived).map((e) => [e.id, e]));
  const out = new Map<string, AiChange>();
  for (const raw of items) {
    if (!isRec(raw)) continue;
    const target = fieldKey(raw.target);
    let change: AiChange | null = null;
    if (target === 'exercise') {
      const exercise = byExercise.get(typeof raw.id === 'string' ? raw.id.trim() : '');
      change = exercise ? validateExerciseItem(raw, exercise) : null;
    } else if (target === 'setting' || target === 'settings') {
      change = validateSettingItem(raw);
    } else if (target === 'bodyweight' || target === 'weight') {
      change = validateBodyweightItem(raw);
    } else if (target === 'workout_set' || target === 'set') {
      change = validateWorkoutSetItem(raw, ctx);
    }
    if (!change) continue;
    const key = identity(change);
    out.delete(key);
    out.set(key, change);
  }
  return [...out.values()];
}

/* ------------------------------------------------------------------ */
/* What the card says                                                   */
/* ------------------------------------------------------------------ */

/** The values in force now, for each change's `from`. */
export interface CurrentValues {
  exercises: readonly Exercise[];
  settings: {
    restSecondsBetweenSets: number;
    restSecondsBetweenExercises: number;
    autoStartRest: boolean;
    weeklyWorkoutGoal?: number;
  };
  /** Today's weight, for the weigh-in row's `from`. */
  bodyweightKg?: number;
  /** A day as the card prints it — `27 Oct`. Absent: the ISO date. */
  formatDay?: (day: string) => string;
}

/** One line of the card: `Bench press · Rest  2:00 → 1:30`. */
export interface ChangeRow {
  subject: string;
  label: string;
  /** Empty when there was nothing before (a first weigh-in). */
  from: string;
  to: string;
}

function onOff(value: boolean, lang: Language): string {
  return value ? t('On', lang) : t('Off', lang);
}

function exerciseRow(
  change: Extract<AiChange, { target: 'exercise' }>,
  e: Exercise,
  lang: Language,
  restSetting: number,
): ChangeRow {
  const subject = e.name;
  const tr = (key: string) => t(key, lang);
  switch (change.field) {
    case 'rest_seconds': {
      const own = ownRestSeconds(e);
      const follows = (seconds: number) => `${formatClock(seconds)} (${tr('setting')})`;
      return {
        subject,
        label: tr('Rest between sets'),
        from: own == null ? follows(restSetting) : formatClock(own),
        to: change.value == null ? follows(restSetting) : formatClock(change.value as number),
      };
    }
    case 'sets':
      return {
        subject,
        label: tr('Sets'),
        from: e.defaultSets != null ? String(e.defaultSets) : '',
        to: String(change.value),
      };
    case 'rep_target':
      return {
        subject,
        label: tr('Rep target'),
        from: e.defaultCount != null ? String(e.defaultCount) : '',
        to: String(change.value),
      };
    case 'max_reps':
      return {
        subject,
        label: tr('Reps to MAX'),
        from: onOff(e.countToMax === true, lang),
        to: onOff(change.value === true, lang),
      };
    case 'ladder': {
      const ladder = ladderOf(e);
      return {
        subject,
        label: tr('Rep ladder max'),
        from: ladder ? String(ladder.max) : tr('Off'),
        to: change.value == null ? tr('Off') : String(change.value),
      };
    }
    case 'increment_kg':
      return {
        subject,
        label: tr('Weight step'),
        from: e.incrementKg != null ? `${e.incrementKg} ${tr('kg')}` : '',
        to: `${String(change.value)} ${tr('kg')}`,
      };
    case 'cue':
      return {
        subject,
        label: tr('Form cue'),
        from: e.cue?.trim() ?? '',
        to: (change.value as string) || tr('None'),
      };
    case 'prepare_seconds':
      return {
        subject,
        label: tr('Get-ready countdown'),
        from: e.prepareSeconds != null ? `${e.prepareSeconds} s` : '',
        to: `${String(change.value)} s`,
      };
  }
}

/**
 * The card's rows, computed when the reply is filed and STORED with it: once
 * applied, the stores hold the new values, and a `from` recomputed then would
 * read `1:30 → 1:30`.
 */
export function describeChanges(
  changes: readonly AiChange[],
  now: CurrentValues,
  lang: Language,
): ChangeRow[] {
  const exercises = new Map(now.exercises.map((e) => [e.id, e]));
  const tr = (key: string) => t(key, lang);
  const rows: ChangeRow[] = [];
  for (const change of changes) {
    if (change.target === 'exercise') {
      const exercise = exercises.get(change.id);
      if (exercise)
        rows.push(exerciseRow(change, exercise, lang, now.settings.restSecondsBetweenSets));
      continue;
    }
    if (change.target === 'setting') {
      const s = now.settings;
      if (change.field === 'auto_rest') {
        rows.push({
          subject: tr('Settings'),
          label: tr('Start rest automatically'),
          from: onOff(s.autoStartRest, lang),
          to: onOff(change.value === true, lang),
        });
      } else if (change.field === 'weekly_goal') {
        rows.push({
          subject: tr('Settings'),
          label: tr('Weekly workout goal'),
          from: String(s.weeklyWorkoutGoal ?? WEEKLY_GOAL_LIMITS.default),
          to: String(change.value),
        });
      } else {
        const between = change.field === 'rest_between_sets';
        rows.push({
          subject: tr('Settings'),
          label: between ? tr('Rest between sets') : tr('Rest between exercises'),
          from: formatClock(between ? s.restSecondsBetweenSets : s.restSecondsBetweenExercises),
          to: formatClock(change.value as number),
        });
      }
      continue;
    }
    const dayText = (day: string) => (now.formatDay ? now.formatDay(day) : day);
    if (change.target === 'bodyweight') {
      rows.push({
        subject: tr('Body weight'),
        label: tr('Today'),
        from: now.bodyweightKg != null ? `${now.bodyweightKg} ${tr('kg')}` : '',
        to: `${change.value} ${tr('kg')}`,
      });
      continue;
    }
    if (change.target === 'workout_set') {
      const name = exercises.get(change.exerciseId)?.name ?? '';
      rows.push({
        subject: `${name} · ${dayText(change.day)}`,
        label: t('Set {n}', lang, { n: change.position }),
        from: kindName(change.from, lang),
        to: kindName(change.value, lang),
      });
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Applying an exercise change                                          */
/* ------------------------------------------------------------------ */

/**
 * The exercise with one change made, keeping the invariants its own editor keeps
 * (`lib/exerciseDraft.ts`): MAX and a ladder never both on; a ladder's rep
 * number is its max; an exercise's own rest is deleted, not zeroed, to follow
 * the setting. Pure — the caller writes it through `libraryStore.updateExercise`,
 * which also re-plans every routine on a `sets` change.
 */
export function applyExerciseChange(
  exercise: Exercise,
  change: Extract<AiChange, { target: 'exercise' }>,
): Exercise {
  const next: Exercise = { ...exercise };
  switch (change.field) {
    case 'rest_seconds':
      if (change.value == null) delete next.defaultRestSeconds;
      else next.defaultRestSeconds = change.value as number;
      return next;
    case 'sets':
      next.defaultSets = change.value as number;
      return next;
    case 'rep_target':
      next.defaultCount = change.value as number;
      return next;
    case 'max_reps':
      if (change.value === true) {
        next.countToMax = true;
        delete next.ladder;
      } else {
        delete next.countToMax;
      }
      return next;
    case 'ladder': {
      if (change.value == null) {
        delete next.ladder;
        return next;
      }
      const max = change.value as number;
      const current = ladderOf(exercise);
      /* A max moved by hand starts its climb again: `earned` counts reps earned
         against THAT max, and carrying it over would shape the new ladder from
         progress made on the old one. The same max keeps what it earned. */
      next.ladder =
        current && current.max === max ? { max, earned: current.earned } : { max, earned: 0 };
      next.defaultCount = max;
      delete next.countToMax;
      return next;
    }
    case 'increment_kg':
      next.incrementKg = change.value as number;
      return next;
    case 'cue':
      if (change.value === '') delete next.cue;
      else next.cue = change.value as string;
      return next;
    case 'prepare_seconds':
      next.prepareSeconds = change.value as number;
      return next;
  }
}
