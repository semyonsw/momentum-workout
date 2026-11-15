/**
 * The decisions behind the Workout section and Home's running-workout card
 * (the 2.9 findability redesign, #7 #11 #18, and 4.0's hero). Pure, so each one is
 * tested without a renderer; the screens are composition.
 *
 * ── WHERE YOU ARE, NOT HOW FAR ────────────────────────────────────────────
 *
 * Home's running card reads `28:40 · Bench press, set 3 of 4`. The set it names
 * is `upNextSet` — the one the session glows — so the card, the glow and Focus
 * can never point at three different sets. Counted among the exercise's WORKING
 * sets, as the set rows number them: a warm-up is a `W`, not "set 1", so an
 * up-next warm-up says `warm-up` instead of a number. With nothing left to log
 * the line falls back to the session's own count, `17 of 17 sets`.
 *
 * ── THE PROGRESS SPARKLINE IS VOLUME, AND ONLY THE HONEST KIND ─────────────
 *
 * Session volume over the last ten workouts, oldest first. A workout whose
 * volume is a floor (`volumeIsPartial`) or zero (all bodyweight with no
 * bodyweight set, all timed holds) is left out rather than drawn as a dip —
 * a line that drops because the user did planks is a line that lies. It is a
 * shape, not a chart: the numbers live behind `Graphs ›`. Rejected: workouts
 * per week (a count, not progress) and a top-set line (which exercise's?).
 *
 * ── ONE HERO, ONE START (4.0) ─────────────────────────────────────────────
 *
 * Home leads with ONE routine and one large `Start`. With the training
 * sequence on, it is the sequence's turn. With it off, it is the routine after
 * the one you trained last, in list order, wrapping — the order people already
 * file Push · Pull · Legs in — and the first openable one on a phone that has
 * trained nothing. Rejected: the routine trained longest ago (a routine tried
 * once and abandoned would sit in the hero forever) and no hero without a
 * sequence (the screen then opened on a list, and "which one do I press" was
 * the question the owner asked to remove). It only suggests: every other
 * routine is right under it with its own `Start`.
 *
 * The floating ▶ that used to fold from `▶ Open Push` to a circle went with it:
 * the hero's button is the start, and once the hero scrolls away the capsule
 * at the top carries the same ▶ (`components/FloatingBubble.tsx`).
 *
 * ── AN EMPTY WORKOUT IS A ROUTINE WITH NO ID ───────────────────────────────
 *
 * `Start an empty workout` builds the session from a routine with no items and
 * an EMPTY id, never stored in the library. Every reader of `routineId` in the
 * app already tests it for truthiness (`buildCompletedWorkout`, the sequence
 * advance, the plan diff), so `''` reads as "not from a routine"
 * everywhere without a new code path. The session screen's own empty state is
 * what greets it — `Add an exercise` — which is the next thing to do anyway.
 */

import type { CompletedWorkout } from './completedWorkout';
import type { DraftSession } from './draft';
import { t, type Language } from './i18n';
import { upNextSet } from './upNext';
import type { ID, Routine } from '../types/models';

/* ------------------------------------------------------------------ */
/* #7 — Home's running-workout card                                   */
/* ------------------------------------------------------------------ */

export type RunningSet =
  | { kind: 'set'; exercise: string; set: number; of: number }
  | { kind: 'warmup'; exercise: string }
  | { kind: 'done'; done: number; total: number };

/** The set the session is up to, as the running card names it. */
export function runningSet(session: DraftSession | null): RunningSet | null {
  if (!session) return null;
  const next = upNextSet(session);
  if (!next) {
    let total = 0;
    for (const entry of session.entries) total += entry.sets.length;
    return { kind: 'done', done: total, total };
  }
  const entry = session.entries.find((e) => e.localId === next.entryId);
  const set = entry?.sets.find((s) => s.localId === next.setId);
  if (!entry || !set) return null;
  if (set.isWarmup) return { kind: 'warmup', exercise: entry.exercise.name };
  const working = entry.sets.filter((s) => !s.isWarmup);
  return {
    kind: 'set',
    exercise: entry.exercise.name,
    set: working.findIndex((s) => s.localId === set.localId) + 1,
    of: working.length,
  };
}

/** `28:40 · Bench press, set 3 of 4` — the card's second line. */
export function describeRunningSet(running: RunningSet | null, time: string, lang: Language) {
  if (!running) return time;
  switch (running.kind) {
    case 'set':
      return t('{time} · {exercise}, set {set} of {of}', lang, {
        time,
        exercise: running.exercise,
        set: running.set,
        of: running.of,
      });
    case 'warmup':
      return t('{time} · {exercise}, warm-up', lang, { time, exercise: running.exercise });
    case 'done':
      return `${time} · ${t('{done} of {total} sets', lang, {
        done: running.done,
        total: running.total,
      })}`;
  }
}

/* ------------------------------------------------------------------ */
/* 4.0 — the hero                                                     */
/* ------------------------------------------------------------------ */

/** What the hero needs to know about a routine to suggest it. */
export interface HeroCandidate {
  routineId: ID;
  exerciseCount: number;
  /** ISO time it was last trained, or null if never. */
  lastTrainedAt: string | null;
}

/**
 * The routine Home's hero suggests, or null when nothing can be opened. See
 * the file header: the sequence's turn, else the openable routine after the
 * one trained last (list order, wrapping), else the first openable one.
 */
export function suggestedRoutine<C extends HeroCandidate>(
  choices: readonly C[],
  sequenceNext: C | null,
): C | null {
  if (sequenceNext) return sequenceNext;
  const openable = choices.filter((choice) => choice.exerciseCount > 0);
  if (openable.length === 0) return null;
  let last = -1;
  openable.forEach((choice, index) => {
    const at = choice.lastTrainedAt;
    if (at == null) return;
    const best = last >= 0 ? openable[last].lastTrainedAt : null;
    if (best == null || at > best) last = index;
  });
  return openable[(last + 1) % openable.length];
}

/* ------------------------------------------------------------------ */
/* #11 — the Progress card                                            */
/* ------------------------------------------------------------------ */

export const PROGRESS_SPARK_COUNT = 10;

/**
 * The sparkline's points: whole volumes of the last `count` workouts that have
 * one, oldest first, with a band padded so a flat run does not draw on the floor.
 * Null under two points — one point is not a shape.
 */
export function progressSpark(
  workouts: readonly CompletedWorkout[],
  count: number = PROGRESS_SPARK_COUNT,
): { values: number[]; min: number; max: number } | null {
  const values = workouts
    .filter((w) => !w.volumeIsPartial && w.totalVolumeKg > 0)
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0))
    .slice(-count)
    .map((w) => w.totalVolumeKg);
  if (values.length < 2) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max((high - low) * 0.15, high * 0.05, 1);
  return { values, min: Math.max(0, low - pad), max: high + pad };
}

/* ------------------------------------------------------------------ */
/* #18 — Start an empty workout                                       */
/* ------------------------------------------------------------------ */

/** The routine an empty workout is built from. See the file header. */
export function emptyWorkoutRoutine(input: { name: string; ownerId: ID; now: Date }): Routine {
  const at = input.now.toISOString();
  return {
    id: '',
    ownerId: input.ownerId,
    name: input.name,
    items: [],
    createdAt: at,
    updatedAt: at,
  };
}
