import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * A WHOLE NEW ORDER, END TO END — a scripted reply that reorders a routine, the
 * loop or the workout in flight; the card that holds it; the user's drags on
 * that card (`reorderChange`), which write NOTHING but the card; `applyChanges`,
 * which writes the dragged order through the screens' own moves; and the Undo.
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

import { applyChanges, discardChanges, reorderChange, sendMessage } from './aiActions';
import { sanitizeAi, useAi, type ChangesChatBlock } from './aiStore';
import { useActiveWorkout } from './activeWorkoutStore';
import { __closeDb } from './historyDb';
import { useLibrary } from './libraryStore';
import { useSettings } from './settingsStore';
import { useWorkoutHistory } from './workoutHistoryStore';
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

const cardOf = (id: string): ChangesChatBlock => {
  const message = useAi.getState().chats.Workout.find((m) => m.id === id)!;
  if (message.role !== 'model') throw new Error('not an answer');
  return message.blocks.find((b): b is ChangesChatBlock => b.type === 'changes')!;
};
const orderOf = (routineId: string) =>
  useLibrary
    .getState()
    .routines.find((r) => r.id === routineId)!
    .items.sort((a, b) => a.order - b.order)
    .map((i) => i.exerciseId);

/* ------------------------------------------------------------------ */

describe('a routine', () => {
  it('previewed, fixed by a drag, applied as dragged, and undone', async () => {
    const before = library();
    // The model put Dips first but forgot Cable row: it goes after the rest.
    const { id, card } = await ask([
      { target: 'routine', id: 'r_upper', field: 'reorder', order: ['ex_dips', 'ex_bench'] },
    ]);
    expect(card.rows).toEqual([
      {
        subject: 'Upper',
        label: 'Exercise order',
        from: '',
        to: 'Dips, Bench press, Cable row',
        reorder: 0,
      },
    ]);
    expect(library()).toEqual(before);

    // The user drags Cable row (last) to the top. Still nothing in the library.
    reorderChange('Workout', id, 0, ['r_upper_1', 'r_upper_2', 'r_upper_0']);
    expect(cardOf(id).changes[0]).toMatchObject({
      order: ['r_upper_1', 'r_upper_2', 'r_upper_0'],
    });
    expect(library()).toEqual(before);

    // A drag that is not a permutation of the card's rows is refused.
    reorderChange('Workout', id, 0, ['r_upper_1', 'r_upper_1', 'r_upper_0']);
    reorderChange('Workout', id, 0, ['r_upper_1', 'r_upper_2']);
    expect(cardOf(id).changes[0]).toMatchObject({
      order: ['r_upper_1', 'r_upper_2', 'r_upper_0'],
    });

    const applied = applyChanges('Workout', id)!;
    expect(applied.message).toBe('1 changes applied');
    expect(orderOf('r_upper')).toEqual(['ex_row', 'ex_dips', 'ex_bench']);
    expect(
      useLibrary
        .getState()
        .routines.find((r) => r.id === 'r_upper')!
        .items.map((i) => i.order),
    ).toEqual([0, 1, 2]);
    // An applied card cannot be dragged any more.
    reorderChange('Workout', id, 0, ['r_upper_0', 'r_upper_1', 'r_upper_2']);
    expect(cardOf(id).changes[0]).toMatchObject({
      order: ['r_upper_1', 'r_upper_2', 'r_upper_0'],
    });

    applied.undo();
    expect(library()).toEqual(before);
    expect(cardOf(id).status).toBe('pending');
  });

  it('with other edits on the same card, one Apply and one Undo', async () => {
    const before = library();
    const { id } = await ask([
      { target: 'exercise', id: 'ex_dips', field: 'name', text: 'Ring dips' },
      {
        target: 'routine',
        id: 'r_upper',
        field: 'reorder',
        order: ['Dips', 'Cable row', 'Bench press'],
      },
      { target: 'routine_item', id: 'r_upper', exerciseId: 'ex_dips', field: 'sets', number: 5 },
    ]);
    const applied = applyChanges('Workout', id)!;
    expect(orderOf('r_upper')).toEqual(['ex_dips', 'ex_row', 'ex_bench']);
    const upper = useLibrary.getState().routines.find((r) => r.id === 'r_upper')!;
    expect(upper.items.find((i) => i.exerciseId === 'ex_dips')?.targetSets).toBe(5);
    expect(useLibrary.getState().exercises.find((e) => e.id === 'ex_dips')?.name).toBe('Ring dips');
    applied.undo();
    expect(library()).toEqual(before);
  });

  it('a discarded card keeps its order, drawn still', async () => {
    const { id } = await ask([
      { target: 'routine', id: 'r_upper', field: 'reorder', order: ['ex_row'] },
    ]);
    discardChanges('Workout', id);
    reorderChange('Workout', id, 0, ['r_upper_2', 'r_upper_1', 'r_upper_0']);
    expect(cardOf(id)).toMatchObject({ status: 'discarded' });
    expect(cardOf(id).changes[0]).toMatchObject({
      order: ['r_upper_1', 'r_upper_0', 'r_upper_2'],
    });
  });
});

describe('the training sequence', () => {
  it('a loop with a routine twice: the cursor stays on its step, and Undo puts it back', async () => {
    useLibrary.getState().replaceSequence({
      isActive: true,
      routineIds: ['r_upper', 'r_lower', 'r_upper'],
      cursor: 1, // Lower is next
    });
    const before = plain(useLibrary.getState().sequence);
    const { id, card } = await ask([
      { target: 'sequence', field: 'reorder', order: ['r_upper', 'r_upper', 'r_lower'] },
    ]);
    expect(card.rows[0]).toMatchObject({
      subject: 'Training sequence',
      label: 'Step order',
      to: 'Upper, Upper, Lower',
    });
    expect(card.changes[0]).toMatchObject({ order: ['0', '2', '1'] });

    const applied = applyChanges('Workout', id)!;
    expect(useLibrary.getState().sequence).toEqual({
      isActive: true,
      routineIds: ['r_upper', 'r_upper', 'r_lower'],
      cursor: 2, // still Lower
    });
    applied.undo();
    expect(plain(useLibrary.getState().sequence)).toEqual(before);
  });

  it('a switched-off loop is still shown to the model, and can be reordered', async () => {
    useLibrary.getState().replaceSequence({
      isActive: false,
      routineIds: ['r_upper', 'r_lower'],
      cursor: 0,
    });
    const { id } = await ask([{ target: 'sequence', field: 'reorder', order: ['r_lower'] }]);
    applyChanges('Workout', id)!;
    expect(useLibrary.getState().sequence).toMatchObject({
      isActive: false,
      routineIds: ['r_lower', 'r_upper'],
    });
  });

  it('is skipped at Apply when the loop changed length since the card', async () => {
    const { id } = await ask([{ target: 'sequence', field: 'reorder', order: ['r_lower'] }]);
    useLibrary.getState().addSequenceStep('r_lower');
    expect(applyChanges('Workout', id)).toBeNull();
  });
});

describe('the workout in flight', () => {
  it('reorders the cards, and Undo puts the session back', async () => {
    useActiveWorkout.getState().startSession({
      routine: UPPER,
      exercisesById: byId,
      historyByExerciseId: {},
      unitSystem: 'metric',
      defaultRestSeconds: 120,
      defaultTransitionRestSeconds: 150,
    });
    const before = plain(useActiveWorkout.getState().session);
    const { id } = await ask([
      { target: 'live', field: 'reorder', order: ['ex_dips', 'ex_row', 'ex_bench'] },
    ]);
    const applied = applyChanges('Workout', id)!;
    expect(useActiveWorkout.getState().session!.entries.map((e) => e.exercise.id)).toEqual([
      'ex_dips',
      'ex_row',
      'ex_bench',
    ]);
    applied.undo();
    expect(plain(useActiveWorkout.getState().session)).toEqual(before);
  });
});

describe('the card, stored', () => {
  it('survives a restart or a restore with its dragged order and its link to the row', async () => {
    const { id } = await ask([
      { target: 'exercise', id: 'ex_dips', field: 'name', text: 'Ring dips' },
      { target: 'routine', id: 'r_upper', field: 'reorder', order: ['ex_row'] },
    ]);
    reorderChange('Workout', id, 1, ['r_upper_2', 'r_upper_0', 'r_upper_1']);
    const restored = sanitizeAi(plain(useAi.getState()));
    const message = restored.chats.Workout.find((m) => m.id === id)!;
    if (message.role !== 'model') throw new Error('not an answer');
    const card = message.blocks.find((b): b is ChangesChatBlock => b.type === 'changes')!;
    expect(card.rows.map((r) => r.reorder)).toEqual([undefined, 1]);
    expect(card.changes[1]).toMatchObject({ order: ['r_upper_2', 'r_upper_0', 'r_upper_1'] });
  });

  it('drops a stored reorder whose order is broken, and re-points the rows', () => {
    const restored = sanitizeAi({
      chats: {
        Workout: [
          {
            id: 'm1',
            role: 'model',
            raw: '{}',
            at: '2026-11-01T00:00:00.000Z',
            blocks: [
              {
                type: 'changes',
                why: '',
                status: 'pending',
                changes: [
                  {
                    target: 'order',
                    field: 'reorder',
                    list: 'routine',
                    id: 'r_upper',
                    name: 'Upper',
                    rows: [{ key: 'a', ref: 'x', name: 'A' }],
                    order: ['b'],
                  },
                  {
                    target: 'order',
                    field: 'reorder',
                    list: 'live',
                    id: '',
                    name: '',
                    rows: [
                      { key: 'a', ref: 'x', name: 'A' },
                      { key: 'b', ref: 'y', name: 'B' },
                    ],
                    order: ['b', 'a'],
                  },
                ],
                rows: [
                  { subject: 'Upper', label: 'Exercise order', from: '', to: 'B', reorder: 0 },
                  {
                    subject: 'This workout',
                    label: 'Exercise order',
                    from: '',
                    to: 'B, A',
                    reorder: 1,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const message = restored.chats.Workout[0];
    if (message.role !== 'model') throw new Error('not an answer');
    const card = message.blocks[0] as ChangesChatBlock;
    expect(card.changes).toHaveLength(1);
    expect(card.rows.map((r) => r.reorder)).toEqual([undefined, 0]);
  });
});

describe('what the model is told', () => {
  it('to use one reorder item, and to say it reordered', async () => {
    const { systemPrompt } = await import('../lib/ai/aiPrompts');
    const prompt = systemPrompt('en');
    expect(prompt).toContain('REORDERING');
    expect(prompt).toContain('"field":"reorder"');
    expect(prompt).toContain('your text DOES say that you reordered');
    expect(prompt).toContain('"unlog"');
    expect(prompt).toContain('"timer"');
    expect(prompt).toContain('"duration_seconds"');
    expect(prompt).toContain('"distance_m"');
  });

  it('and the response schema lets it write the list', async () => {
    const { responseSchema } = await import('../lib/ai/aiSchema');
    expect(JSON.stringify(responseSchema)).toContain('"order":{"type":"array"');
  });
});
