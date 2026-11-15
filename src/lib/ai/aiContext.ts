/**
 * What the assistant is allowed to know — built on the phone, from the stores,
 * and small.
 *
 *   buildWorkoutContext   routines, the library's names, the last 20 weeks of
 *                         sessions in the app's own shorthand, per-exercise
 *                         rollups, sets per cluster
 *
 * ── NEVER THE WHOLE DATABASE ───────────────────────────────────────────────
 *
 * A year of training is thousands of set rows, and a model given all of them
 * does worse arithmetic than a model given the summary the app would have drawn
 * anyway. So each builder hands over what a screen of this app already shows —
 * `CompletedExercise.summary` is literally the shorthand the history list prints
 * — and stays under `CONTEXT_CAP` characters by shedding the OLDEST detail first.
 *
 * ── THE SAME RULES AS EVERY OTHER SCREEN ───────────────────────────────────
 *
 * Warm-ups count towards nothing (the shorthand already drops them, and every
 * rollup here filters on `isWarmup`).
 *
 * Everything returns the JSON string plus the two or three facts the chat needs
 * about it: how much was read (for "Reading 91 workouts…") and the names the
 * suggested prompts are built from.
 */

import { clusterBalance } from '../balance';
import { dayKey } from '../days';
import { MUSCLE_CLUSTER } from '../muscles';
import { isAwaitingMax, ladderOf } from '../repLadder';
import { ownRestSeconds } from '../rest';
import { plannedStartWeight } from '../weightCarry';
import type { CompletedWorkout } from '../completedWorkout';
import type { BodyweightEntry } from '../bodyweightLog';
import { exerciseBests } from '../records';
import type { Language } from '../i18n';
import type {
  Exercise,
  ID,
  Routine,
  SetHistory,
  TrainingSequence,
  UnitSystem,
} from '../../types/models';

/** How many of the newest sessions carry their id — see `sessionRows`. */
export const ID_SESSIONS = 30;

/**
 * The size every context is held under, in characters of JSON.
 *
 * 400,000 — about 100,000 tokens, a tenth of the model's window. At 24,000 the
 * shedding loops were the normal path rather than the safety net: the workout
 * chat saw 60 sessions at most. "What did I do in March?" had no
 * answer because March had been thrown away before the question was asked. A
 * year of everything the app records is ~300 KB, so this sends ALL of it for
 * any realistic log and still sheds oldest-first past that.
 *
 * Before that:
 * 24,000 — about 6,000 tokens. It was 6,000, then 12,000 once the contexts
 * carried what the user WROTE (the answers after a workout), and then the
 * all-time records and the bodyweight line. Each time the shedding loops were
 * throwing away exactly the parts the model cannot work out from the numbers.
 * Still a rounding error against the model's window, and the oldest detail
 * still goes first.
 */
export const CONTEXT_CAP = 400_000;

export const LANGUAGE_NAME: Record<Language, string> = { ru: 'Russian', en: 'English' };

/* ------------------------------------------------------------------ */
/* Workout                                                             */
/* ------------------------------------------------------------------ */

export interface WorkoutContextInput {
  exercises: readonly Exercise[];
  routines: readonly Routine[];
  /** Newest first, as the history store holds them. */
  workouts: readonly CompletedWorkout[];
  numbers?: Record<ID, number>;
  bodyweightKg?: number;
  unitSystem: UnitSystem;
  lang: Language;
  now?: Date;
  weeks?: number;
  /** The training sequence — the loop of routines the user trains in order. */
  sequence?: TrainingSequence;
  /** Bodyweight readings, any order — the line the records are weighed against. */
  bodyweightLog?: readonly BodyweightEntry[];
  /**
   * The app's own workout settings — what a `changes_proposal` of target
   * `setting` would move. Absent: no `settings` key, and the model has no
   * `from` to reason about, so it is told nothing rather than a guess.
   */
  settings?: WorkoutSettings;
  /**
   * The workout in flight, if one is open — what a `live` / `live_set` item
   * points at. Every row, warm-ups included, in order: `set` 1 is the first row
   * on the card.
   */
  live?: LiveWorkout | null;
  /** Overrides `CONTEXT_CAP` — for tests that exercise the shedding. */
  cap?: number;
}

/** The three settings the assistant may suggest changing (`lib/ai/aiChanges.ts`). */
export interface WorkoutSettings {
  restSecondsBetweenSets: number;
  restSecondsBetweenExercises: number;
  autoStartRest: boolean;
  /* The rest of what Workout settings holds — each optional, each the `from` of a
     `setting` item of the same name in the prompt. */
  adjustStepSeconds?: number;
  prepareSeconds?: number;
  beepSeconds?: number;
  soundEnabled?: boolean;
  hapticsEnabled?: boolean;
  keepAwakeEnabled?: boolean;
  notifyOnTimerEnd?: boolean;
  ladderAllExercises?: boolean;
  weeklySetTargets?: Partial<Record<string, number>>;
  /** The weigh-in reminder — days Monday = 0, time `HH:MM`. */
  weighInReminderEnabled?: boolean;
  weighInReminderDays?: readonly number[];
  weighInReminderTime?: string;
}

/** The open session, as much of it as an edit needs. */
export interface LiveWorkout {
  title: string;
  started: boolean;
  entries: readonly {
    exercise: Pick<Exercise, 'id' | 'name'>;
    sets: readonly {
      weightKg: number | null;
      count: number;
      isWarmup: boolean;
      isCompleted: boolean;
    }[];
  }[];
}

export interface WorkoutContext {
  json: string;
  /** Workouts in the window that was sent — the chat's "Reading 91 workouts…". */
  workoutCount: number;
  /** The most-trained loaded lift, for "How is my bench press going?". */
  topLift: string | null;
  /** The routine trained most recently that still exists, for "Improve my Push". */
  lastRoutine: { id: ID; name: string } | null;
}

const DAY_MS = 86_400_000;

/** `rest 90s, sets 4, target 10, step 2.5 kg` — an exercise's own settings, compactly. */
function exerciseSettings(e: Exercise): string {
  const own = ownRestSeconds(e);
  const out = [own == null ? 'rest follows setting' : `rest ${own}s`];
  if (e.defaultSets != null) out.push(`sets ${e.defaultSets}`);
  // A ladder's number IS its max — already said as `rep ladder max`.
  if (e.defaultCount != null && !ladderOf(e)) out.push(`target ${e.defaultCount}`);
  if (e.countUnit === 'reps' && e.countToMax === true) out.push('MAX mode');
  if (e.requiresWeight && e.incrementKg != null) out.push(`step ${e.incrementKg} kg`);
  if (e.countUnit !== 'reps' && e.prepareSeconds != null)
    out.push(`get-ready ${e.prepareSeconds}s`);
  return out.join(', ');
}

function repsLabel(min?: number, max?: number): string | null {
  if (min != null && max != null && min !== max) return `${min}-${max}`;
  const one = max ?? min;
  return one != null ? String(one) : null;
}

/** Oldest → newest top weight, as a direction. Two points or it is `flat`. */
function direction(values: readonly number[]): 'up' | 'down' | 'flat' {
  if (values.length < 2) return 'flat';
  const first = values[0];
  const last = values[values.length - 1];
  if (last > first) return 'up';
  if (last < first) return 'down';
  return 'flat';
}

interface Rollup {
  id: ID;
  name: string;
  s4: number;
  s20: number;
  /** "60x8": the heaviest working set of the window and its reps. */
  top: string | null;
  trend: 'up' | 'down' | 'flat';
}

/** The last session's top-set weight for every exercise that has one. */
export function lastTopWeights(workouts: readonly CompletedWorkout[]): Record<ID, number> {
  const out: Record<ID, number> = {};
  // Newest first, so the first weight met for an exercise is its latest.
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      if (out[exercise.exerciseId] == null && exercise.topWeightKg != null) {
        out[exercise.exerciseId] = exercise.topWeightKg;
      }
    }
  }
  return out;
}

/**
 * The weight each weighted exercise STARTS AT next session — what the prefill will
 * actually put in the cell (`buildDraftEntry`): a starting weight planned since
 * the last session (`plannedStartWeight`), else the last session's top set, else
 * nothing. A proposal's "was" and the model's view of the routine both read this,
 * so an applied weight reads as applied instead of as the same change forever.
 */
export function nextStartWeights(
  exercises: readonly Exercise[],
  workouts: readonly CompletedWorkout[],
): Record<ID, number> {
  const out = lastTopWeights(workouts);
  const lastAt: Record<ID, string> = {};
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      const at = lastAt[exercise.exerciseId];
      if (at == null || workout.startedAt > at) lastAt[exercise.exerciseId] = workout.startedAt;
    }
  }
  for (const exercise of exercises) {
    const planned = plannedStartWeight(exercise, lastAt[exercise.id]);
    if (planned != null) out[exercise.id] = planned;
  }
  return out;
}

/**
 * The two names the workout prompts are built from, cheaply enough for the home
 * screen's card to ask on every render of the log.
 *
 *   topLift      the loaded rep lift trained in the most sessions over four
 *                weeks (then twenty), a barbell lift first — "bench press"
 *   lastRoutine  the routine behind the most recent workout that still exists,
 *                else the first routine with anything in it
 */
export function workoutFacts(input: {
  exercises: readonly Exercise[];
  routines: readonly Routine[];
  workouts: readonly CompletedWorkout[];
  now?: Date;
}): Pick<WorkoutContext, 'topLift' | 'lastRoutine'> {
  const { exercises, routines, workouts } = input;
  const now = (input.now ?? new Date()).getTime();
  const byId: Record<ID, Exercise> = Object.fromEntries(exercises.map((e) => [e.id, e]));
  const counts = new Map<ID, { s4: number; s20: number }>();
  for (const workout of workouts) {
    const age = now - new Date(workout.startedAt).getTime();
    if (age > 20 * 7 * DAY_MS) continue;
    for (const done of workout.exercises) {
      if (done.setCount <= 0) continue;
      const exercise = byId[done.exerciseId];
      if (!exercise || !exercise.requiresWeight || exercise.countUnit !== 'reps') continue;
      const count = counts.get(exercise.id) ?? { s4: 0, s20: 0 };
      count.s20 += 1;
      if (age <= 28 * DAY_MS) count.s4 += 1;
      counts.set(exercise.id, count);
    }
  }
  const ranked = [...counts.entries()].sort(
    ([a, ca], [b, cb]) =>
      Number(byId[b].equipment === 'barbell') - Number(byId[a].equipment === 'barbell') ||
      cb.s4 - ca.s4 ||
      cb.s20 - ca.s20,
  );
  const topLift = ranked.length > 0 ? byId[ranked[0][0]].name : null;

  const byRoutineId = new Map(routines.map((r) => [r.id, r]));
  const recent = [...workouts].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  let lastRoutine: WorkoutContext['lastRoutine'] = null;
  for (const workout of recent) {
    const routine = workout.routineId ? byRoutineId.get(workout.routineId) : undefined;
    if (routine) {
      lastRoutine = { id: routine.id, name: routine.name };
      break;
    }
  }
  if (!lastRoutine) {
    const first = routines.find((r) => r.items.length > 0);
    if (first) lastRoutine = { id: first.id, name: first.name };
  }
  return { topLift, lastRoutine };
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The settings, every key only where it is set — a `from` for each setting item. */
function compactSettings(s: WorkoutSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {
    restSecondsBetweenSets: s.restSecondsBetweenSets,
    restSecondsBetweenExercises: s.restSecondsBetweenExercises,
    autoStartRest: s.autoStartRest,
  };
  const rest: [string, unknown][] = [
    ['timerStepSeconds', s.adjustStepSeconds],
    ['getReadySeconds', s.prepareSeconds],
    ['beepSeconds', s.beepSeconds],
    ['sound', s.soundEnabled],
    ['vibration', s.hapticsEnabled],
    ['keepAwake', s.keepAwakeEnabled],
    ['timerNotifications', s.notifyOnTimerEnd],
    ['ladderAll', s.ladderAllExercises],
  ];
  for (const [name, value] of rest) if (value != null) out[name] = value;
  if (s.weeklySetTargets && Object.keys(s.weeklySetTargets).length > 0) {
    out.weeklySetTargets = s.weeklySetTargets;
  }
  // Days by NAME, as a `weigh_in_days` item writes them back.
  if (s.weighInReminderEnabled != null) {
    out.weighInReminder = {
      on: s.weighInReminderEnabled,
      days: (s.weighInReminderDays ?? []).map((d) => DAY_NAMES[d] ?? String(d)),
      time: s.weighInReminderTime,
    };
  }
  return out;
}

/**
 * The open workout: one line per exercise card, its rows as `60x8✓` (logged),
 * `60x8` (to do), `W 30x8` (a warm-up) — `set` N of a `live_set` is the Nth.
 */
function liveRows(live: LiveWorkout): Record<string, unknown> {
  return {
    title: live.title,
    started: live.started,
    exercises: live.entries.map((entry) => ({
      exerciseId: entry.exercise.id,
      name: entry.exercise.name,
      sets: entry.sets.map(
        (set) =>
          `${set.isWarmup ? 'W ' : ''}${set.weightKg != null ? `${set.weightKg}x` : ''}${set.count}${set.isCompleted ? '✓' : ''}`,
      ),
    })),
  };
}

export function buildWorkoutContext(input: WorkoutContextInput): WorkoutContext {
  const { exercises, routines, workouts, numbers = {}, bodyweightKg, unitSystem, lang } = input;
  const now = input.now ?? new Date();
  const cap = input.cap ?? CONTEXT_CAP;
  const weeks = input.weeks ?? 20;
  const byId: Record<ID, Exercise> = Object.fromEntries(exercises.map((e) => [e.id, e]));
  const windowStart = now.getTime() - weeks * 7 * DAY_MS;
  const fourWeeks = now.getTime() - 28 * DAY_MS;

  const inWindow = workouts
    .filter((w) => new Date(w.startedAt).getTime() >= windowStart)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  /* Per exercise, from the working rows of the window. */
  const rows = new Map<ID, SetHistory[]>();
  for (const workout of inWindow) {
    for (const set of workout.sets) {
      if (set.isWarmup || !set.isCompleted) continue;
      const bucket = rows.get(set.exerciseId);
      if (bucket) bucket.push(set);
      else rows.set(set.exerciseId, [set]);
    }
  }
  const rollups: Rollup[] = [];
  for (const [id, sets] of rows) {
    const sessions = new Map<string, SetHistory[]>();
    for (const set of sets) {
      const bucket = sessions.get(set.sessionId);
      if (bucket) bucket.push(set);
      else sessions.set(set.sessionId, [set]);
    }
    const ordered = [...sessions.values()].sort((a, b) =>
      a[0].performedAt.localeCompare(b[0].performedAt),
    );
    const tops = ordered
      .map((group) => Math.max(...group.map((s) => s.weightKg ?? -1)))
      .filter((w) => w >= 0);
    let best: SetHistory | null = null;
    for (const set of sets) {
      if (set.weightKg == null) continue;
      if (
        !best ||
        set.weightKg > (best.weightKg ?? 0) ||
        (set.weightKg === best.weightKg && set.count > best.count)
      ) {
        best = set;
      }
    }
    rollups.push({
      id,
      name: byId[id]?.name ?? sets[0].exerciseId,
      s4: ordered.filter((g) => new Date(g[0].performedAt).getTime() >= fourWeeks).length,
      s20: ordered.length,
      top: best ? `${best.weightKg}x${best.count}` : null,
      trend: direction(tops),
    });
  }
  rollups.sort((a, b) => b.s20 - a.s20);

  const balance = clusterBalance({ workouts, exercisesById: byId, windowDays: 28, now });
  const setsPerCluster4w = Object.fromEntries(
    balance.clusters.filter((c) => c.sets > 0).map((c) => [c.cluster, c.sets]),
  );

  // What the next session will prefill — the numbers a proposal is compared with.
  const startWeights = nextStartWeights(exercises, workouts);
  const routineRows = routines.map((routine) => {
    const sorted = [...routine.items].sort((a, b) => a.order - b.order);
    return {
      id: routine.id,
      name: routine.name,
      exercises: sorted
        .filter((item) => byId[item.exerciseId])
        .map((item) => {
          const exercise = byId[item.exerciseId];
          const row: Record<string, unknown> = {
            exerciseId: exercise.id,
            name: exercise.name,
            sets: item.targetSets,
          };
          const reps = repsLabel(item.targetRepsMin, item.targetRepsMax);
          if (reps) row.reps = reps;
          if (exercise.countUnit !== 'reps') row.unit = exercise.countUnit;
          if (exercise.requiresWeight) {
            const kg = startWeights[exercise.id] ?? exercise.defaultWeightKg;
            if (kg != null) row.weightKg = kg;
          }
          const ladder = ladderOf(exercise);
          // A waiting ladder's max is a placeholder — the next workout tests it.
          if (ladder) row.ladder = isAwaitingMax(ladder) ? 'max test next workout' : ladder.max;
          if (exercise.cue?.trim()) row.cue = exercise.cue.trim();
          return row;
        }),
    };
  });

  /*
   * The library, one line per exercise: id, name, where it files, and what kind
   * of exercise it is — what it counts, how it is loaded, where it starts, its
   * ladder. "Swap bench for something easier on the shoulder" needs to know
   * what else is there and what each one IS, not only what it is called.
   *
   * Then its own SETTINGS, the values a `changes_proposal` would move: rest,
   * default sets, target, MAX, weight step, get-ready countdown — each only
   * where it is set and means something for this kind of exercise, in the
   * units the change is written in (seconds, kg), so "my rest on bench is 2:00,
   * make it 1:30" has a `from` the model can read rather than guess.
   */
  const library = exercises
    .filter((e) => !e.isArchived)
    .map((e) => {
      const muscle = e.muscleGroups[0];
      const parts = [e.id, e.name];
      if (muscle) parts.push(`${MUSCLE_CLUSTER[muscle]} > ${e.muscleGroups.join(', ')}`);
      const kind: string[] = [e.countUnit];
      if (e.loadMode !== 'external') kind.push(e.loadMode);
      if (e.isUnilateral) kind.push('one side at a time');
      if (e.requiresWeight && e.defaultWeightKg != null)
        kind.push(`starts ${e.defaultWeightKg} kg`);
      const ladder = ladderOf(e);
      if (ladder) {
        kind.push(
          isAwaitingMax(ladder)
            ? 'rep ladder awaiting max (first set of the next workout is a max test)'
            : `rep ladder max ${ladder.max}`,
        );
      }
      parts.push(kind.join(', '));
      parts.push(exerciseSettings(e));
      // The user's own one-line form note — words the numbers cannot carry.
      if (e.cue?.trim()) parts.push(`cue: ${e.cue.trim()}`);
      return parts.join(' | ');
    });

  /*
   * ALL-TIME, not the window: the heaviest set, the most reps, when it was last
   * trained and how many sessions it has — the same bests the exercise screen
   * shows, from the whole log, so "is this a PR?" has an answer.
   */
  const bodyweights = [...(input.bodyweightLog ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  const bodyweightOn = (at: string): number | null => {
    let found: number | null = bodyweightKg ?? null;
    for (const entry of bodyweights) {
      if (entry.at > at) break;
      found = entry.kg;
    }
    return found;
  };
  const allSets = workouts.flatMap((w) => w.sets);
  const setsByExercise = new Map<ID, SetHistory[]>();
  const sessionsByExercise = new Map<ID, Set<string>>();
  const lastByExercise = new Map<ID, string>();
  for (const set of allSets) {
    if (set.isWarmup || !set.isCompleted) continue;
    const bucket = setsByExercise.get(set.exerciseId);
    if (bucket) bucket.push(set);
    else setsByExercise.set(set.exerciseId, [set]);
    const sessions = sessionsByExercise.get(set.exerciseId) ?? new Set<string>();
    sessions.add(set.sessionId);
    sessionsByExercise.set(set.exerciseId, sessions);
    const last = lastByExercise.get(set.exerciseId);
    if (!last || set.performedAt > last) lastByExercise.set(set.exerciseId, set.performedAt);
  }
  const records = [...setsByExercise.entries()]
    .map(([id, sets]) => {
      const exercise = byId[id];
      if (!exercise) return null;
      const bests = exerciseBests(sets, exercise, bodyweightOn);
      const row: Record<string, unknown> = {
        name: exercise.name,
        sessions: sessionsByExercise.get(id)?.size ?? 0,
        last: dayKey(lastByExercise.get(id) ?? ''),
      };
      if (bests.heaviest) {
        row.heaviest = `${bests.heaviest.weightKg ?? bests.heaviest.value}x${bests.heaviest.count} on ${dayKey(bests.heaviest.at)}`;
      }
      if (bests.mostCount) {
        row[`most_${exercise.countUnit}`] =
          `${bests.mostCount.value} on ${dayKey(bests.mostCount.at)}`;
      }
      return row;
    })
    .filter((row): row is Record<string, unknown> => row != null)
    .sort((a, b) => (b.sessions as number) - (a.sessions as number));
  let recordLimit = records.length;

  /* Sessions per week, the last twelve weeks, oldest first — the frequency line. */
  const weekly: string[] = [];
  for (let back = 11; back >= 0; back -= 1) {
    const end = now.getTime() - back * 7 * DAY_MS;
    const start = end - 7 * DAY_MS;
    const count = workouts.filter((w) => {
      const at = new Date(w.startedAt).getTime();
      return at > start && at <= end;
    }).length;
    weekly.push(`${dayKey(new Date(start + DAY_MS))}:${count}`);
  }

  const ordered = [...workouts].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const allTime = {
    workouts: workouts.length,
    ...(ordered[0] ? { firstWorkout: dayKey(ordered[0].startedAt) } : {}),
    ...(ordered.length ? { lastWorkout: dayKey(ordered[ordered.length - 1].startedAt) } : {}),
  };
  const bodyweightLine = bodyweights.map((e) => `${dayKey(e.at)}:${e.kg}`);

  /*
   * EVERY session, newest first — not the window. The rollups and verdicts
   * above read the last 20 weeks because they are about the current block;
   * "when did I last do legs before the summer?" is about the whole log.
   */
  const allSessions = [...workouts].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const sessionRows = allSessions.map((w, i) => {
    const row: Record<string, unknown> = { date: dayKey(w.startedAt) };
    /* The id, on the newest sessions only: it is what a set correction ("that
       first set on Monday was a warm-up") names, and nobody corrects a set from
       last year — so the older rows do not pay for it. */
    if (i < ID_SESSIONS) row.id = w.id;
    /* And which exercise each `ex` line is — a set edit names it, and a line's
       name is a snapshot that a rename since has left behind. Same order as `ex`. */
    if (i < ID_SESSIONS) {
      row.exIds = w.exercises.filter((e) => e.setCount > 0).map((e) => e.exerciseId);
    }
    if (numbers[w.id] != null) row.n = numbers[w.id];
    row.routine = w.title;
    if (w.routineId) row.routineId = w.routineId;
    row.min = w.durationMinutes;
    row.sets = w.setCount;
    if (w.effort) row.feel = w.effort;
    row.ex = w.exercises.filter((e) => e.setCount > 0).map((e) => `${e.name}: ${e.summary}`);
    return row;
  });

  /*
   * THE LOOP. A user who trains Push → Pull → Legs → again has told the app the
   * order, and the Home screen follows it; without it here the model was asked
   * "do you see my routines loop?" about a fact it had never been given.
   * Resolved to names, in order, with the one that is up next.
   */
  const routineName = new Map(routines.map((r) => [r.id, r.name]));
  const steps = (input.sequence?.routineIds ?? [])
    .map((id) => ({ id, name: routineName.get(id) }))
    .filter((step): step is { id: ID; name: string } => step.name != null);
  const sequence =
    input.sequence?.isActive && steps.length > 0
      ? {
          on: true,
          order: steps.map((step) => step.name),
          routineIds: steps.map((step) => step.id),
          next: steps[((input.sequence.cursor % steps.length) + steps.length) % steps.length].name,
          note: 'the user trains these routines in this order and then starts over',
        }
      : { on: false, note: 'no training sequence is set; the user picks a routine each time' };

  const base = {
    today: dayKey(now),
    language: LANGUAGE_NAME[lang],
    units: unitSystem === 'imperial' ? 'lb (numbers below are kg)' : 'kg',
    ...(bodyweightKg != null ? { bodyweightKg } : {}),
    ...(input.settings ? { settings: compactSettings(input.settings) } : {}),
    routines: routineRows,
    sequence,
    ...(input.live ? { live: liveRows(input.live) } : {}),
  };

  /*
   * Fit under the cap by shedding the oldest detail first: sessions from the
   * back of the window, then the library's names past what any routine or
   * session mentions, then the tail of the rollups.
   */
  const referenced = new Set<ID>([
    ...rows.keys(),
    ...routines.flatMap((r) => r.items.map((i) => i.exerciseId)),
  ]);
  let sessionLimit = sessionRows.length;
  let libraryRows = library;
  let rollupLimit = rollups.length;
  const render = () =>
    JSON.stringify({
      ...base,
      library: libraryRows,
      sessions: sessionRows.slice(0, sessionLimit),
      perExercise: rollups.slice(0, rollupLimit).map((r) => ({
        name: r.name,
        sessions4w: r.s4,
        sessions20w: r.s20,
        ...(r.top ? { topKgXReps: r.top } : {}),
        trend: r.trend,
      })),
      setsPerCluster4w,
      allTime,
      sessionsPerWeek12w: weekly,
      ...(bodyweightLine.length ? { bodyweightKgLog: bodyweightLine } : {}),
      ...(recordLimit > 0 ? { recordsAllTime: records.slice(0, recordLimit) } : {}),
    });

  let json = render();
  while (json.length > cap && sessionLimit > 6) {
    sessionLimit = Math.max(6, Math.floor(sessionLimit * 0.75));
    json = render();
  }
  if (json.length > cap) {
    libraryRows = exercises
      .filter((e) => !e.isArchived && referenced.has(e.id))
      .map((e) => `${e.id} | ${e.name}`);
    json = render();
  }
  while (json.length > cap && rollupLimit > 5) {
    rollupLimit = Math.max(5, rollupLimit - 5);
    json = render();
  }
  while (json.length > cap && recordLimit > 10) {
    recordLimit = Math.max(10, recordLimit - 5);
    json = render();
  }
  while (json.length > cap && sessionLimit > 1) {
    sessionLimit -= 1;
    json = render();
  }
  while (json.length > cap && recordLimit > 0) {
    recordLimit -= 1;
    json = render();
  }

  const facts = workoutFacts({ exercises, routines, workouts, now });
  return {
    json,
    workoutCount: Math.min(sessionLimit, sessionRows.length),
    ...facts,
  };
}
