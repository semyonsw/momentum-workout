import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * A SETTINGS CARD, END TO END — from a scripted Gemini reply to the stores and
 * back again on Undo.
 *
 * `fetch` is a queue of scripted replies; everything else is the real path:
 * `sendMessage` validating the block and checking each change against the
 * stores, the card's `from → to` read at that moment, `applyChanges` writing
 * through each store's own actions, and the one Undo that has to put every
 * store it touched back EXACTLY — including the things the apply cleared on
 * its way through (an exercise's own rest, wiped by a new global rest).
 */
let storedKey: string | null = null;
vi.mock('../lib/ai/secureKey', () => ({
  getKey: async () => storedKey,
  setKey: async () => true,
  clearKey: async () => {
    storedKey = null;
  },
}));

import { applyChanges, discardChanges, sendMessage } from './aiActions';
import { sanitizeAi, useAi, type ChangesChatBlock } from './aiStore';
import { useActiveWorkout } from './activeWorkoutStore';
import { useLibrary } from './libraryStore';
import { useSettings } from './settingsStore';
import { useWorkoutHistory } from './workoutHistoryStore';
import type { Exercise, Routine } from '../types/models';

/* ------------------------------------------------------------------ */
/* The user's things                                                   */
/* ------------------------------------------------------------------ */

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
    defaultRestSeconds: 120,
    cue: 'Tuck elbows',
  }),
  exercise({ id: 'ex_row', name: 'Cable row', defaultCount: 10, defaultRestSeconds: 45 }),
  exercise({ id: 'ex_pull', name: 'Pull-up', defaultCount: 10, ladder: { max: 10, earned: 4 } }),
  exercise({ id: 'ex_plank', name: 'Plank', countUnit: 'seconds', defaultCount: 60 }),
];

const ROUTINE: Routine = {
  id: 'r_upper',
  ownerId: 'u1',
  name: 'Upper',
  createdAt: CREATED,
  updatedAt: CREATED,
  items: ['ex_bench', 'ex_row', 'ex_pull'].map((exerciseId, order) => ({
    id: `ui_${order}`,
    exerciseId,
    order,
    targetSets: 3,
    targetRepsMax: 10,
  })),
};

/* ------------------------------------------------------------------ */
/* Scripted Gemini                                                     */
/* ------------------------------------------------------------------ */

type Answer = { status: number; body: unknown };
let answers: Answer[] = [];
const sent: string[] = [];

function reply(items: unknown[], why = 'Here is what I would change.'): Answer {
  const blocks = [
    { type: 'text', text: 'Sure.' },
    { type: 'changes_proposal', changes: { items, why } },
  ];
  return {
    status: 200,
    body: { candidates: [{ content: { parts: [{ text: JSON.stringify({ blocks }) }] } }] },
  };
}

/** Ask, with this reply scripted; the model message's id and its card. */
async function ask(answer: Answer): Promise<{ id: string; card: ChangesChatBlock | undefined }> {
  answers.push(answer);
  await sendMessage('Workout', 'change some settings');
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

/** Everything a card can touch, as plain data. */
function snapshot() {
  const s = useSettings.getState();
  return JSON.parse(
    JSON.stringify({
      exercises: useLibrary.getState().exercises,
      routines: useLibrary.getState().routines,
      rest: s.restSecondsBetweenSets,
      restExercises: s.restSecondsBetweenExercises,
      autoRest: s.autoStartRest,
    }),
  );
}

const ex = (id: string) => useLibrary.getState().exercises.find((e) => e.id === id)!;

beforeEach(() => {
  storedKey = 'AIzaSyTESTKEY-1234567890abcdef';
  answers = [];
  sent.length = 0;
  useAi.setState({
    ...sanitizeAi({}),
    pending: { Workout: false },
    retrying: { Workout: false },
  });
  useAi.getState().markReady(500);
  useSettings.getState().resetToDefaults();
  useSettings.getState().setLanguage('en');
  useLibrary.getState().replaceLibrary({ exercises: EXERCISES, routines: [ROUTINE] });
  useWorkoutHistory.setState({ workouts: [] });
  useActiveWorkout.getState().discardSession();
  vi.stubGlobal('fetch', async (_url: string, init: { body?: string }) => {
    sent.push(init.body ?? '');
    const next = answers.shift();
    if (!next) throw new TypeError('Network request failed');
    return { status: next.status, text: async () => JSON.stringify(next.body) };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/* The Workout chat                                                    */
/* ------------------------------------------------------------------ */

/** Everything the Workout chat can change, on one card. */
const WORKOUT_ITEMS = [
  { target: 'setting', field: 'rest_between_sets', number: 60 },
  { target: 'exercise', id: 'ex_bench', field: 'rest', number: 90 },
  { target: 'exercise', id: 'ex_bench', field: 'sets', number: 4 },
  { target: 'exercise', id: 'ex_pull', field: 'ladder', number: 14 },
  { target: 'exercise', id: 'ex_bench', field: 'cue', text: '' },
  { target: 'setting', field: 'auto_rest', on: false },
  { target: 'setting', field: 'rest_between_exercises', number: 180 },
  // Dropped on the way in: archived-style unknown id, a ladder on a timed
  // exercise, a task (a target this app does not have), a retired setting.
  { target: 'exercise', id: 'ex_gone', field: 'rest', number: 30 },
  { target: 'exercise', id: 'ex_plank', field: 'ladder', number: 5 },
  { target: 'task', id: 't_read', field: 'archive' },
  { target: 'setting', field: 'weekly_goal', number: 5 },
];

describe('a Workout card', () => {
  it('is filed checked, with each row read from the stores at that moment, and writes nothing', async () => {
    const before = snapshot();
    const { card } = await ask(reply(WORKOUT_ITEMS));
    expect(card?.status).toBe('pending');
    expect(card?.why).toBe('Here is what I would change.');
    expect(card?.changes).toHaveLength(7);
    expect(
      card?.rows.map(({ subject, label, from, to }) => `${subject} | ${label} | ${from} → ${to}`),
    ).toEqual([
      'Settings | Rest between sets | 2:00 → 1:00',
      'Bench press | Rest between sets | 2:00 → 1:30',
      'Bench press | Sets | 3 → 4',
      'Pull-up | Rep ladder max | 10 → 14',
      'Bench press | Form cue | Tuck elbows → None',
      'Settings | Start rest automatically | On → Off',
      'Settings | Rest between exercises | 2:30 → 3:00',
    ]);
    expect(snapshot()).toEqual(before);
  });

  it('Apply writes every change — the exercise rest surviving the global one — and Undo puts all of it back', async () => {
    const before = snapshot();
    const { id, card } = await ask(reply(WORKOUT_ITEMS));
    const applied = applyChanges('Workout', id);
    expect(applied?.message).toBe('7 changes applied');

    const s = useSettings.getState();
    expect(s.restSecondsBetweenSets).toBe(60);
    expect(s.restSecondsBetweenExercises).toBe(180);
    expect(s.autoStartRest).toBe(false);
    // Settings went first: the new global rest cleared Row's own 0:45, and
    // Bench's 1:30 from the SAME card was written after it, so it stands.
    expect(ex('ex_bench').defaultRestSeconds).toBe(90);
    expect(ex('ex_row')).not.toHaveProperty('defaultRestSeconds');
    expect(ex('ex_bench').defaultSets).toBe(4);
    expect(ex('ex_bench')).not.toHaveProperty('cue');
    expect(ex('ex_pull').ladder).toEqual({ max: 14, earned: 0 });
    expect(ex('ex_pull').defaultCount).toBe(14);
    // A sets change re-plans the routine, as the editor's would.
    const upper = useLibrary.getState().routines[0];
    expect(upper.items.find((i) => i.exerciseId === 'ex_bench')?.targetSets).toBe(4);
    expect(cardOf(id)?.status).toBe('accepted');
    // The card still reads what was REPLACED, not 1:30 → 1:30.
    expect(cardOf(id)?.rows).toEqual(card?.rows);

    applied!.undo();
    expect(snapshot()).toEqual(before);
    expect(cardOf(id)?.status).toBe('pending');

    // And it can be applied again after its Undo.
    expect(applyChanges('Workout', id)).not.toBeNull();
    expect(ex('ex_bench').defaultRestSeconds).toBe(90);
  });

  it('is applied once: a second Apply, or one after Discard, is refused', async () => {
    const { id } = await ask(reply(WORKOUT_ITEMS));
    expect(applyChanges('Workout', id)).not.toBeNull();
    const after = snapshot();
    expect(applyChanges('Workout', id)).toBeNull();
    expect(snapshot()).toEqual(after);

    const second = await ask(reply([{ target: 'setting', field: 'auto_rest', on: true }]));
    discardChanges('Workout', second.id);
    expect(cardOf(second.id)?.status).toBe('discarded');
    expect(applyChanges('Workout', second.id)).toBeNull();
    expect(useSettings.getState().autoStartRest).toBe(false);
  });

  it('refuses a message that is not there, or has no card', async () => {
    expect(applyChanges('Workout', 'nope')).toBeNull();
    const { id } = await ask(
      reply([{ target: 'exercise', id: 'ex_nope', field: 'rest', number: 9 }]),
    );
    expect(cardOf(id)).toBeUndefined();
    expect(applyChanges('Workout', id)).toBeNull();
  });

  it('skips an exercise deleted since the answer; with nothing left, nothing is applied', async () => {
    const { id } = await ask(
      reply([
        { target: 'exercise', id: 'ex_row', field: 'rest', number: 30 },
        { target: 'exercise', id: 'ex_bench', field: 'rest', number: 30 },
      ]),
    );
    useLibrary.getState().deleteExercise('ex_row');
    const applied = applyChanges('Workout', id);
    expect(applied?.message).toBe('1 changes applied');
    expect(ex('ex_bench').defaultRestSeconds).toBe(30);

    const lone = await ask(
      reply([{ target: 'exercise', id: 'ex_pull', field: 'rest', number: 30 }]),
    );
    useLibrary.getState().deleteExercise('ex_pull');
    expect(applyChanges('Workout', lone.id)).toBeNull();
    expect(cardOf(lone.id)?.status).toBe('pending');
  });

  it('a card with nothing applicable is said as its reason', async () => {
    const { card } = await ask(
      reply(
        [{ target: 'exercise', id: 'ex_plank', field: 'ladder', number: 5 }],
        'Planks have no ladder.',
      ),
    );
    expect(card).toBeUndefined();
    const last = useAi.getState().chats.Workout.at(-1)!;
    expect(last.role === 'model' && last.blocks).toEqual([
      { type: 'text', text: 'Sure.' },
      { type: 'text', text: 'Planks have no ladder.' },
      { type: 'text', text: '1 suggested changes could not be applied and were left out.' },
    ]);
  });

  it('its status survives a relaunch, and the next question tells the model what became of it', async () => {
    const { id } = await ask(reply([{ target: 'setting', field: 'auto_rest', on: false }]));
    applyChanges('Workout', id);
    const back = sanitizeAi(JSON.parse(JSON.stringify(useAi.getState())));
    const message = back.chats.Workout.find((m) => m.id === id);
    const block =
      message?.role === 'model' ? message.blocks.find((b) => b.type === 'changes') : undefined;
    expect(block).toMatchObject({ type: 'changes', status: 'accepted' });

    answers.push(reply([{ target: 'setting', field: 'auto_rest', on: true }]));
    await sendMessage('Workout', 'and now?');
    const body = JSON.parse(sent.at(-1)!);
    const turn = body.contents.at(-1).parts[0].text as string;
    expect(turn).toContain('settings changes: APPLIED');
  });

  it('an Undo after New chat marks the filed card pending again', async () => {
    const { id } = await ask(reply([{ target: 'setting', field: 'auto_rest', on: false }]));
    const applied = applyChanges('Workout', id)!;
    useAi.getState().clearChat('Workout');
    applied.undo();
    expect(useSettings.getState().autoStartRest).toBe(true);
    const filed = useAi.getState().archive.Workout[0].messages.find((m) => m.id === id);
    const block =
      filed?.role === 'model' ? filed.blocks.find((b) => b.type === 'changes') : undefined;
    expect(block).toMatchObject({ status: 'pending' });
  });

  it('a workout in flight takes the change, and gives it back on Undo', async () => {
    const library = Object.fromEntries(useLibrary.getState().exercises.map((e) => [e.id, e]));
    useActiveWorkout.getState().startSession({
      routine: ROUTINE,
      exercisesById: library,
      historyByExerciseId: {},
      unitSystem: 'metric',
      defaultRestSeconds: 120,
      defaultTransitionRestSeconds: 150,
    });
    const live = (id: string) =>
      useActiveWorkout.getState().session!.entries.find((e) => e.exercise.id === id)!.exercise;
    const before = { bench: live('ex_bench'), row: live('ex_row') };

    const { id } = await ask(
      reply([
        { target: 'setting', field: 'rest_between_sets', number: 60 },
        { target: 'exercise', id: 'ex_bench', field: 'cue', text: 'Pause on chest' },
      ]),
    );
    const applied = applyChanges('Workout', id)!;
    expect(live('ex_bench').cue).toBe('Pause on chest');
    expect(live('ex_row')).not.toHaveProperty('defaultRestSeconds');

    applied.undo();
    expect(live('ex_bench')).toEqual(before.bench);
    expect(live('ex_row')).toEqual(before.row);
  });
});
