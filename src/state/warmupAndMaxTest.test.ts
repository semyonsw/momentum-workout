/**
 * The warm-up toggle and the ladder's max test, end to end through the store.
 *
 * The promise both features make is about what they DON'T touch: a warm-up
 * logged on top must leave every working set exactly as it was (no carry, no
 * ladder reshape, no max), and a max test must rebuild the rows only once it is
 * logged — and then write the max to the library so the next session runs the
 * ordinary ladder.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { selectEntry, useActiveWorkout } from './activeWorkoutStore';
import { useLibrary } from './libraryStore';
import { seedExercises } from '../data/seed';
import { ladderOutcomes } from '../lib/repLadder';
import type { Exercise, ID, Routine } from '../types/models';

const bench: Exercise = {
  ...seedExercises[0],
  id: 'ex_bench_test',
  name: 'Bench press',
  requiresWeight: true,
  countUnit: 'reps',
  loadMode: 'external',
  defaultWeightKg: 80,
  defaultCount: 8,
  ladder: undefined,
};

const pullups: Exercise = {
  ...seedExercises[0],
  id: 'ex_pullups_test',
  name: 'Pull-ups',
  requiresWeight: false,
  countUnit: 'reps',
  loadMode: 'none',
  ladder: { max: 12, earned: 0, awaitingMax: true },
};

function start(exercise: Exercise, sets = 4) {
  useLibrary.getState().replaceLibrary({ exercises: [exercise], routines: [] });
  useActiveWorkout.getState().discardSession();
  useActiveWorkout.getState().startSession({
    routine: {
      id: 'r_test',
      ownerId: 'u1',
      name: 'Test',
      items: [{ id: 'ri1', exerciseId: exercise.id, order: 0, targetSets: sets }],
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    } satisfies Routine,
    exercisesById: { [exercise.id]: exercise },
    historyByExerciseId: {},
    unitSystem: 'metric',
    defaultRestSeconds: 120,
    defaultTransitionRestSeconds: 150,
  });
  const entry = useActiveWorkout.getState().session?.entries[0];
  if (!entry) throw new Error('no entry');
  return entry;
}

const entryOf = (id: ID) => selectEntry(id)(useActiveWorkout.getState())!;
const libraryLadder = (id: ID) => useLibrary.getState().exercises.find((e) => e.id === id)?.ladder;

beforeEach(() => useActiveWorkout.getState().discardSession());

describe('the warm-up toggle', () => {
  it('inserts one warm-up on top at half the working weight, and 4 rows become 5', () => {
    const entry = start(bench);
    useActiveWorkout.getState().toggleWarmup(entry.localId);
    const after = entryOf(entry.localId);
    expect(after.sets).toHaveLength(5);
    expect(after.sets[0]).toMatchObject({ isWarmup: true, weightKg: 40, count: 8 });
    // The working sets are the same objects, shifted down.
    expect(after.sets.slice(1)).toEqual(entry.sets);
  });

  it('takes it back off on the second tap', () => {
    const entry = start(bench);
    const store = useActiveWorkout.getState();
    store.toggleWarmup(entry.localId);
    store.toggleWarmup(entry.localId);
    expect(entryOf(entry.localId).sets).toEqual(entry.sets);
  });

  it('logging the warm-up leaves sets 2..n untouched — no carry, no new default', () => {
    const entry = start(bench);
    const store = useActiveWorkout.getState();
    store.toggleWarmup(entry.localId);
    const warm = entryOf(entry.localId).sets[0];
    store.patchSet(entry.localId, warm.localId, { weightKg: 30, count: 5 });
    const before = entryOf(entry.localId).sets.slice(1);
    store.completeSet(entry.localId, warm.localId);

    const after = entryOf(entry.localId);
    expect(after.sets[0].isCompleted).toBe(true);
    expect(after.sets.slice(1)).toEqual(before);
    expect(useLibrary.getState().exercises[0].defaultWeightKg).toBe(80);
  });

  it('logging a warm-up on a ladder neither reshapes it nor counts as the test', () => {
    const entry = start({ ...pullups, ladder: { max: 16, earned: 0 } }, 5);
    const store = useActiveWorkout.getState();
    store.toggleWarmup(entry.localId);
    const warm = entryOf(entry.localId).sets[0];
    store.patchSet(entry.localId, warm.localId, { count: 30 });
    store.completeSet(entry.localId, warm.localId);
    expect(entryOf(entry.localId).sets.map((s) => s.count)).toEqual([30, 16, 10, 8, 8, 6]);
  });

  it('is gone once the warm-up is logged — the toggle never deletes a done set', () => {
    const entry = start(bench);
    const store = useActiveWorkout.getState();
    store.toggleWarmup(entry.localId);
    const warm = entryOf(entry.localId).sets[0];
    store.completeSet(entry.localId, warm.localId);
    store.toggleWarmup(entry.localId);
    expect(entryOf(entry.localId).sets).toHaveLength(5);
  });
});

describe('finding a ladder max in the workout', () => {
  it('opens set 1 as a counter at zero and leaves the rows alone until it is logged', () => {
    const entry = start(pullups, 5);
    expect(entry.sets[0].count).toBe(0);
    const before = entry.sets.map((s) => s.count);
    useActiveWorkout.getState().patchSet(entry.localId, entry.sets[0].localId, { count: 16 });
    expect(
      entryOf(entry.localId)
        .sets.slice(1)
        .map((s) => s.count),
    ).toEqual(before.slice(1));
  });

  it('rebuilds the remaining sets from the max the moment the test is logged', () => {
    const entry = start(pullups, 5);
    const store = useActiveWorkout.getState();
    store.patchSet(entry.localId, entry.sets[0].localId, { count: 16 });
    store.completeSet(entry.localId, entry.sets[0].localId);
    expect(entryOf(entry.localId).sets.map((s) => s.count)).toEqual([16, 10, 8, 8, 6]);
    // ...and the exercise now has a real max, so the next session is a ladder.
    expect(libraryLadder(pullups.id)).toEqual({ max: 16, earned: 0 });
  });

  it('follows a test corrected after it was logged, rows and library both', () => {
    const entry = start(pullups, 5);
    const store = useActiveWorkout.getState();
    store.patchSet(entry.localId, entry.sets[0].localId, { count: 16 });
    store.completeSet(entry.localId, entry.sets[0].localId);
    store.patchSet(entry.localId, entry.sets[0].localId, { count: 17 });
    expect(entryOf(entry.localId).sets.map((s) => s.count)).toEqual([17, 10, 9, 8, 7]);
    expect(libraryLadder(pullups.id)).toEqual({ max: 17, earned: 0 });
  });

  it('a test logged at zero proves nothing and keeps the ladder waiting', () => {
    const entry = start(pullups, 5);
    useActiveWorkout.getState().completeSet(entry.localId, entry.sets[0].localId);
    expect(libraryLadder(pullups.id)?.awaitingMax).toBe(true);
  });

  it('a met session after the test earns its rep at Finish, from the tested max', () => {
    const entry = start(pullups, 5);
    const store = useActiveWorkout.getState();
    store.patchSet(entry.localId, entry.sets[0].localId, { count: 16 });
    for (const set of entryOf(entry.localId).sets) store.completeSet(entry.localId, set.localId);
    const [outcome] = ladderOutcomes(useActiveWorkout.getState().session!.entries);
    expect(outcome.before).toEqual({ max: 16, earned: 0 });
    expect(outcome.after).toEqual({ max: 16, earned: 1 });
  });

  it('the warm-up toggle on a test card copies a usable rep count, not the zero', () => {
    const entry = start(pullups, 5);
    useActiveWorkout.getState().toggleWarmup(entry.localId);
    const warm = entryOf(entry.localId).sets[0];
    expect(warm.isWarmup).toBe(true);
    expect(warm.count).toBeGreaterThan(0);
    // and set 1 under it is still the test
    expect(entryOf(entry.localId).sets[1].count).toBe(0);
  });
});
