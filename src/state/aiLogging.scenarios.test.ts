import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * THE LOGGING CARD, END TO END — "I weigh 81 today", "that first bench set was
 * a warm-up".
 *
 * The same harness as `aiChangesScenarios.test.ts`: `fetch` is a queue of
 * scripted Gemini replies and everything else is the real path — `sendMessage`
 * validating the block against the stores, `applyChanges` writing through each
 * store's own action, and the one Undo. What is different about these targets is
 * that they ADD rows rather than tune a value, so the Undo cannot be "write the
 * old value back": it has to put back the weigh-in log as it was, and the
 * workout it corrected — in memory and on disk.
 */
let storedKey: string | null = null;
vi.mock('../lib/ai/secureKey', () => ({
  getKey: async () => storedKey,
  setKey: async () => true,
  clearKey: async () => {
    storedKey = null;
  },
}));

import { applyChanges, sendMessage } from './aiActions';
import { sanitizeAi, useAi, type ChangesChatBlock } from './aiStore';
import { useActiveWorkout } from './activeWorkoutStore';
import { __closeDb, readAllWorkouts } from './historyDb';
import { useLibrary } from './libraryStore';
import { useSettings } from './settingsStore';
import { useWorkoutHistory } from './workoutHistoryStore';
import { buildDraftSession, type DraftSession } from '../lib/draft';
import type { CompletedWorkout } from '../lib/completedWorkout';
import { seedExercises, seedRoutine, seedUser } from '../data/seed';
import { fixtureHistoryByExerciseId } from '../../test/fixtures/history';
import { __resetDatabases } from '../../test/expoSqliteStub';
import type { Exercise, ID } from '../types/models';

/* ------------------------------------------------------------------ */
/* The user's things                                                   */
/* ------------------------------------------------------------------ */

/* A saved workout, the way `workoutHistoryStore.edits.test.ts` makes one. */
const exercisesById = Object.fromEntries(seedExercises.map((e) => [e.id, e])) as Record<
  ID,
  Exercise
>;

function loggedDraft(startedAt: string): DraftSession {
  const session = buildDraftSession({
    routine: seedRoutine,
    exercisesById,
    historyByExerciseId: fixtureHistoryByExerciseId,
    policy: seedUser.overloadPolicy,
    unitSystem: 'metric',
    defaultRestSeconds: 120,
    defaultTransitionRestSeconds: 150,
    startedAt,
    now: new Date(startedAt),
  });
  const [first, second, ...rest] = session.entries;
  const logged = (entry: typeof first, n: number) => ({
    ...entry,
    sets: entry.sets.map((s, i) =>
      i < n ? { ...s, isCompleted: true, weightKg: 40, isPrefilled: false } : s,
    ),
  });
  return { ...session, entries: [logged(first, 3), logged(second, 1), ...rest] };
}

function saveWorkout(startedAt = '2026-09-01T17:00:00.000Z'): CompletedWorkout {
  const stored = useWorkoutHistory.getState().saveSession(loggedDraft(startedAt));
  if (!stored) throw new Error('nothing was saved');
  return stored;
}

/** A workout as it is on disk — what a relaunch would read. */
const onDisk = (id: string) => (readAllWorkouts() as CompletedWorkout[]).find((w) => w.id === id);

const workout = (id: string) => useWorkoutHistory.getState().workouts.find((w) => w.id === id)!;

/** The first exercise's working sets in a saved workout, in the order the log shows them. */
function workingSets(w: CompletedWorkout) {
  const exerciseId = w.sets[0].exerciseId;
  return {
    exerciseId,
    sets: w.sets
      .filter((s) => s.exerciseId === exerciseId && !s.isWarmup)
      .sort((a, b) => a.setIndex - b.setIndex),
  };
}

/* ------------------------------------------------------------------ */
/* Scripted Gemini                                                     */
/* ------------------------------------------------------------------ */

type Answer = { status: number; body: unknown };
let answers: Answer[] = [];

function reply(items: unknown[], why = 'Logged.'): Answer {
  const blocks = [
    { type: 'text', text: 'Sure.' },
    { type: 'changes_proposal', changes: { items, why } },
  ];
  return {
    status: 200,
    body: { candidates: [{ content: { parts: [{ text: JSON.stringify({ blocks }) }] } }] },
  };
}

async function ask(answer: Answer): Promise<{ id: string; card: ChangesChatBlock | undefined }> {
  answers.push(answer);
  await sendMessage('Workout', 'log this');
  const last = useAi.getState().chats.Workout.at(-1)!;
  if (last.role !== 'model') throw new Error(`no answer: ${JSON.stringify(last)}`);
  const card = last.blocks.find((b): b is ChangesChatBlock => b.type === 'changes');
  return { id: last.id, card };
}

const cardOf = (id: string) => {
  const message = useAi.getState().chats.Workout.find((m) => m.id === id);
  return message?.role === 'model'
    ? message.blocks.find((b): b is ChangesChatBlock => b.type === 'changes')
    : undefined;
};

const rowsOf = (card: ChangesChatBlock | undefined) =>
  card?.rows.map(({ subject, label, from, to }) => `${subject} | ${label} | ${from} → ${to}`);

/** Everything a logging card can touch, as plain data. */
function snapshot() {
  const s = useSettings.getState();
  return JSON.parse(
    JSON.stringify({
      bodyweightKg: s.bodyweightKg ?? null,
      bodyweightLog: s.bodyweightLog,
      rest: s.restSecondsBetweenSets,
      workouts: useWorkoutHistory.getState().workouts,
    }),
  );
}

beforeEach(() => {
  storedKey = 'AIzaSyTESTKEY-1234567890abcdef';
  answers = [];
  __resetDatabases();
  __closeDb();
  useAi.setState({
    ...sanitizeAi({}),
    pending: { Workout: false },
    retrying: { Workout: false },
  });
  useAi.getState().markReady(500);
  useSettings.getState().resetToDefaults();
  useSettings.getState().setLanguage('en');
  useSettings.setState({ bodyweightKg: 80, bodyweightLog: [] });
  useLibrary.getState().replaceLibrary({ exercises: seedExercises, routines: [seedRoutine] });
  useWorkoutHistory.setState({ workouts: [], numbering: null, loadFailed: false, ready: true });
  useActiveWorkout.getState().discardSession();
  vi.stubGlobal('fetch', async () => {
    const next = answers.shift();
    if (!next) throw new TypeError('Network request failed');
    return { status: next.status, text: async () => JSON.stringify(next.body) };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/* Body weight — the Workout chat                                      */
/* ------------------------------------------------------------------ */

describe('a weigh-in on a Workout card', () => {
  it('reads today’s weight as its from, refuses one out of bounds, rounds to 0.1', async () => {
    const { card } = await ask(reply([{ target: 'bodyweight', field: 'log', number: 81.24 }]));
    expect(card?.changes).toEqual([{ target: 'bodyweight', field: 'log', value: 81.2 }]);
    expect(rowsOf(card)).toEqual(['Body weight | Today | 80 kg → 81.2 kg']);

    const silly = await ask(reply([{ target: 'weight', field: 'log', number: 4000 }]));
    expect(silly.card).toBeUndefined();
  });

  it('Apply writes the scalar and the log; Undo restores both', async () => {
    useSettings.getState().setBodyweightKg(79);
    const before = snapshot();
    expect(before.bodyweightLog).toHaveLength(1);

    const { id } = await ask(reply([{ target: 'bodyweight', field: 'log', number: 81 }]));
    const applied = applyChanges('Workout', id)!;
    expect(applied.message).toBe('1 changes applied');
    const s = useSettings.getState();
    expect(s.bodyweightKg).toBe(81);
    expect(s.bodyweightLog.at(-1)?.kg).toBe(81);

    applied.undo();
    expect(snapshot()).toEqual(before);
  });

  it('a first weigh-in on a device that never had one, and its Undo', async () => {
    useSettings.setState({ bodyweightKg: undefined, bodyweightLog: [] });
    const { id, card } = await ask(reply([{ target: 'bodyweight', field: 'log', number: 72 }]));
    expect(card?.rows[0].from).toBe('');
    const applied = applyChanges('Workout', id)!;
    expect(useSettings.getState().bodyweightKg).toBe(72);
    applied.undo();
    expect(useSettings.getState().bodyweightKg).toBeUndefined();
    expect(useSettings.getState().bodyweightLog).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* A saved set's kind — the Workout chat                               */
/* ------------------------------------------------------------------ */

describe('a set correction on a Workout card', () => {
  it('names the set by its place among the WORKING sets, and refuses a no-op or a set that is not there', async () => {
    const saved = saveWorkout();
    const { exerciseId, sets } = workingSets(saved);
    expect(sets.length).toBeGreaterThanOrEqual(2);

    const { card } = await ask(
      reply([
        {
          target: 'workout_set',
          field: 'kind',
          id: saved.id,
          exerciseId,
          number: 2,
          text: 'warm-up',
        },
        // Already a working set.
        { target: 'set', field: 'kind', id: saved.id, exerciseId, number: 1, text: 'working' },
        { target: 'set', field: 'kind', id: saved.id, exerciseId, number: 99, text: 'drop' },
        { target: 'set', field: 'kind', id: 'w_gone', exerciseId, number: 1, text: 'drop' },
        { target: 'set', field: 'kind', id: saved.id, exerciseId, number: 1, text: 'sideways' },
      ]),
    );
    expect(card?.changes).toEqual([
      {
        target: 'workout_set',
        field: 'kind',
        id: saved.id,
        exerciseId,
        setId: sets[1].id,
        from: 'working',
        value: 'warmup',
        day: saved.startedAt.slice(0, 10),
        position: 2,
      },
    ]);
    expect(card?.rows[0].label).toBe('Set 2');
    expect(card?.rows[0].subject).toContain('1 Sep');
  });

  it('a set re-marked warm-up stops counting — setCount and volume drop — and Undo puts the workout back, on disk too', async () => {
    const saved = saveWorkout();
    const { exerciseId, sets } = workingSets(saved);
    const before = snapshot();

    const { id } = await ask(
      reply([
        {
          target: 'workout_set',
          field: 'kind',
          id: saved.id,
          exerciseId,
          number: 1,
          text: 'warmup',
        },
      ]),
    );
    const applied = applyChanges('Workout', id)!;
    expect(applied.message).toBe('1 changes applied');

    const corrected = workout(saved.id);
    const row = corrected.sets.find((s) => s.id === sets[0].id)!;
    expect(row.isWarmup).toBe(true);
    expect(row).not.toHaveProperty('setType');
    expect(corrected.setCount).toBe(saved.setCount - 1);
    // Less by that set's load (its exercise may add the bodyweight to the 40 kg).
    expect(corrected.totalVolumeKg).toBeLessThan(saved.totalVolumeKg);
    expect(corrected.totalVolumeKg).toBeLessThanOrEqual(saved.totalVolumeKg - 40 * sets[0].count);
    // And the disk agrees, so the correction survives a relaunch.
    expect(onDisk(saved.id)?.setCount).toBe(saved.setCount - 1);

    applied.undo();
    expect(snapshot()).toEqual(before);
    const reread = onDisk(saved.id)!;
    expect(reread.setCount).toBe(saved.setCount);
    expect(reread.totalVolumeKg).toBe(saved.totalVolumeKg);
    expect(reread.sets.find((s) => s.id === sets[0].id)?.isWarmup).toBe(false);
  });

  it('two sets of one workout on one card: both change, one Undo restores the original', async () => {
    const saved = saveWorkout();
    const { exerciseId, sets } = workingSets(saved);
    const before = snapshot();
    const { id } = await ask(
      reply([
        {
          target: 'workout_set',
          field: 'kind',
          id: saved.id,
          exerciseId,
          number: 1,
          text: 'warmup',
        },
        {
          target: 'workout_set',
          field: 'kind',
          id: saved.id,
          exerciseId,
          number: 3,
          text: 'failure',
        },
      ]),
    );
    const applied = applyChanges('Workout', id)!;
    expect(applied.message).toBe('2 changes applied');
    const w = workout(saved.id);
    expect(w.sets.find((s) => s.id === sets[0].id)?.isWarmup).toBe(true);
    expect(w.sets.find((s) => s.id === sets[2].id)?.setType).toBe('failure');

    applied.undo();
    expect(snapshot()).toEqual(before);
  });

  it('a workout deleted since the answer is skipped, and Undo does not bring it back', async () => {
    const keep = saveWorkout('2026-09-01T17:00:00.000Z');
    const gone = saveWorkout('2026-09-03T17:00:00.000Z');
    const k = workingSets(keep);
    const g = workingSets(gone);
    const { id } = await ask(
      reply([
        {
          target: 'workout_set',
          field: 'kind',
          id: keep.id,
          exerciseId: k.exerciseId,
          number: 1,
          text: 'drop',
        },
        {
          target: 'workout_set',
          field: 'kind',
          id: gone.id,
          exerciseId: g.exerciseId,
          number: 1,
          text: 'drop',
        },
      ]),
    );
    useWorkoutHistory.getState().deleteWorkout(gone.id);
    const applied = applyChanges('Workout', id)!;
    expect(applied.message).toBe('1 changes applied');
    applied.undo();
    expect(useWorkoutHistory.getState().workouts.map((w) => w.id)).toEqual([keep.id]);

    const lone = await ask(
      reply([
        {
          target: 'workout_set',
          field: 'kind',
          id: keep.id,
          exerciseId: k.exerciseId,
          number: 1,
          text: 'amrap',
        },
      ]),
    );
    useWorkoutHistory.getState().deleteWorkout(keep.id);
    expect(applyChanges('Workout', lone.id)).toBeNull();
    expect(cardOf(lone.id)?.status).toBe('pending');
  });

  it('mixed with a weigh-in and a setting: all three apply, one Undo restores all three', async () => {
    const saved = saveWorkout();
    const { exerciseId } = workingSets(saved);
    const before = snapshot();
    const { id, card } = await ask(
      reply([
        { target: 'bodyweight', field: 'log', number: 82 },
        {
          target: 'workout_set',
          field: 'kind',
          id: saved.id,
          exerciseId,
          number: 1,
          text: 'warmup',
        },
        { target: 'setting', field: 'rest_between_sets', number: 60 },
        // Targets this app does not have: dropped on the way in.
        { target: 'amount', field: 'add', id: 'food', number: 12 },
        { target: 'task', id: 't_stretch', field: 'done' },
      ]),
    );
    expect(card?.changes.map((c) => c.target)).toEqual(['bodyweight', 'workout_set', 'setting']);
    const applied = applyChanges('Workout', id)!;
    expect(applied.message).toBe('3 changes applied');
    expect(useSettings.getState().bodyweightKg).toBe(82);
    expect(useSettings.getState().restSecondsBetweenSets).toBe(60);
    expect(workout(saved.id).setCount).toBe(saved.setCount - 1);

    /* `restoreWorkout` reprices the session at the bodyweight in force at that
       moment, so the weigh-in has to be undone FIRST — otherwise the workout
       comes back priced at 82 kg, not the 80 it was saved with. */
    applied.undo();
    expect(snapshot()).toEqual(before);
  });
});
