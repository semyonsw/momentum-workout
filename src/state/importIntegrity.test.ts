/**
 * A RESTORE MUST READ BACK THE SAME ON THE NEXT LAUNCH.
 *
 * The log lives twice — in the store, and in SQLite — and a restore writes both.
 * Anything the validator lets through that the table then folds differently is a
 * log that changes shape on relaunch: N workouts after the restore, N − 1 the day
 * after, and a restore sheet that reported the larger number. These pin the two
 * ways a backup file could do that: one session listed twice, and a set row
 * whose `sessionId` disagrees with the workout holding it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useWorkoutHistory } from './workoutHistoryStore';
import { LEGACY_STORAGE_KEY, __closeDb } from './historyDb';
import { __resetDatabases } from '../../test/expoSqliteStub';

beforeEach(async () => {
  __resetDatabases();
  __closeDb();
  await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
  useWorkoutHistory.getState().clearHistory();
  useWorkoutHistory.setState({ loadFailed: false });
});

function row(id: string, sessionId: string, setIndex = 0) {
  return {
    id,
    sessionId,
    exerciseId: 'bench',
    performedAt: '2026-08-17T17:05:00.000Z',
    setIndex,
    weightKg: 60,
    count: 8,
    countUnit: 'reps',
    loadMode: 'external',
    isWarmup: false,
    isCompleted: true,
  };
}

function workout(id: string, startedAt: string, title = 'Push', sets = [row(`${id}-s1`, id)]) {
  return {
    id,
    title,
    startedAt,
    endedAt: startedAt,
    durationMinutes: 40,
    setCount: sets.length,
    totalVolumeKg: 480,
    volumeIsPartial: false,
    exercises: [],
    sets,
  };
}

describe('a backup that lists one workout twice', () => {
  it('restores it once, and the relaunch agrees', () => {
    const count = useWorkoutHistory
      .getState()
      .importWorkouts([
        workout('w1', '2026-08-17T17:00:00.000Z', 'First copy'),
        workout('w2', '2026-08-18T17:00:00.000Z'),
        workout('w1', '2026-08-17T17:00:00.000Z', 'Second copy'),
      ]);

    expect(count).toBe(2);
    const inMemory = useWorkoutHistory.getState().workouts;
    expect(inMemory.map((w) => w.id)).toEqual(['w2', 'w1']);
    // The first one the file names is the one kept.
    expect(inMemory.find((w) => w.id === 'w1')?.title).toBe('First copy');

    // What the next launch reads.
    expect(useWorkoutHistory.getState().reloadHistory()).toBe(2);
    expect(useWorkoutHistory.getState().workouts).toEqual(inMemory);
  });
});

describe('a set row claiming another session', () => {
  it('belongs to the workout that holds it, before and after a relaunch', () => {
    useWorkoutHistory
      .getState()
      .importWorkouts([
        workout('w1', '2026-08-17T17:00:00.000Z', 'Push', [
          row('s1', 'w1', 0),
          row('s2', 'somewhere-else', 1),
        ]),
      ]);

    const before = useWorkoutHistory.getState().workouts[0].sets.map((s) => s.sessionId);
    expect(before).toEqual(['w1', 'w1']);

    useWorkoutHistory.getState().reloadHistory();
    const after = useWorkoutHistory.getState().workouts[0].sets.map((s) => s.sessionId);
    expect(after).toEqual(before);
  });
});

describe('empty and malformed input', () => {
  it('restores an empty list as an empty log', () => {
    expect(useWorkoutHistory.getState().importWorkouts([])).toBe(0);
    expect(useWorkoutHistory.getState().reloadHistory()).toBe(0);
  });

  it('keeps a workout whose every set row is unreadable, with no sets', () => {
    useWorkoutHistory
      .getState()
      .importWorkouts([
        workout('w1', '2026-08-17T17:00:00.000Z', 'Push', [
          { ...row('s1', 'w1'), count: NaN },
          { ...row('s2', 'w1'), countUnit: 'parsecs' },
          null as unknown as ReturnType<typeof row>,
        ]),
      ]);
    const [only] = useWorkoutHistory.getState().workouts;
    expect(only.id).toBe('w1');
    expect(only.sets).toEqual([]);
  });
});
