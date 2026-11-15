import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * THE ASSISTANT'S HANDS, END TO END — a scripted Gemini reply that creates,
 * removes and edits, through `sendMessage` (checked against the stores), the
 * card (`from → to`, deletes in red), `applyChanges` (the SAME store actions
 * the screens call) and the one Undo, which has to put every store back —
 * including a workout the card deleted and a session it edited.
 */
let storedKey: string | null = null;
vi.mock('../lib/ai/secureKey', () => ({
  getKey: async () => storedKey,
  setKey: async () => true,
  clearKey: async () => {
    storedKey = null;
  },
}));

/* The weigh-in switch asks for the permission as it turns on, and a grant arms
   the alerts — spied on here, since neither has a phone to talk to. */
const permission = vi.hoisted(() => ({
  answer: 'granted' as 'granted' | 'denied' | 'blocked',
  asked: 0,
  synced: 0,
}));
vi.mock('../lib/notify', () => ({
  ensureNotificationPermission: async () => {
    permission.asked += 1;
    return permission.answer;
  },
}));
vi.mock('../hooks/useWeighInReminder', () => ({
  syncWeighInFromSettings: async () => {
    permission.synced += 1;
  },
}));

import { applyChanges, chatContext, sendMessage } from './aiActions';
import { sanitizeAi, useAi, type ChangesChatBlock } from './aiStore';
import { useActiveWorkout } from './activeWorkoutStore';
import { __closeDb } from './historyDb';
import { useLibrary } from './libraryStore';
import { useSettings } from './settingsStore';
import { useWorkoutHistory } from './workoutHistoryStore';
import { buildDraftSession, type DraftSession } from '../lib/draft';
import { __resetDatabases } from '../../test/expoSqliteStub';
import type { Exercise, Routine } from '../types/models';

const CREATED = '2026-06-01T00:00:00.000Z';

function exercise(over: Partial<Exercise> & Pick<Exercise, 'id' | 'name'>): Exercise {
  return {
    ownerId: 'u1',
    muscleGroups: ['chest'],
    requiresWeight: false,
    countUnit: 'reps',
    loadMode: 'none',
    isUnilateral: false,
    isArchived: false,
    createdAt: CREATED,
    ...over,
  };
}

const EXERCISES: Exercise[] = [
  exercise({
    id: 'ex_bench',
    name: 'Bench press',
    requiresWeight: true,
    loadMode: 'external',
    defaultWeightKg: 60,
    defaultCount: 8,
    defaultSets: 3,
  }),
  exercise({ id: 'ex_row', name: 'Cable row', defaultCount: 10, defaultSets: 3 }),
  exercise({ id: 'ex_dips', name: 'Dips', defaultCount: 12, defaultSets: 3 }),
];
const byId = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

const routine = (id: string, name: string, ids: string[]): Routine => ({
  id,
  ownerId: 'u1',
  name,
  createdAt: CREATED,
  updatedAt: CREATED,
  items: ids.map((exerciseId, order) => ({
    id: `${id}_${order}`,
    exerciseId,
    order,
    targetSets: 3,
    targetRepsMax: 10,
  })),
});
const UPPER = routine('r_upper', 'Upper', ['ex_bench', 'ex_row', 'ex_dips']);
const LOWER = routine('r_lower', 'Lower', ['ex_row']);

function draft(startedAt: string, logged: boolean): DraftSession {
  const session = buildDraftSession({
    routine: UPPER,
    exercisesById: byId,
    historyByExerciseId: {},
    unitSystem: 'metric',
    defaultRestSeconds: 120,
    defaultTransitionRestSeconds: 150,
    startedAt,
    now: new Date(startedAt),
  });
  if (!logged) return session;
  return {
    ...session,
    entries: session.entries.map((entry) => ({
      ...entry,
      sets: entry.sets.map((s) => ({ ...s, isCompleted: true, isPrefilled: false })),
    })),
  };
}

/* Scripted Gemini, as in `aiChangesScenarios.test.ts`. */
type Answer = { status: number; body: unknown };
let answers: Answer[] = [];

function reply(items: unknown[]): Answer {
  const blocks = [
    { type: 'text', text: 'Done as a card.' },
    { type: 'changes_proposal', changes: { items, why: 'As asked.' } },
  ];
  return {
    status: 200,
    body: { candidates: [{ content: { parts: [{ text: JSON.stringify({ blocks }) }] } }] },
  };
}

async function ask(items: unknown[]): Promise<{ id: string; card: ChangesChatBlock }> {
  answers.push(reply(items));
  await sendMessage('Workout', 'do it');
  const last = useAi.getState().chats.Workout.at(-1)!;
  if (last.role !== 'model') throw new Error(`no answer: ${JSON.stringify(last)}`);
  const card = last.blocks.find((b): b is ChangesChatBlock => b.type === 'changes');
  if (!card) throw new Error(`no card: ${JSON.stringify(last.blocks)}`);
  return { id: last.id, card };
}

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const library = () => plain({ ...useLibrary.getState() });
const lines = (card: ChangesChatBlock) =>
  card.rows.map(
    (r) => `${r.subject} | ${r.label} | ${r.from} → ${r.to}${r.destructive ? ' !' : ''}`,
  );

beforeEach(() => {
  __resetDatabases();
  __closeDb();
  storedKey = 'AIzaSyTESTKEY-1234567890abcdef';
  answers = [];
  useAi.setState({ ...sanitizeAi({}), pending: { Workout: false }, retrying: { Workout: false } });
  useAi.getState().markReady(500);
  useSettings.getState().resetToDefaults();
  useSettings.getState().setLanguage('en');
  useLibrary.getState().replaceLibrary({ exercises: EXERCISES, routines: [UPPER, LOWER] });
  useLibrary
    .getState()
    .replaceSequence({ isActive: true, routineIds: ['r_upper', 'r_lower'], cursor: 0 });
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

describe('the library', () => {
  it('creates an exercise and a routine, wires them together, and Undo takes it all back', async () => {
    const before = library();
    const { id, card } = await ask([
      { target: 'routine', id: 'new_r', field: 'create', name: 'Arms' },
      { target: 'exercise', id: 'new_1', field: 'create', name: 'Hammer curl', muscle: 'biceps' },
      { target: 'routine_item', id: 'new_r', exerciseId: 'new_1', field: 'add' },
      { target: 'routine_item', id: 'new_r', exerciseId: 'ex_dips', field: 'add', number: 1 },
      { target: 'routine_item', id: 'new_r', exerciseId: 'new_1', field: 'sets', number: 5 },
      { target: 'exercise', id: 'new_1', field: 'cue', text: 'Elbows still' },
    ]);
    expect(card.changes).toHaveLength(6);
    expect(library()).toEqual(before); // nothing written yet

    const applied = applyChanges('Workout', id)!;
    expect(applied.message).toBe('6 changes applied');
    const state = useLibrary.getState();
    const curl = state.exercises.find((e) => e.name === 'Hammer curl')!;
    expect(curl).toMatchObject({
      muscleGroups: ['biceps'],
      requiresWeight: true,
      cue: 'Elbows still',
    });
    expect(curl.id).not.toBe('new_1');
    const arms = state.routines.find((r) => r.name === 'Arms')!;
    expect(arms.items.map((i) => `${i.order}:${i.exerciseId}:${i.targetSets}`)).toEqual([
      '0:ex_dips:3',
      `1:${curl.id}:5`,
    ]);
    expect(useAi.getState().unseenRoutineIds).toContain(arms.id);

    applied.undo();
    expect(library()).toEqual(before);
    expect(useAi.getState().unseenRoutineIds).not.toContain(arms.id);
  });

  it('renames, re-plans and deletes — deletes in red — and Undo brings the loop back too', async () => {
    const before = library();
    const { id, card } = await ask([
      { target: 'routine', id: 'r_upper', field: 'rename', text: 'Upper A' },
      { target: 'routine_item', id: 'r_upper', exerciseId: 'ex_row', field: 'remove' },
      { target: 'routine_item', id: 'r_upper', exerciseId: 'ex_dips', field: 'move', number: 1 },
      { target: 'routine_item', id: 'r_upper', exerciseId: 'ex_bench', field: 'reps', number: 6 },
      { target: 'routine', id: 'r_lower', field: 'delete' },
      { target: 'exercise', id: 'ex_dips', field: 'name', text: 'Ring dips' },
      { target: 'sequence', field: 'on', on: false },
    ]);
    expect(lines(card)).toEqual([
      'Upper | Name | Upper → Upper A',
      'Upper | Cable row |  → Removed !',
      'Upper | Dips | #3 → #1',
      'Upper · Bench press | Reps | 10 → 6',
      'Lower | Delete routine |  → Deleted !',
      'Dips | Name | Dips → Ring dips',
      'Training sequence | Use this sequence | On → Off',
    ]);

    const applied = applyChanges('Workout', id)!;
    const state = useLibrary.getState();
    expect(state.routines.map((r) => r.name)).toEqual(['Upper A']);
    expect(state.routines[0].items.map((i) => i.exerciseId)).toEqual(['ex_dips', 'ex_bench']);
    expect(state.routines[0].items[1].targetRepsMax).toBe(6);
    expect(state.exercises.find((e) => e.id === 'ex_dips')?.name).toBe('Ring dips');
    expect(state.sequence).toMatchObject({ isActive: false, routineIds: ['r_upper'] });

    applied.undo();
    expect(library()).toEqual(before);
  });

  it('deletes an exercise from the library and its routines', async () => {
    const { id } = await ask([{ target: 'exercise', id: 'ex_row', field: 'delete' }]);
    const applied = applyChanges('Workout', id)!;
    const state = useLibrary.getState();
    expect(state.exercises.some((e) => e.id === 'ex_row')).toBe(false);
    expect(state.routines.find((r) => r.id === 'r_lower')?.items).toEqual([]);
    applied.undo();
    expect(useLibrary.getState().exercises.some((e) => e.id === 'ex_row')).toBe(true);
  });
});

describe('a saved workout', () => {
  it('corrects, re-dates and deletes — and Undo reinstates even the deleted one', async () => {
    const history = useWorkoutHistory.getState();
    const kept = history.saveSession(draft('2026-10-27T17:00:00', true))!;
    const doomed = history.saveSession(draft('2026-10-20T17:00:00', true))!;
    history.setWorkoutNumber(doomed.id, 40);
    const before = plain(useWorkoutHistory.getState().workouts);
    const numbering = plain(useWorkoutHistory.getState().numbering);

    const { id, card } = await ask([
      {
        target: 'workout_set',
        id: kept.id,
        exerciseId: 'ex_bench',
        field: 'weight',
        set: 2,
        number: 62.5,
      },
      {
        target: 'workout_set',
        id: kept.id,
        exerciseId: 'ex_row',
        field: 'reps',
        set: 1,
        number: 14,
      },
      { target: 'workout_set', id: kept.id, exerciseId: 'ex_row', field: 'delete', set: 3 },
      { target: 'workout', id: kept.id, field: 'rename', text: 'Upper heavy' },
      { target: 'workout', id: kept.id, field: 'duration', number: 70 },
      { target: 'workout', id: kept.id, field: 'remove_exercise', exerciseId: 'ex_dips' },
      { target: 'workout', id: doomed.id, field: 'delete' },
    ]);
    expect(card.rows.filter((r) => r.destructive)).toHaveLength(3);

    const applied = applyChanges('Workout', id)!;
    expect(applied.message).toBe('7 changes applied');
    const workouts = useWorkoutHistory.getState().workouts;
    expect(workouts.map((w) => w.id)).toEqual([kept.id]);
    const now = workouts[0];
    expect(now).toMatchObject({ title: 'Upper heavy', durationMinutes: 70 });
    const bench = now.sets.filter((s) => s.exerciseId === 'ex_bench');
    expect(bench.map((s) => s.weightKg)).toEqual([60, 62.5, 60]);
    const row = now.sets.filter((s) => s.exerciseId === 'ex_row');
    expect(row.map((s) => s.count)).toEqual([14, 10]);
    expect(now.sets.some((s) => s.exerciseId === 'ex_dips')).toBe(false);

    applied.undo();
    expect(plain(useWorkoutHistory.getState().workouts)).toEqual(before);
    expect(plain(useWorkoutHistory.getState().numbering)).toEqual(numbering);
  });

  it('moves a workout to another day at the same time of day', async () => {
    const kept = useWorkoutHistory.getState().saveSession(draft('2026-10-27T17:30:00', true))!;
    const { id } = await ask([
      { target: 'workout', id: kept.id, field: 'date', text: '2026-10-25' },
    ]);
    applyChanges('Workout', id);
    const moved = new Date(useWorkoutHistory.getState().workouts[0].startedAt);
    expect([moved.getDate(), moved.getHours(), moved.getMinutes()]).toEqual([25, 17, 30]);
  });
});

describe('the workout in flight', () => {
  it('adds, edits, logs and removes — and Undo puts the session back', async () => {
    useActiveWorkout.getState().startSession({
      routine: UPPER,
      exercisesById: byId,
      historyByExerciseId: {},
      unitSystem: 'metric',
      defaultRestSeconds: 120,
      defaultTransitionRestSeconds: 150,
    });
    const before = plain(useActiveWorkout.getState().session);
    const { id, card } = await ask([
      { target: 'live_set', exerciseId: 'ex_bench', field: 'weight', set: 1, number: 65 },
      { target: 'live_set', exerciseId: 'ex_bench', field: 'reps', set: 1, number: 6 },
      { target: 'live_set', exerciseId: 'ex_bench', field: 'log', set: 1 },
      { target: 'live', exerciseId: 'ex_row', field: 'remove_exercise' },
      { target: 'live', exerciseId: 'ex_dips', field: 'add_set' },
      { target: 'live', exerciseId: 'ex_bench', field: 'add_exercise' },
    ]);
    expect(card.changes).toHaveLength(6);

    const applied = applyChanges('Workout', id)!;
    const session = useActiveWorkout.getState().session!;
    const [bench, dips, again] = session.entries;
    expect(session.entries.map((e) => e.exercise.id)).toEqual(['ex_bench', 'ex_dips', 'ex_bench']);
    expect(bench.sets[0]).toMatchObject({ weightKg: 65, count: 6, isCompleted: true });
    expect(dips.sets).toHaveLength(before.entries[2].sets.length + 1);
    expect(again.sets.length).toBeGreaterThan(0);

    applied.undo();
    expect(plain(useActiveWorkout.getState().session)).toEqual(before);
  });
});

describe('settings', () => {
  it('every switch and choice through its own write, and back', async () => {
    const { id } = await ask([
      { target: 'setting', field: 'units', text: 'imperial' },
      { target: 'setting', field: 'sound', on: false },
      { target: 'setting', field: 'timer_step', number: 30 },
      { target: 'setting', field: 'weekly_target', text: 'push', number: 14 },
      { target: 'setting', field: 'ladder_all', on: true },
    ]);
    const before = plain(useSettings.getState());
    const lib = library();
    const applied = applyChanges('Workout', id)!;
    const s = useSettings.getState();
    expect(s).toMatchObject({
      unitSystem: 'imperial',
      soundEnabled: false,
      adjustStepSeconds: 30,
      weeklySetTargets: { push: 14 },
      ladderAllExercises: true,
    });
    // `ladder_all` reaches the library, as the switch does.
    expect(useLibrary.getState().exercises.find((e) => e.id === 'ex_row')?.ladder).toBeDefined();
    applied.undo();
    expect(plain(useSettings.getState())).toEqual(before);
    expect(library()).toEqual(lib);
  });
});

describe('what cannot be done', () => {
  it('is counted on the card, which keeps what can', async () => {
    const { card } = await ask([
      { target: 'routine', id: 'r_upper', field: 'rename', text: 'Upper B' },
      { target: 'workout', id: 'w_nope', field: 'delete' },
      { target: 'session', field: 'finish' },
    ]);
    expect(card.changes).toHaveLength(1);
    expect(card.dropped).toBe(2);
  });
});

describe('the three that came later', () => {
  it('the warm-up toggle on a card in flight, through `toggleWarmup`, and back', async () => {
    useActiveWorkout.getState().startSession({
      routine: UPPER,
      exercisesById: byId,
      historyByExerciseId: {},
      unitSystem: 'metric',
      defaultRestSeconds: 120,
      defaultTransitionRestSeconds: 150,
    });
    const before = plain(useActiveWorkout.getState().session);
    const { id, card } = await ask([
      { target: 'live', exerciseId: 'ex_bench', field: 'warmup', on: true },
    ]);
    expect(lines(card)).toEqual(['This workout | Bench press · Warm-up | Off → On']);
    expect(plain(useActiveWorkout.getState().session)).toEqual(before); // nothing yet

    const applied = applyChanges('Workout', id)!;
    const bench = useActiveWorkout.getState().session!.entries[0];
    // Half the working weight, the working reps — `lib/warmup.ts`.
    expect(bench.sets[0]).toMatchObject({
      isWarmup: true,
      weightKg: 30,
      count: before.entries[0].sets[0].count,
    });
    expect(bench.sets.slice(1)).toEqual(before.entries[0].sets);

    applied.undo();
    expect(plain(useActiveWorkout.getState().session)).toEqual(before);
  });

  it('does not flip a warm-up the user already toggled by hand since the card', async () => {
    useActiveWorkout.getState().startSession({
      routine: UPPER,
      exercisesById: byId,
      historyByExerciseId: {},
      unitSystem: 'metric',
      defaultRestSeconds: 120,
      defaultTransitionRestSeconds: 150,
    });
    const { id } = await ask([
      { target: 'live', exerciseId: 'ex_bench', field: 'warmup', on: true },
    ]);
    const entryId = useActiveWorkout.getState().session!.entries[0].localId;
    useActiveWorkout.getState().toggleWarmup(entryId);
    const byHand = plain(useActiveWorkout.getState().session);
    expect(applyChanges('Workout', id)).toBeNull();
    expect(plain(useActiveWorkout.getState().session)).toEqual(byHand);
  });

  it("find my max: the editor's waiting ladder, shown to the model, and Undo", async () => {
    const before = library();
    const { id, card } = await ask([{ target: 'exercise', id: 'ex_dips', field: 'find_max' }]);
    expect(lines(card)).toEqual(['Dips | Rep ladder | Off → Find my max in the next workout']);
    expect(library()).toEqual(before);

    const applied = applyChanges('Workout', id)!;
    const dips = useLibrary.getState().exercises.find((e) => e.id === 'ex_dips')!;
    expect(dips.ladder).toMatchObject({ earned: 0, awaitingMax: true });
    const json = chatContext().json;
    expect(json).toContain('rep ladder awaiting max');
    expect(json).toContain('max test next workout');

    applied.undo();
    expect(library()).toEqual(before);
  });

  it('the weigh-in reminder: switch, days, time — the permission asked as it turns on', async () => {
    useSettings.getState().setWeighInReminderEnabled(false);
    permission.asked = 0;
    permission.synced = 0;
    permission.answer = 'granted';
    const before = plain(useSettings.getState());
    const { id, card } = await ask([
      { target: 'setting', field: 'weigh_in_reminder', on: true },
      { target: 'setting', field: 'weigh_in_days', text: 'Mon, Thu' },
      { target: 'setting', field: 'weigh_in_time', text: '07:30' },
    ]);
    expect(lines(card)).toEqual([
      'Settings | Remind me to weigh in | Off → On',
      'Weigh-in reminder | On which days | Wed, Sun → Mon, Thu',
      'Weigh-in reminder | At what time | 06:00 → 07:30',
    ]);
    expect(permission.asked).toBe(0); // nothing until Apply

    const applied = applyChanges('Workout', id)!;
    expect(useSettings.getState()).toMatchObject({
      weighInReminderEnabled: true,
      weighInReminderDays: [0, 3],
      weighInReminderTime: '07:30',
    });
    await vi.waitFor(() => expect(permission.synced).toBe(1));
    expect(permission.asked).toBe(1);

    applied.undo();
    expect(plain(useSettings.getState())).toEqual(before);
  });

  it('a refused permission leaves it on and arms nothing; turning it off asks nothing', async () => {
    useSettings.getState().setWeighInReminderEnabled(false);
    permission.asked = 0;
    permission.synced = 0;
    permission.answer = 'denied';
    const { id } = await ask([{ target: 'setting', field: 'weigh_in_reminder', on: true }]);
    applyChanges('Workout', id);
    await vi.waitFor(() => expect(permission.asked).toBe(1));
    expect(useSettings.getState().weighInReminderEnabled).toBe(true);
    expect(permission.synced).toBe(0);

    const off = await ask([{ target: 'setting', field: 'weigh_in_reminder', on: false }]);
    applyChanges('Workout', off.id);
    expect(useSettings.getState().weighInReminderEnabled).toBe(false);
    expect(permission.asked).toBe(1);
  });
});
