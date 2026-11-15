import { describe, expect, it } from 'vitest';

import type { CompletedWorkout } from './completedWorkout';
import { buildDraftSession, type DraftSession } from './draft';
import {
  describeRunningSet,
  emptyWorkoutRoutine,
  progressSpark,
  runningSet,
  suggestedRoutine,
} from './workoutHome';
import type { Exercise, Routine } from '../types/models';

/**
 * The Workout section's and Home's decisions (redesign #7 #8 #11 #18): which set
 * the running card names, which routine the hero suggests, what the sparkline draws, and the
 * routine an empty workout is built from.
 */

function exercise(id: string, name: string): Exercise {
  return {
    id,
    ownerId: 'u1',
    name,
    muscleGroups: ['chest'],
    requiresWeight: true,
    countUnit: 'reps',
    loadMode: 'external',
    isUnilateral: false,
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const bench = exercise('ex_bench', 'Bench press');
const fly = exercise('ex_fly', 'Cable fly');

function session(items: [Exercise, number][]): DraftSession {
  const routine: Routine = {
    id: 'r1',
    ownerId: 'u1',
    name: 'Push',
    items: items.map(([ex, targetSets], order) => ({
      id: `ri${order}`,
      exerciseId: ex.id,
      order,
      targetSets,
      targetRepsMax: 8,
    })),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return buildDraftSession({
    routine,
    exercisesById: Object.fromEntries(items.map(([ex]) => [ex.id, ex])),
    historyByExerciseId: {},
    unitSystem: 'metric',
    defaultRestSeconds: 120,
    now: new Date('2026-10-30T18:00:00.000Z'),
  });
}

/** Log sets by [entry, set] at increasing minutes. */
function logged(s: DraftSession, done: [number, number][]): DraftSession {
  let out = s;
  done.forEach(([e, i], minute) => {
    out = {
      ...out,
      entries: out.entries.map((entry, ei) =>
        ei === e
          ? {
              ...entry,
              sets: entry.sets.map((set, si) =>
                si === i
                  ? {
                      ...set,
                      isCompleted: true,
                      completedAt: new Date(Date.UTC(2026, 9, 30, 18, minute)).toISOString(),
                    }
                  : set,
              ),
            }
          : entry,
      ),
    };
  });
  return out;
}

describe('the running card (#7)', () => {
  it('names the up-next set among the working sets', () => {
    const s = logged(
      session([
        [bench, 4],
        [fly, 3],
      ]),
      [
        [0, 0],
        [0, 1],
      ],
    );
    expect(runningSet(s)).toEqual({ kind: 'set', exercise: 'Bench press', set: 3, of: 4 });
    expect(describeRunningSet(runningSet(s), '28:40', 'en')).toBe(
      '28:40 · Bench press, set 3 of 4',
    );
    expect(describeRunningSet(runningSet(s), '28:40', 'ru')).toBe(
      '28:40 · Bench press, подход 3 из 4',
    );
  });

  it('does not count a warm-up as set 1', () => {
    const base = session([[bench, 3]]);
    const s: DraftSession = {
      ...base,
      entries: [
        {
          ...base.entries[0],
          sets: [{ ...base.entries[0].sets[0], isWarmup: true }, ...base.entries[0].sets.slice(1)],
        },
      ],
    };
    expect(runningSet(s)).toEqual({ kind: 'warmup', exercise: 'Bench press' });
    const after = logged(s, [[0, 0]]);
    expect(runningSet(after)).toEqual({ kind: 'set', exercise: 'Bench press', set: 1, of: 2 });
  });

  it('falls back to the session count once everything is logged', () => {
    const s = logged(session([[bench, 1]]), [[0, 0]]);
    expect(runningSet(s)).toEqual({ kind: 'done', done: 1, total: 1 });
    expect(describeRunningSet(runningSet(s), '40:00', 'en')).toBe('40:00 · 1 of 1 sets');
  });

  it('is nothing without a session', () => {
    expect(runningSet(null)).toBeNull();
    expect(describeRunningSet(null, '1:00', 'en')).toBe('1:00');
  });
});

describe('the hero (4.0)', () => {
  const choice = (routineId: string, exerciseCount: number, lastTrainedAt: string | null) => ({
    routineId,
    exerciseCount,
    lastTrainedAt,
  });

  it('is the sequence’s turn whenever the sequence names one', () => {
    const next = choice('legs', 5, null);
    expect(suggestedRoutine([choice('push', 5, null), next], next)).toBe(next);
  });

  it('is the first openable routine when nothing has been trained', () => {
    const list = [choice('empty', 0, null), choice('push', 5, null), choice('pull', 4, null)];
    expect(suggestedRoutine(list, null)?.routineId).toBe('push');
  });

  it('is the routine after the one trained last, in list order', () => {
    const list = [
      choice('push', 5, '2026-11-10T18:00:00Z'),
      choice('pull', 4, '2026-11-12T18:00:00Z'),
      choice('legs', 6, '2026-11-08T18:00:00Z'),
    ];
    expect(suggestedRoutine(list, null)?.routineId).toBe('legs');
  });

  it('wraps from the last routine back to the first, and skips empty ones', () => {
    const list = [
      choice('push', 5, '2026-11-10T18:00:00Z'),
      choice('empty', 0, null),
      choice('legs', 6, '2026-11-12T18:00:00Z'),
    ];
    expect(suggestedRoutine(list, null)?.routineId).toBe('push');
  });

  it('suggests nothing when no routine has an exercise in it', () => {
    expect(suggestedRoutine([choice('a', 0, null)], null)).toBeNull();
    expect(suggestedRoutine([], null)).toBeNull();
  });
});

let seq = 0;
function workout(day: string, volume: number, partial = false): CompletedWorkout {
  seq += 1;
  return {
    id: `w${seq}`,
    title: `Workout ${seq}`,
    startedAt: `${day}T18:00:00.000Z`,
    endedAt: `${day}T19:00:00.000Z`,
    durationMinutes: 60,
    setCount: 10,
    totalVolumeKg: volume,
    volumeIsPartial: partial,
    exercises: [],
    sets: [],
  };
}

describe('the Progress sparkline (#11)', () => {
  it('draws whole volumes oldest first, leaving out floors and zeros', () => {
    const spark = progressSpark([
      workout('2026-10-03', 3000),
      workout('2026-10-01', 2000),
      workout('2026-10-02', 0),
      workout('2026-10-04', 900, true),
      workout('2026-10-05', 4000),
    ]);
    expect(spark?.values).toEqual([2000, 3000, 4000]);
    expect(spark!.min).toBeLessThan(2000);
    expect(spark!.max).toBeGreaterThan(4000);
  });

  it('keeps only the last N', () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      workout(`2026-09-${String(i + 1).padStart(2, '0')}`, 1000 + i),
    );
    expect(progressSpark(many)?.values).toHaveLength(10);
    expect(progressSpark(many)?.values[9]).toBe(1013);
  });

  it('is nothing under two points', () => {
    expect(progressSpark([])).toBeNull();
    expect(progressSpark([workout('2026-10-01', 100)])).toBeNull();
  });
});

describe('an empty workout (#18)', () => {
  it('is a routine with no items and no id, so nothing reads it as a routine', () => {
    const routine = emptyWorkoutRoutine({
      name: 'Workout',
      ownerId: 'u1',
      now: new Date('2026-10-30T18:00:00.000Z'),
    });
    expect(routine.items).toEqual([]);
    expect(routine.id).toBe('');
    const s = buildDraftSession({
      routine,
      exercisesById: {},
      historyByExerciseId: {},
      unitSystem: 'metric',
      defaultRestSeconds: 120,
    });
    expect(s.entries).toEqual([]);
    expect(s.routineId ? 'routine' : 'none').toBe('none');
    expect(s.title).toBe('Workout');
  });
});
