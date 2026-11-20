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
 * exercise's rest, its ladder max, its cue; the app's own rest.
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
import { parseClockTime, weekdayLabels, type Weekday } from '../days';
import { applyDraftToExercise, exerciseToDraft, findMaxNextWorkout } from '../exerciseDraft';
import { CLUSTERS } from '../muscles';
import { clampMax, isAwaitingMax, ladderOf, supportsLadder } from '../repLadder';
import { TARGET_COUNT_LIMITS, TARGET_SETS_LIMITS } from '../routinePlan';
import { REST_LIMITS, clampRest, ownRestSeconds } from '../rest';
import { formatClock } from '../units';
import { t, type Language } from '../i18n';
import {
  describeEdit,
  draftWithKind,
  editIdentity,
  isPastSetEdit,
  kindLabel,
  kindOf,
  newExercise,
  parseKind,
  parseMuscles,
  validateEdit,
  validateExerciseCreate,
  validateRoutineCreate,
  type EditChange,
  type EditEnv,
  type EditRoutine,
  type EditSession,
  type EditWorkout,
  type ExerciseKind,
} from './aiEdits';
import type {
  Exercise,
  ID,
  MuscleCluster,
  MuscleGroup,
  TimerMode,
  TrainingSequence,
} from '../../types/models';

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
  | 'prepare_seconds'
  | 'name'
  | 'muscles'
  | 'kind'
  | 'start_weight'
  | 'find_max'
  | 'timer'
  | 'duration_seconds'
  | 'distance_m';

export type SettingField =
  | 'rest_between_sets'
  | 'rest_between_exercises'
  | 'auto_rest'
  | 'timer_step'
  | 'get_ready'
  | 'beep_seconds'
  | 'sound'
  | 'vibration'
  | 'keep_awake'
  | 'timer_notifications'
  | 'ladder_all'
  | 'units'
  | 'language'
  | 'weekly_target'
  | 'weigh_in_reminder'
  | 'weigh_in_days'
  | 'weigh_in_time';

/**
 * One change, already checked. `value` is the new value in the field's own
 * terms: seconds, a count, a flag, a cue — `null` where the field can be
 * cleared (an exercise's rest back to the setting, a ladder off).
 */
export type AiChange =
  | {
      target: 'exercise';
      id: ID;
      field: ExerciseField;
      value: number | boolean | string | MuscleGroup[] | null;
    }
  | {
      target: 'setting';
      field: SettingField;
      /**
       * `null` clears a weekly target. `weigh_in_days` is the whole set of days,
       * Monday = 0; `weigh_in_time` is `HH:MM`.
       */
      value: number | boolean | string | Weekday[] | null;
      /** `weekly_target` only: which cluster. */
      cluster?: MuscleCluster;
    }
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
    }
  /** Create, remove, edit — `aiEdits.ts`. */
  | EditChange;

/**
 * A saved set is a warm-up or a working set — the one mark a set carries. Drop,
 * failure and AMRAP types were here until 4.0.
 */
export type SetKind = 'working' | 'warmup';

function kindName(kind: SetKind, lang: Language): string {
  return kind === 'warmup' ? t('Warm-up', lang) : t('Working set', lang);
}

/** What the validator needs to know about the stores. */
export interface ChangeContext {
  exercises: readonly Exercise[];
  /** Saved workouts, for a set correction or a workout edit. */
  workouts?: readonly EditWorkout[];
  routines?: readonly EditRoutine[];
  sequence?: TrainingSequence;
  /** The workout in flight, if one is open. */
  session?: EditSession | null;
  /** `YYYY-MM-DD` — a workout is not moved into the future. */
  today?: string;
  /** `Make every exercise a rep ladder`, which a new exercise is created under. */
  ladderAll?: boolean;
  /** The between-sets setting, which a new exercise follows. */
  restSeconds?: number;
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
  name: 'name',
  rename: 'name',
  muscles: 'muscles',
  muscle: 'muscles',
  muscle_groups: 'muscles',
  kind: 'kind',
  type: 'kind',
  start_weight: 'start_weight',
  default_weight: 'start_weight',
  weight: 'start_weight',
  weight_kg: 'start_weight',
  find_max: 'find_max',
  find_my_max: 'find_max',
  test_max: 'find_max',
  max_test: 'find_max',
  retest: 'find_max',
  retest_max: 'find_max',
  awaiting_max: 'find_max',
  timer: 'timer',
  timer_mode: 'timer',
  duration_seconds: 'duration_seconds',
  duration: 'duration_seconds',
  set_length: 'duration_seconds',
  hold_seconds: 'duration_seconds',
  round_seconds: 'duration_seconds',
  distance_m: 'distance_m',
  distance: 'distance_m',
  meters: 'distance_m',
  metres: 'distance_m',
};

/** The editor's three timer choices, in the words a model writes for them. */
const TIMER_ALIASES: Record<string, TimerMode> = {
  manual: 'manual',
  off: 'manual',
  none: 'manual',
  countdown: 'countdown',
  count_down: 'countdown',
  down: 'countdown',
  countup: 'countup',
  count_up: 'countup',
  stopwatch: 'countup',
  up: 'countup',
};

/** Only time-counted work has a clock to run — the editor shows `Timer` for nothing else. */
function isTimeCounted(e: Pick<Exercise, 'requiresWeight' | 'countUnit'>): boolean {
  return !e.requiresWeight && (e.countUnit === 'seconds' || e.countUnit === 'rounds');
}

const SETTING_ALIASES: Record<string, SettingField> = {
  rest_between_sets: 'rest_between_sets',
  rest_seconds_between_sets: 'rest_between_sets',
  rest_between_exercises: 'rest_between_exercises',
  rest_seconds_between_exercises: 'rest_between_exercises',
  auto_rest: 'auto_rest',
  auto_start_rest: 'auto_rest',
  timer_step: 'timer_step',
  adjust_step_seconds: 'timer_step',
  get_ready: 'get_ready',
  prepare_seconds: 'get_ready',
  beep_seconds: 'beep_seconds',
  countdown_beeps: 'beep_seconds',
  sound: 'sound',
  sounds: 'sound',
  vibration: 'vibration',
  haptics: 'vibration',
  keep_awake: 'keep_awake',
  keep_screen_on: 'keep_awake',
  timer_notifications: 'timer_notifications',
  notify_on_timer_end: 'timer_notifications',
  notifications: 'timer_notifications',
  ladder_all: 'ladder_all',
  ladder_all_exercises: 'ladder_all',
  units: 'units',
  unit_system: 'units',
  language: 'language',
  weekly_target: 'weekly_target',
  weekly_sets: 'weekly_target',
  weigh_in_reminder: 'weigh_in_reminder',
  weighin_reminder: 'weigh_in_reminder',
  weigh_in: 'weigh_in_reminder',
  weigh_in_reminder_enabled: 'weigh_in_reminder',
  weigh_in_days: 'weigh_in_days',
  weigh_in_reminder_days: 'weigh_in_days',
  weighin_days: 'weigh_in_days',
  weigh_in_time: 'weigh_in_time',
  weigh_in_reminder_time: 'weigh_in_time',
  weighin_time: 'weigh_in_time',
};

/** The numeric settings past the two rests, with the ranges their steppers keep. */
const SETTING_NUMBERS: Partial<Record<SettingField, { min: number; max: number; step: number }>> = {
  timer_step: { min: 5, max: 60, step: 5 },
  get_ready: { min: 0, max: 60, step: 1 },
  beep_seconds: { min: 0, max: 30, step: 1 },
};
const SETTING_FLAGS: SettingField[] = [
  'auto_rest',
  'sound',
  'vibration',
  'keep_awake',
  'timer_notifications',
  'ladder_all',
  'weigh_in_reminder',
];

/** A weekday as a model writes it — English or Russian, full or short — Monday = 0. */
const WEEKDAY_WORDS: Record<string, Weekday> = Object.fromEntries(
  [
    ['mon', 'monday', 'пн', 'понедельник'],
    ['tue', 'tues', 'tuesday', 'вт', 'вторник'],
    ['wed', 'wednesday', 'ср', 'среда'],
    ['thu', 'thur', 'thurs', 'thursday', 'чт', 'четверг'],
    ['fri', 'friday', 'пт', 'пятница'],
    ['sat', 'saturday', 'сб', 'суббота'],
    ['sun', 'sunday', 'вс', 'воскресенье'],
  ].flatMap((words, day) => words.map((word) => [word, day as Weekday])),
);

/**
 * The days a weigh-in item names — `"Wed, Sun"`, `["mon","thu"]` — sorted, each
 * once. NAMES only: a bare number is Monday-is-1 to a person and Monday-is-0 to
 * this app, and a reminder on the wrong morning is worse than none. Null when
 * any word is not a day, or none is: an empty set would switch the reminder off
 * (the store's rule), which is `weigh_in_reminder` off, said plainly.
 */
export function parseWeekdays(value: unknown): Weekday[] | null {
  const words = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,;/+&]+/)
      : [];
  const days = new Set<Weekday>();
  for (const raw of words) {
    if (typeof raw !== 'string') return null;
    const word = raw.trim().toLowerCase().replace(/\.$/, '');
    if (word === '' || word === 'and' || word === 'и') continue;
    const day = WEEKDAY_WORDS[word];
    if (day == null) return null;
    days.add(day);
  }
  return days.size > 0 ? [...days].sort((a, b) => a - b) : null;
}
/** A weekly set target someone could plan — Settings' own stepper range. */
const WEEKLY_TARGET_LIMITS = { min: 1, max: 60 } as const;

/** The kind names a model writes for a set — the app's own first. */
const KIND_ALIASES: Record<string, SetKind> = {
  warmup: 'warmup',
  warm_up: 'warmup',
  working: 'working',
  work: 'working',
  normal: 'working',
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
    case 'name': {
      const name = str(item.text ?? item.name, 40);
      return name && name !== exercise.name ? { target: 'exercise', id, field, value: name } : null;
    }
    case 'muscles': {
      const muscles = parseMuscles(item.text ?? item.muscle ?? item.muscles);
      return muscles.length > 0 ? { target: 'exercise', id, field, value: muscles } : null;
    }
    case 'kind': {
      const kind = parseKind(item.text ?? item.kind);
      return kind && kind !== kindOf(exercise)
        ? { target: 'exercise', id, field, value: kind }
        : null;
    }
    case 'start_weight':
      if (!exercise.requiresWeight || n == null || n < 0) return null;
      return { target: 'exercise', id, field, value: Math.round(Math.min(500, n) * 4) / 4 };
    case 'find_max':
      /* `Find my max in the next workout`: the ladder on, waiting for its test —
         or a retest of the max it has. Not while it is already waiting: the
         editor hides the button then, because there is nothing left to ask. */
      if (!supportsLadder(exercise.countUnit) || isAwaitingMax(ladderOf(exercise))) return null;
      return { target: 'exercise', id, field, value: true };
    case 'timer': {
      // `Manual`, `Countdown`, `Count up` — the editor's segmented control.
      const mode = TIMER_ALIASES[fieldKey(item.text)];
      if (!isTimeCounted(exercise) || !mode) return null;
      return mode === (exercise.timerMode ?? 'manual')
        ? null
        : { target: 'exercise', id, field, value: mode };
    }
    case 'duration_seconds': {
      // The set's length — a hold, a round — which IS the target of timed work.
      if (!isTimeCounted(exercise) || n == null) return null;
      const { min, max } = TARGET_COUNT_LIMITS.seconds;
      return { target: 'exercise', id, field, value: clamp(Math.round(n), min, max) };
    }
    case 'distance_m': {
      // A ladder's number is its max, said through `ladder` — as for reps.
      if (exercise.countUnit !== 'meters' || exercise.requiresWeight || ladderOf(exercise)) {
        return null;
      }
      if (n == null) return null;
      const { min, max } = TARGET_COUNT_LIMITS.meters;
      return { target: 'exercise', id, field, value: clamp(Math.round(n), min, max) };
    }
  }
}

function validateSettingItem(item: Rec): AiChange | null {
  const field = SETTING_ALIASES[fieldKey(item.field)];
  if (!field) return null;
  const n = num(item.number);
  if (SETTING_FLAGS.includes(field)) {
    const on = flag(item);
    return on == null ? null : { target: 'setting', field, value: on };
  }
  if (field === 'weigh_in_days') {
    const days = parseWeekdays(item.text ?? item.days);
    return days ? { target: 'setting', field, value: days } : null;
  }
  if (field === 'weigh_in_time') {
    const at = parseClockTime(item.text);
    if (!at) return null;
    const value = `${String(at.hour).padStart(2, '0')}:${String(at.minute).padStart(2, '0')}`;
    return { target: 'setting', field, value };
  }
  if (field === 'units') {
    const word = fieldKey(item.text);
    const value = ['metric', 'kg', 'kilograms'].includes(word)
      ? 'metric'
      : ['imperial', 'lb', 'lbs', 'pounds'].includes(word)
        ? 'imperial'
        : null;
    return value ? { target: 'setting', field, value } : null;
  }
  if (field === 'language') {
    const word = fieldKey(item.text);
    const value = ['en', 'english'].includes(word)
      ? 'en'
      : ['ru', 'russian'].includes(word) || item.text === 'русский'
        ? 'ru'
        : null;
    return value ? { target: 'setting', field, value } : null;
  }
  if (field === 'weekly_target') {
    const cluster = CLUSTERS.find((c) => c === fieldKey(item.text ?? item.cluster));
    if (!cluster) return null;
    if (item.on === false || n === 0) return { target: 'setting', field, cluster, value: null };
    if (n == null) return null;
    const value = clamp(Math.round(n), WEEKLY_TARGET_LIMITS.min, WEEKLY_TARGET_LIMITS.max);
    return { target: 'setting', field, cluster, value };
  }
  const range = SETTING_NUMBERS[field];
  if (range) {
    if (n == null) return null;
    const snapped = Math.round(n / range.step) * range.step;
    return { target: 'setting', field, value: clamp(snapped, range.min, range.max) };
  }
  if (n == null) return null;
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
  // `set` is the place, as every set edit names it; a kind item wrote it as `number`.
  if (item.set != null && item.number == null) item = { ...item, number: item.set };
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
  // Only working sets are reachable, so a set is only ever corrected TO a warm-up.
  if (!set || kind === 'working') return null;
  return {
    target: 'workout_set',
    field: 'kind',
    id,
    exerciseId,
    setId: set.id,
    from: 'working',
    value: kind,
    // The phone's own day, as `aiContext` dates the log the model read: the UTC
    // prefix put a session started before dawn east of Greenwich on the day before.
    day: dayKey(workout.startedAt),
    position,
  };
}

/** Same thing changed twice in one card — the later one is what the model settled on. */
function identity(change: AiChange, seq: number): string {
  if (change.target === 'setting') return `setting:${change.field}:${change.cluster ?? ''}`;
  if (change.target === 'bodyweight') return 'bodyweight';
  if (change.target === 'workout_set' && change.field === 'kind') {
    return `workout_set:${change.setId}`;
  }
  if (change.target === 'exercise') return `exercise:${change.id}:${change.field}`;
  return editIdentity(change as EditChange, seq);
}

/** The model's target names, folded onto the ones this app has. */
const TARGET_ALIASES: Record<string, string> = {
  exercise: 'exercise',
  setting: 'setting',
  settings: 'setting',
  bodyweight: 'bodyweight',
  weight: 'bodyweight',
  workout_set: 'workout_set',
  set: 'workout_set',
  routine: 'routine',
  routine_item: 'routine_item',
  routine_exercise: 'routine_item',
  sequence: 'sequence',
  loop: 'sequence',
  workout: 'workout',
  session: 'workout',
  live: 'live',
  active_workout: 'live',
  live_set: 'live_set',
  active_set: 'live_set',
};

/** What survived, and how many items did not — the card says the second number. */
export interface ChangesReport {
  changes: AiChange[];
  dropped: number;
}

/**
 * The changes worth offering out of what the model wrote, and a count of the
 * rest. Unknown targets, unknown ids and fields a thing cannot take are all
 * dropped — see the file header.
 *
 * Two passes: things the card CREATES (an exercise, a routine) are read first,
 * so an item anywhere in the card may point at their handle — "make Farmer
 * carry and add it to Legs" is two items in either order.
 */
export function validateChangesReport(
  items: readonly unknown[],
  ctx: ChangeContext,
): ChangesReport {
  const exercises = new Map(ctx.exercises.filter((e) => !e.isArchived).map((e) => [e.id, e]));
  const routines = new Map<ID, EditRoutine>((ctx.routines ?? []).map((r) => [r.id, r]));
  const env: EditEnv = {
    exercises,
    routines,
    workouts: ctx.workouts ?? [],
    sequence: ctx.sequence,
    session: ctx.session,
    today: ctx.today,
    added: new Set(),
  };
  const recs = items.map((raw) => (isRec(raw) ? raw : null));
  const created = new Map<number, AiChange>();
  recs.forEach((raw, index) => {
    if (!raw || fieldKey(raw.field) !== 'create') return;
    const target = TARGET_ALIASES[fieldKey(raw.target)];
    if (target === 'exercise') {
      const change = validateExerciseCreate(raw, env);
      if (!change) return;
      created.set(index, change);
      // A stand-in row, so later items are checked against what it WILL be.
      exercises.set(
        change.ref,
        newExercise({
          id: change.ref,
          ownerId: '',
          name: change.name,
          muscle: change.muscle,
          kind: change.kind,
          restSeconds: ctx.restSeconds ?? 120,
          ladderAll: ctx.ladderAll === true,
        }),
      );
    } else if (target === 'routine') {
      const change = validateRoutineCreate(raw, env);
      if (!change) return;
      created.set(index, change);
      routines.set(change.id, { id: change.id, name: change.name, items: [] });
    }
  });

  const out = new Map<string, AiChange>();
  let dropped = 0;
  recs.forEach((raw, index) => {
    if (!raw) {
      dropped += 1;
      return;
    }
    const target = TARGET_ALIASES[fieldKey(raw.target)] ?? '';
    const field = fieldKey(raw.field);
    let change: AiChange | null = created.get(index) ?? null;
    if (change) {
      // Already read in the first pass.
    } else if (field === 'create') {
      change = null;
    } else if (target === 'exercise' && (field === 'delete' || field === 'remove')) {
      change = validateEdit('exercise_delete', raw, env);
    } else if (target === 'exercise') {
      const exercise = exercises.get(typeof raw.id === 'string' ? raw.id.trim() : '');
      change = exercise ? validateExerciseItem(raw, exercise) : null;
    } else if (target === 'setting') {
      change = validateSettingItem(raw);
    } else if (target === 'bodyweight') {
      change = validateBodyweightItem(raw);
    } else if (target === 'workout_set' && !isPastSetEdit(raw.field)) {
      // `kind`, or no field at all — how a set correction was written before 4.0.
      change = validateWorkoutSetItem(raw, ctx);
    } else if (target) {
      change = validateEdit(target, raw, env);
    }
    if (!change) {
      dropped += 1;
      return;
    }
    const id = identity(change, index);
    out.delete(id);
    out.set(id, change);
  });
  return { changes: [...out.values()], dropped };
}

/** The line under a card (or in place of one) saying what was left out. */
export function droppedNote(dropped: number, lang: Language): string {
  return t('{n} suggested changes could not be applied and were left out.', lang, { n: dropped });
}

/** `validateChangesReport` without the count. */
export function validateChanges(items: readonly unknown[], ctx: ChangeContext): AiChange[] {
  return validateChangesReport(items, ctx).changes;
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
    adjustStepSeconds?: number;
    prepareSeconds?: number;
    beepSeconds?: number;
    soundEnabled?: boolean;
    hapticsEnabled?: boolean;
    keepAwakeEnabled?: boolean;
    notifyOnTimerEnd?: boolean;
    ladderAllExercises?: boolean;
    unitSystem?: 'metric' | 'imperial';
    language?: Language;
    weeklySetTargets?: Partial<Record<MuscleCluster, number>>;
    weighInReminderEnabled?: boolean;
    weighInReminderDays?: readonly Weekday[];
    weighInReminderTime?: string;
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
  /** It takes something away — the card draws it in red. */
  destructive?: boolean;
  /**
   * A whole new order (`aiOrder.ts`): the index of its change in the card's
   * `changes`, whose `order` the card draws as rows to drag instead of `from → to`.
   */
  reorder?: number;
}

function onOff(value: boolean, lang: Language): string {
  return value ? t('On', lang) : t('Off', lang);
}

/** A ladder as the card's `from` says it: its max, waiting for a test, or off. */
function ladderState(e: Exercise, lang: Language): string {
  const ladder = ladderOf(e);
  if (!ladder) return t('Off', lang);
  return isAwaitingMax(ladder) ? t('MAX, then the ladder', lang) : String(ladder.max);
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
    case 'ladder':
      return {
        subject,
        label: tr('Rep ladder max'),
        from: ladderState(e, lang),
        to: change.value == null ? tr('Off') : String(change.value),
      };
    case 'find_max':
      return {
        subject,
        label: tr('Rep ladder'),
        from: ladderState(e, lang),
        to: tr('Find my max in the next workout'),
      };
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
    case 'name':
      return { subject, label: tr('Name'), from: e.name, to: String(change.value) };
    case 'muscles':
      return {
        subject,
        label: tr('Muscles'),
        from: e.muscleGroups.join(', '),
        to: (change.value as string[]).join(', '),
      };
    case 'kind':
      return {
        subject,
        label: tr('Exercise type'),
        from: kindLabel(kindOf(e), lang),
        to: kindLabel(change.value as ExerciseKind, lang),
      };
    case 'start_weight':
      return {
        subject,
        label: tr('Start weight'),
        from: e.defaultWeightKg != null ? `${e.defaultWeightKg} ${tr('kg')}` : '',
        to: `${String(change.value)} ${tr('kg')}`,
      };
    case 'timer': {
      const words: Record<TimerMode, string> = {
        manual: 'Manual',
        countdown: 'Countdown',
        countup: 'Count up',
      };
      return {
        subject,
        label: tr('Timer'),
        from: tr(words[e.timerMode ?? 'manual']),
        to: tr(words[change.value as TimerMode]),
      };
    }
    case 'duration_seconds':
      return {
        subject,
        label: tr('Set length'),
        from: e.defaultCount != null ? formatClock(e.defaultCount) : '',
        to: formatClock(change.value as number),
      };
    case 'distance_m':
      return {
        subject,
        label: tr('Distance'),
        from: e.defaultCount != null ? `${e.defaultCount} m` : '',
        to: `${String(change.value)} m`,
      };
  }
}

/** The labels and current values of the settings past the two rests. */
function settingRow(
  change: Extract<AiChange, { target: 'setting' }>,
  s: CurrentValues['settings'],
  lang: Language,
): ChangeRow {
  const tr = (k: string, vars?: Record<string, string | number>) => t(k, lang, vars);
  const subject = tr('Settings');
  const flagRow = (label: string, from: boolean | undefined) => ({
    subject,
    label: tr(label),
    from: from == null ? '' : onOff(from, lang),
    to: onOff(change.value === true, lang),
  });
  const secondsRow = (label: string, from: number | undefined) => ({
    subject,
    label: tr(label),
    from: from == null ? '' : `${from} s`,
    to: `${String(change.value)} s`,
  });
  const units = (u: unknown) =>
    u === 'imperial' ? tr('Pounds') : u === 'metric' ? tr('Kilograms') : '';
  const language = (l: unknown) => (l === 'ru' ? 'Русский' : l === 'en' ? 'English' : '');
  switch (change.field) {
    case 'auto_rest':
      return flagRow('Start rest automatically', s.autoStartRest);
    case 'sound':
      return flagRow('Sound', s.soundEnabled);
    case 'vibration':
      return flagRow('Vibration', s.hapticsEnabled);
    case 'keep_awake':
      return flagRow('Keep the screen on', s.keepAwakeEnabled);
    case 'timer_notifications':
      return flagRow('Notify when a timer ends', s.notifyOnTimerEnd);
    case 'ladder_all':
      return flagRow('Make every exercise a rep ladder', s.ladderAllExercises);
    case 'weigh_in_reminder':
      return flagRow('Remind me to weigh in', s.weighInReminderEnabled);
    case 'weigh_in_days': {
      const labels = weekdayLabels(lang);
      const days = (list: readonly Weekday[] | undefined) =>
        (list ?? []).map((d) => labels[d]).join(', ');
      return {
        subject: tr('Weigh-in reminder'),
        label: tr('On which days'),
        from: days(s.weighInReminderDays),
        to: days(change.value as Weekday[]),
      };
    }
    case 'weigh_in_time':
      return {
        subject: tr('Weigh-in reminder'),
        label: tr('At what time'),
        from: s.weighInReminderTime ?? '',
        to: String(change.value),
      };
    case 'timer_step':
      return secondsRow('Timer ± step', s.adjustStepSeconds);
    case 'get_ready':
      return secondsRow('Get ready', s.prepareSeconds);
    case 'beep_seconds':
      return secondsRow('Beep the last', s.beepSeconds);
    case 'units':
      return { subject, label: tr('Units'), from: units(s.unitSystem), to: units(change.value) };
    case 'language':
      return {
        subject,
        label: tr('Language'),
        from: language(s.language),
        to: language(change.value),
      };
    case 'weekly_target': {
      const from = change.cluster ? s.weeklySetTargets?.[change.cluster] : undefined;
      return {
        subject,
        label: tr('Weekly sets · {cluster}', { cluster: change.cluster ?? '' }),
        from: from == null ? tr('Off') : String(from),
        to: change.value == null ? tr('Off') : String(change.value),
      };
    }
    default: {
      const between = change.field === 'rest_between_sets';
      return {
        subject,
        label: between ? tr('Rest between sets') : tr('Rest between exercises'),
        from: formatClock(between ? s.restSecondsBetweenSets : s.restSecondsBetweenExercises),
        to: formatClock(change.value as number),
      };
    }
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
  // A field change on an exercise this same card creates reads it from its stand-in.
  for (const change of changes) {
    if (change.target !== 'exercise_create') continue;
    exercises.set(
      change.ref,
      newExercise({
        id: change.ref,
        ownerId: '',
        name: change.name,
        muscle: change.muscle,
        kind: change.kind,
        restSeconds: now.settings.restSecondsBetweenSets,
        ladderAll: now.settings.ladderAllExercises === true,
      }),
    );
  }
  for (const [index, change] of changes.entries()) {
    if (change.target === 'exercise') {
      const exercise = exercises.get(change.id);
      if (exercise)
        rows.push(exerciseRow(change, exercise, lang, now.settings.restSecondsBetweenSets));
      continue;
    }
    if (change.target === 'setting') {
      rows.push(settingRow(change, now.settings, lang));
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
    if (change.target === 'workout_set' && change.field === 'kind') {
      const name = exercises.get(change.exerciseId)?.name ?? '';
      rows.push({
        subject: `${name} · ${dayText(change.day)}`,
        label: t('Set {n}', lang, { n: change.position }),
        from: kindName(change.from, lang),
        to: kindName(change.value, lang),
      });
      continue;
    }
    const row = describeEdit(change as EditChange, lang, dayText);
    rows.push(change.target === 'order' ? { ...row, reorder: index } : row);
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
  now: Date = new Date(),
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
    case 'name':
      next.name = change.value as string;
      return next;
    case 'muscles':
      next.muscleGroups = [...(change.value as MuscleGroup[])];
      return next;
    case 'start_weight':
      /* Stamped like a weight set in the editor or by a routine proposal, so the
         next session starts here rather than at last session's carried weight. */
      next.defaultWeightKg = change.value as number;
      next.startWeightSetAt = now.toISOString();
      return next;
    case 'find_max':
      /* The editor's own button on the editor's own draft, then its `Save` —
         so a retest drops the earned reps and MAX goes off exactly as by hand. */
      return applyDraftToExercise(findMaxNextWorkout(exerciseToDraft(exercise)), exercise);
    case 'kind':
      /* Through the editor's own draft, so a unit switch drops a ladder or a
         weight the new kind cannot have exactly as `Save` would. */
      return applyDraftToExercise(
        draftWithKind(exerciseToDraft(exercise), change.value as ExerciseKind),
        exercise,
      );
    /* The timer, the set length and the distance, each through the editor's
       draft too: `draftToExercise` is what folds a length into `defaultCount`
       and drops the get-ready countdown when the timer goes back to manual. */
    case 'timer':
      return applyDraftToExercise(
        { ...exerciseToDraft(exercise), timerMode: change.value as TimerMode },
        exercise,
      );
    case 'duration_seconds':
      return applyDraftToExercise(
        { ...exerciseToDraft(exercise), durationSeconds: change.value as number },
        exercise,
      );
    case 'distance_m':
      return applyDraftToExercise(
        { ...exerciseToDraft(exercise), targetCount: change.value as number },
        exercise,
      );
  }
}
