import { describe, expect, it } from 'vitest';

import {
  applyExerciseChange,
  describeChanges,
  validateChangesReport,
  type AiChange,
  type ChangeContext,
  type CurrentValues,
} from './aiChanges';
import {
  draftWithKind,
  isDestructive,
  kindOf,
  newExercise,
  parseKind,
  parseMuscles,
  patchRoutineItems,
  type EditChange,
} from './aiEdits';
import { emptyExerciseDraft } from '../exerciseDraft';
import type { Exercise, Routine } from '../../types/models';

/**
 * The assistant's hands, from what the model wrote to what the card says. Every
 * item is untrusted, so each test is a shape a model could send: an id CONTEXT
 * never named, a handle that collides, a set that is not there, a number past
 * its control's range — dropped and counted, or held to the range, never forced.
 */

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

const BENCH = exercise({
  id: 'ex_bench',
  name: 'Bench press',
  requiresWeight: true,
  loadMode: 'external',
  defaultWeightKg: 60,
  defaultCount: 8,
});
const PULL = exercise({ id: 'ex_pull', name: 'Pull-up', ladder: { max: 10, earned: 0 } });
const PLANK = exercise({ id: 'ex_plank', name: 'Plank', countUnit: 'seconds', defaultCount: 60 });
const ROW = exercise({ id: 'ex_row', name: 'Cable row', defaultCount: 10 });

const PUSH: Routine = {
  id: 'r_push',
  ownerId: 'u1',
  name: 'Push',
  createdAt: CREATED,
  updatedAt: CREATED,
  items: [
    { id: 'i1', exerciseId: 'ex_bench', order: 0, targetSets: 4, targetRepsMax: 8 },
    { id: 'i2', exerciseId: 'ex_pull', order: 1, targetSets: 5, targetRepsMax: 10 },
    {
      id: 'i3',
      exerciseId: 'ex_row',
      order: 2,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 10,
    },
  ],
};
const LEGS: Routine = { ...PUSH, id: 'r_legs', name: 'Legs', items: [] };

const WORKOUT = {
  id: 'w1',
  startedAt: '2026-10-27T17:00:00',
  title: 'Push',
  durationMinutes: 55,
  sets: [
    { id: 's0', exerciseId: 'ex_bench', setIndex: 0, isWarmup: true, weightKg: 30, count: 10 },
    { id: 's1', exerciseId: 'ex_bench', setIndex: 1, isWarmup: false, weightKg: 60, count: 8 },
    { id: 's2', exerciseId: 'ex_bench', setIndex: 2, isWarmup: false, weightKg: 60, count: 7 },
    { id: 's3', exerciseId: 'ex_row', setIndex: 0, isWarmup: false, weightKg: null, count: 12 },
  ],
  exercises: [
    { exerciseId: 'ex_bench', name: 'Bench press' },
    { exerciseId: 'ex_row', name: 'Cable row' },
  ],
};

const SESSION = {
  entries: [
    {
      localId: 'e1',
      exercise: BENCH,
      sets: [
        { localId: 'd1', weightKg: 60, count: 8, isWarmup: false, isCompleted: true },
        { localId: 'd2', weightKg: 60, count: 8, isWarmup: false, isCompleted: false },
      ],
    },
    {
      localId: 'e2',
      exercise: ROW,
      sets: [{ localId: 'd3', weightKg: null, count: 10, isWarmup: false, isCompleted: false }],
    },
  ],
};

const ctx: ChangeContext = {
  exercises: [BENCH, PULL, PLANK, ROW],
  routines: [PUSH, LEGS],
  workouts: [WORKOUT],
  sequence: { isActive: true, routineIds: ['r_push', 'r_legs', 'r_push'], cursor: 1 },
  session: SESSION,
  today: '2026-11-15',
};

const report = (items: unknown[], over: Partial<ChangeContext> = {}) =>
  validateChangesReport(items, { ...ctx, ...over });
const one = (item: Record<string, unknown>, over: Partial<ChangeContext> = {}) =>
  report([item], over).changes[0] as EditChange | undefined;

const NOW: CurrentValues = {
  exercises: ctx.exercises,
  settings: { restSecondsBetweenSets: 120, restSecondsBetweenExercises: 150, autoStartRest: true },
  formatDay: (day) => day.slice(5),
};
const rowsOf = (items: unknown[]) =>
  describeChanges(report(items).changes, NOW, 'en').map(
    (r) => `${r.subject} | ${r.label} | ${r.from} → ${r.to}${r.destructive ? ' !' : ''}`,
  );

/* ------------------------------------------------------------------ */

describe('exercises', () => {
  it('creates one under a handle, and later items may point at it — in either order', () => {
    const { changes, dropped } = report([
      { target: 'routine_item', id: 'r_legs', exerciseId: 'new_1', field: 'add' },
      {
        target: 'exercise',
        id: 'new_1',
        field: 'create',
        name: 'Farmer carry',
        kind: 'meters',
        muscle: 'forearms',
      },
      { target: 'exercise', id: 'new_1', field: 'sets', number: 3 },
    ]);
    expect(dropped).toBe(0);
    expect(changes.map((c) => `${c.target}:${c.field}`)).toEqual([
      'routine_item:add',
      'exercise_create:create',
      'exercise:sets',
    ]);
    expect(changes[1]).toMatchObject({
      ref: 'new_1',
      name: 'Farmer carry',
      kind: 'meters',
      muscle: 'forearms',
    });
  });

  it('refuses a handle that is already a real id, and a create with no name', () => {
    expect(
      report([{ target: 'exercise', id: 'ex_bench', field: 'create', name: 'X' }]).dropped,
    ).toBe(1);
    expect(report([{ target: 'exercise', id: 'new_1', field: 'create' }]).dropped).toBe(1);
  });

  it('a field change a stand-in cannot take is dropped like a real one', () => {
    // A timed exercise has no ladder, created or not.
    const { changes, dropped } = report([
      { target: 'exercise', id: 'n', field: 'create', name: 'Hang', kind: 'seconds' },
      { target: 'exercise', id: 'n', field: 'ladder', number: 8 },
    ]);
    expect(changes).toHaveLength(1);
    expect(dropped).toBe(1);
  });

  it('renames, re-files, re-kinds and re-weights through the editor’s rules', () => {
    const on = (item: Record<string, unknown>) =>
      one({ target: 'exercise', id: 'ex_bench', ...item });
    expect(on({ field: 'name', text: '  Flat  bench ' })?.value).toBe('Flat bench');
    expect(on({ field: 'name', text: 'Bench press' })).toBeUndefined();
    expect(on({ field: 'muscles', text: 'Triceps, chest, wings' })?.value).toEqual([
      'triceps',
      'chest',
    ]);
    expect(on({ field: 'kind', text: 'reps' })?.value).toBe('reps');
    expect(on({ field: 'kind', text: 'plates' })).toBeUndefined(); // already weighted
    expect(on({ field: 'start_weight', number: 62.6 })?.value).toBe(62.5);
    expect(
      one({ target: 'exercise', id: 'ex_row', field: 'start_weight', number: 5 }),
    ).toBeUndefined();

    const reKinded = applyExerciseChange(BENCH, {
      target: 'exercise',
      id: 'ex_bench',
      field: 'kind',
      value: 'seconds',
    });
    expect(reKinded).toMatchObject({
      id: 'ex_bench',
      requiresWeight: false,
      loadMode: 'none',
      countUnit: 'seconds',
    });
    expect(reKinded.createdAt).toBe(CREATED);
    const moved = applyExerciseChange(
      BENCH,
      { target: 'exercise', id: 'ex_bench', field: 'start_weight', value: 65 },
      new Date('2026-11-15T10:00:00Z'),
    );
    expect(moved).toMatchObject({
      defaultWeightKg: 65,
      startWeightSetAt: '2026-11-15T10:00:00.000Z',
    });
  });

  it('deletes one, flagged destructive, and never an id it does not know', () => {
    expect(one({ target: 'exercise', id: 'ex_row', field: 'delete' })).toEqual({
      target: 'exercise_delete',
      field: 'delete',
      id: 'ex_row',
      name: 'Cable row',
    });
    expect(one({ target: 'exercise', id: 'ex_nope', field: 'delete' })).toBeUndefined();
    expect(rowsOf([{ target: 'exercise', id: 'ex_row', field: 'delete' }])).toEqual([
      'Cable row | Delete exercise |  → Deleted !',
    ]);
  });
});

describe('routines and their rows', () => {
  it('create, rename, duplicate, delete', () => {
    expect(
      rowsOf([
        { target: 'routine', id: 'r_new', field: 'create', name: 'Arms' },
        { target: 'routine', id: 'r_push', field: 'rename', text: 'Push A' },
        { target: 'routine', id: 'r_push', field: 'duplicate', text: 'Push B' },
        { target: 'routine', id: 'r_legs', field: 'delete' },
        { target: 'routine', id: 'r_gone', field: 'delete' },
      ]),
    ).toEqual([
      'Arms | New routine |  → Created',
      'Push | Name | Push → Push A',
      'Push | Duplicate this routine |  → Push B',
      'Legs | Delete routine |  → Deleted !',
    ]);
  });

  it('a row edit needs the row — in the routine now, or added earlier on the card', () => {
    expect(
      one({
        target: 'routine_item',
        id: 'r_legs',
        exerciseId: 'ex_bench',
        field: 'sets',
        number: 3,
      }),
    ).toBeUndefined();
    const { changes } = report([
      { target: 'routine_item', id: 'r_legs', exerciseId: 'ex_bench', field: 'add', number: 1 },
      { target: 'routine_item', id: 'r_legs', exerciseId: 'ex_bench', field: 'sets', number: 99 },
    ]);
    expect(changes[0]).toMatchObject({ field: 'add', value: 0 });
    expect(changes[1]).toMatchObject({ field: 'sets', value: 20, was: null });
  });

  it('reps are not offered on a ladder; a range floor of 0 turns the range off', () => {
    expect(
      one({
        target: 'routine_item',
        id: 'r_push',
        exerciseId: 'ex_pull',
        field: 'reps',
        number: 8,
      }),
    ).toBeUndefined();
    expect(
      one({
        target: 'routine_item',
        id: 'r_push',
        exerciseId: 'ex_row',
        field: 'reps_min',
        number: 0,
      }),
    ).toMatchObject({ value: null, was: 8 });
    expect(
      rowsOf([
        { target: 'routine_item', id: 'r_push', exerciseId: 'ex_row', field: 'remove' },
        { target: 'routine_item', id: 'r_push', exerciseId: 'ex_bench', field: 'move', number: 3 },
        { target: 'routine_item', id: 'r_push', exerciseId: 'ex_bench', field: 'reps', number: 6 },
      ]),
    ).toEqual([
      'Push | Cable row |  → Removed !',
      'Push | Bench press | #1 → #3',
      'Push · Bench press | Reps | 8 → 6',
    ]);
  });

  it('patches rows through the editor’s own steppers', () => {
    const change = (field: string, value: number | null) =>
      ({
        target: 'routine_item',
        field,
        id: 'r_push',
        exerciseId: 'ex_row',
        routineName: '',
        exerciseName: '',
        value,
      }) as Extract<EditChange, { target: 'routine_item' }>;
    // The floor follows the target down, as `bumpTargetCount` makes it.
    const lower = patchRoutineItems(PUSH.items, change('reps', 6), 'reps')!;
    expect(lower.find((i) => i.id === 'i3')).toMatchObject({ targetRepsMax: 6, targetRepsMin: 6 });
    const noRange = patchRoutineItems(PUSH.items, change('reps_min', null), 'reps')!;
    expect(noRange.find((i) => i.id === 'i3')?.targetRepsMin).toBeUndefined();
    const moved = patchRoutineItems(PUSH.items, change('move', 0), 'reps')!;
    expect(moved.map((i) => `${i.order}:${i.exerciseId}`)).toEqual([
      '0:ex_row',
      '1:ex_bench',
      '2:ex_pull',
    ]);
    const removed = patchRoutineItems(PUSH.items, change('remove', null), 'reps')!;
    expect(removed.map((i) => `${i.order}:${i.exerciseId}`)).toEqual(['0:ex_bench', '1:ex_pull']);
    expect(patchRoutineItems(LEGS.items, change('sets', 3), 'reps')).toBeNull();
  });
});

describe('the loop', () => {
  it('switch, next, and vary a step only where the routine repeats', () => {
    expect(one({ target: 'sequence', field: 'on', on: false })).toMatchObject({
      value: false,
      wasOn: true,
    });
    expect(one({ target: 'sequence', field: 'next', number: 3 })).toMatchObject({
      value: 2,
      routineName: 'Push',
      wasName: 'Legs',
    });
    expect(one({ target: 'sequence', field: 'next', number: 4 })).toBeUndefined();
    expect(one({ target: 'sequence', field: 'vary', number: 1 })).toMatchObject({ value: 0 });
    expect(one({ target: 'sequence', field: 'vary', number: 2 })).toBeUndefined();
    expect(
      one(
        { target: 'sequence', field: 'on', on: true },
        { sequence: { isActive: false, routineIds: [], cursor: 0 } },
      ),
    ).toBeUndefined();
  });
});

describe('a saved workout', () => {
  it('rename, a day in the past, a time, a length, a number', () => {
    expect(
      rowsOf([
        { target: 'workout', id: 'w1', field: 'rename', text: 'Push heavy' },
        { target: 'workout', id: 'w1', field: 'date', text: '2026-10-26' },
        { target: 'workout', id: 'w1', field: 'start_time', text: '7:30' },
        { target: 'workout', id: 'w1', field: 'duration', number: 9999 },
        { target: 'workout', id: 'w1', field: 'number', number: 91 },
      ]),
    ).toEqual([
      'Push · 10-27 | Name | Push → Push heavy',
      'Push · 10-27 | Day | 10-27 → 10-26',
      'Push · 10-27 | Start time | 17:00 → 07:30',
      'Push · 10-27 | Length | 55 min → 600 min',
      'Push · 10-27 | Workout number |  → #91',
    ]);
    expect(one({ target: 'workout', id: 'w1', field: 'date', text: '2026-12-01' })).toBeUndefined();
    expect(one({ target: 'workout', id: 'w1', field: 'date', text: '2026-02-31' })).toBeUndefined();
    expect(
      one({ target: 'workout', id: 'w1', field: 'start_time', text: '25:00' }),
    ).toBeUndefined();
    expect(one({ target: 'workout', id: 'w_gone', field: 'rename', text: 'x' })).toBeUndefined();
  });

  it('adds an exercise it does not have; removes one only while another stays', () => {
    expect(
      one({ target: 'workout', id: 'w1', field: 'add_exercise', exerciseId: 'ex_plank' }),
    ).toMatchObject({ exerciseName: 'Plank' });
    expect(
      one({ target: 'workout', id: 'w1', field: 'add_exercise', exerciseId: 'ex_bench' }),
    ).toBeUndefined();
    expect(
      one({ target: 'workout', id: 'w1', field: 'remove_exercise', exerciseId: 'ex_row' }),
    ).toMatchObject({ exerciseName: 'Cable row' });
    const lonely = { ...WORKOUT, sets: WORKOUT.sets.filter((s) => s.exerciseId === 'ex_row') };
    expect(
      one(
        { target: 'workout', id: 'w1', field: 'remove_exercise', exerciseId: 'ex_row' },
        { workouts: [lonely] },
      ),
    ).toBeUndefined();
    expect(isDestructive({ target: 'workout', field: 'delete' })).toBe(true);
  });

  it('a set is its place among the WORKING sets, resolved to its row now', () => {
    const { changes } = report([
      {
        target: 'workout_set',
        id: 'w1',
        exerciseId: 'ex_bench',
        field: 'weight',
        set: 2,
        number: 62.5,
      },
      { target: 'workout_set', id: 'w1', exerciseId: 'ex_bench', field: 'delete', set: 1 },
      { target: 'workout_set', id: 'w1', exerciseId: 'ex_bench', field: 'reps', set: 1, number: 9 },
      { target: 'workout_set', id: 'w1', exerciseId: 'ex_bench', field: 'add' },
      { target: 'workout_set', id: 'w1', exerciseId: 'ex_bench', field: 'add' },
    ]);
    expect(changes).toHaveLength(5); // two adds are two sets, not one said twice
    expect(changes[0]).toMatchObject({ setId: 's2', was: 60, value: 62.5 });
    expect(changes[1]).toMatchObject({ setId: 's1', field: 'delete' });
    expect(changes[2]).toMatchObject({ setId: 's1', was: 8, value: 9 });
  });

  it('refuses a weight on an unweighted set, a set that is not there', () => {
    expect(
      one({
        target: 'workout_set',
        id: 'w1',
        exerciseId: 'ex_row',
        field: 'weight',
        set: 1,
        number: 20,
      }),
    ).toBeUndefined();
    expect(
      one({
        target: 'workout_set',
        id: 'w1',
        exerciseId: 'ex_bench',
        field: 'reps',
        set: 3,
        number: 5,
      }),
    ).toBeUndefined();
    expect(
      one({ target: 'workout_set', id: 'w1', exerciseId: 'ex_plank', field: 'add' }),
    ).toBeUndefined();
  });

  it('still reads a warm-up correction, the place written as `set`', () => {
    const change = report([
      {
        target: 'workout_set',
        id: 'w1',
        exerciseId: 'ex_bench',
        field: 'kind',
        set: 1,
        text: 'warmup',
      },
    ]).changes[0];
    expect(change).toMatchObject({ field: 'kind', setId: 's1', value: 'warmup' });
  });
});

describe('the workout in flight', () => {
  it('exists only while one is open', () => {
    expect(
      one({ target: 'live', field: 'add_set', exerciseId: 'ex_bench' }, { session: null }),
    ).toBeUndefined();
  });

  it('cards: add from the library, remove, one more set, move', () => {
    expect(
      rowsOf([
        { target: 'live', field: 'add_exercise', exerciseId: 'ex_plank' },
        { target: 'live', field: 'remove_exercise', exerciseId: 'ex_row' },
        { target: 'live', field: 'add_set', exerciseId: 'ex_bench' },
        { target: 'live', field: 'move_exercise', exerciseId: 'ex_row', number: 1 },
        { target: 'live', field: 'move_exercise', exerciseId: 'ex_row', number: 3 },
      ]),
    ).toEqual([
      'This workout | Plank |  → Added',
      'This workout | Cable row |  → Removed !',
      'This workout | Bench press |  → +1 set',
      'This workout | Cable row | #2 → #1',
    ]);
    // #3 of 2 cards is dropped, so the first move is what stays.
    const { changes, dropped } = report([
      { target: 'live', field: 'move_exercise', exerciseId: 'ex_row', number: 1 },
      { target: 'live', field: 'move_exercise', exerciseId: 'ex_row', number: 3 },
    ]);
    expect(changes).toEqual([expect.objectContaining({ entryId: 'e2', was: 1, value: 0 })]);
    expect(dropped).toBe(1);
  });

  it('rows: weight, reps, log (only an open one), remove', () => {
    expect(
      one({ target: 'live_set', field: 'weight', exerciseId: 'ex_bench', set: 2, number: 62.5 }),
    ).toMatchObject({ entryId: 'e1', setId: 'd2', was: 60, value: 62.5 });
    expect(
      one({ target: 'live_set', field: 'reps', exerciseId: 'ex_row', set: 1, number: 12 }),
    ).toMatchObject({ setId: 'd3', value: 12 });
    expect(
      one({ target: 'live_set', field: 'weight', exerciseId: 'ex_row', set: 1, number: 12 }),
    ).toBeUndefined();
    expect(
      one({ target: 'live_set', field: 'log', exerciseId: 'ex_bench', set: 1 }),
    ).toBeUndefined();
    expect(one({ target: 'live_set', field: 'log', exerciseId: 'ex_bench', set: 2 })).toMatchObject(
      { setId: 'd2' },
    );
    expect(
      one({ target: 'live_set', field: 'remove', exerciseId: 'ex_bench', set: 3 }),
    ).toBeUndefined();
  });
});

describe('settings past the rests', () => {
  const setting = (item: Record<string, unknown>) =>
    report([{ target: 'setting', ...item }]).changes[0] as AiChange | undefined;

  it('switches, steppers on their grid, units, language, weekly targets', () => {
    expect(setting({ field: 'sound', on: false })).toEqual({
      target: 'setting',
      field: 'sound',
      value: false,
    });
    expect(setting({ field: 'haptics', text: 'off' })).toMatchObject({
      field: 'vibration',
      value: false,
    });
    expect(setting({ field: 'timer_step', number: 22 })).toMatchObject({ value: 20 });
    expect(setting({ field: 'get_ready', number: 99 })).toMatchObject({ value: 60 });
    expect(setting({ field: 'units', text: 'lb' })).toMatchObject({ value: 'imperial' });
    expect(setting({ field: 'language', text: 'Russian' })).toMatchObject({ value: 'ru' });
    expect(setting({ field: 'language', text: 'de' })).toBeUndefined();
    expect(setting({ field: 'weekly_target', text: 'push', number: 14 })).toMatchObject({
      cluster: 'push',
      value: 14,
    });
    expect(setting({ field: 'weekly_target', text: 'push', number: 0 })).toMatchObject({
      value: null,
    });
    expect(setting({ field: 'weekly_target', text: 'arms', number: 4 })).toBeUndefined();
  });

  it('two clusters are two targets, not one said twice', () => {
    const { changes } = report([
      { target: 'setting', field: 'weekly_target', text: 'push', number: 10 },
      { target: 'setting', field: 'weekly_target', text: 'pull', number: 12 },
    ]);
    expect(changes).toHaveLength(2);
  });

  it('describes each with what is in force now', () => {
    const rows = describeChanges(
      report([
        { target: 'setting', field: 'units', text: 'imperial' },
        { target: 'setting', field: 'sound', on: false },
      ]).changes,
      { ...NOW, settings: { ...NOW.settings, unitSystem: 'metric', soundEnabled: true } },
      'en',
    );
    expect(rows.map((r) => `${r.label} | ${r.from} → ${r.to}`)).toEqual([
      'Units | Kilograms → Pounds',
      'Sound | On → Off',
    ]);
  });
});

describe('what is dropped', () => {
  it('is counted: unknown targets, non-objects, ids nobody named', () => {
    const { changes, dropped } = report([
      'x',
      { target: 'task', field: 'archive' },
      { target: 'routine', id: 'r_nope', field: 'rename', text: 'A' },
      { target: 'routine', id: 'r_push', field: 'rename', text: 'Push A' },
    ]);
    expect(changes).toHaveLength(1);
    expect(dropped).toBe(3);
  });
});

describe('kinds and muscles', () => {
  it('reads the words a model uses', () => {
    expect(parseKind('Plates')).toBe('weighted');
    expect(parseKind('added bodyweight')).toBe('bodyweight_plus');
    expect(parseKind('metres')).toBe('meters');
    expect(parseKind('yoga')).toBeNull();
    expect(parseMuscles(['quad', 'glutes', 'quads'])).toEqual(['quads', 'glutes']);
  });

  it('a new exercise is built the way `Create` builds it', () => {
    const made = newExercise({
      id: 'ex_x',
      ownerId: 'u1',
      name: 'Plank row',
      kind: 'seconds',
      restSeconds: 90,
      ladderAll: false,
    });
    expect(made).toMatchObject({
      id: 'ex_x',
      name: 'Plank row',
      requiresWeight: false,
      countUnit: 'seconds',
      loadMode: 'none',
    });
    expect(made.defaultRestSeconds).toBeUndefined(); // follows the setting
    expect(kindOf(made)).toBe('seconds');
    const assisted = draftWithKind(emptyExerciseDraft('Dip'), 'assisted');
    expect(assisted).toMatchObject({
      requiresWeight: true,
      countUnit: 'reps',
      loadMode: 'assisted',
    });
  });
});

/* ------------------------------------------------------------------ */
/* The three left out at first: warm-up, max test, weigh-in reminder   */
/* ------------------------------------------------------------------ */

describe('the warm-up toggle on a card in flight', () => {
  const fresh = {
    entries: [
      {
        localId: 'e1',
        exercise: BENCH,
        sets: [
          { localId: 'd1', weightKg: 60, count: 8, isWarmup: false, isCompleted: false },
          { localId: 'd2', weightKg: 60, count: 8, isWarmup: false, isCompleted: false },
        ],
      },
      {
        localId: 'e2',
        exercise: ROW,
        sets: [
          { localId: 'w1', weightKg: null, count: 10, isWarmup: true, isCompleted: false },
          { localId: 'd3', weightKg: null, count: 10, isWarmup: false, isCompleted: false },
        ],
      },
    ],
  };
  const warm = (item: Record<string, unknown>, session: ChangeContext['session'] = fresh) =>
    one({ target: 'live', field: 'warmup', ...item }, { session });

  it('goes the way the toggle would — and an `on` it cannot honour is dropped, not flipped', () => {
    expect(warm({ exerciseId: 'ex_bench', on: true })).toMatchObject({ entryId: 'e1', on: true });
    expect(warm({ exerciseId: 'ex_bench' })).toMatchObject({ on: true });
    expect(warm({ exerciseId: 'ex_bench', on: false })).toBeUndefined();
    expect(warm({ exerciseId: 'ex_row', field: 'warm_up', on: false })).toMatchObject({
      entryId: 'e2',
      on: false,
    });
    expect(warm({ exerciseId: 'ex_row', on: true })).toBeUndefined();
  });

  it('not above a set already logged, not on an exercise the workout does not hold', () => {
    // SESSION's bench has its first set logged: the toggle is gone.
    expect(warm({ exerciseId: 'ex_bench', on: true }, SESSION)).toBeUndefined();
    expect(warm({ exerciseId: 'ex_plank', on: true })).toBeUndefined();
    expect(warm({ exerciseId: 'ex_bench' }, null)).toBeUndefined();
  });

  it('says On/Off, and taking it off is red', () => {
    const rows = describeChanges(
      report(
        [
          { target: 'live', field: 'warmup', exerciseId: 'ex_bench', on: true },
          { target: 'live', field: 'warmup', exerciseId: 'ex_row', on: false },
        ],
        { session: fresh },
      ).changes,
      NOW,
      'en',
    ).map((r) => `${r.subject} | ${r.label} | ${r.from} → ${r.to}${r.destructive ? ' !' : ''}`);
    expect(rows).toEqual([
      'This workout | Bench press · Warm-up | Off → On',
      'This workout | Cable row · Warm-up | On → Off !',
    ]);
    expect(isDestructive({ target: 'live', field: 'warmup', on: true })).toBe(false);
  });
});

describe('find my max in the next workout', () => {
  const WAITING = exercise({
    id: 'ex_chin',
    name: 'Chin-up',
    ladder: { max: 12, earned: 0, awaitingMax: true },
  });
  const MAXED = exercise({ id: 'ex_dip', name: 'Dips', defaultCount: 10, countToMax: true });
  const findCtx = { exercises: [...ctx.exercises, WAITING, MAXED] };
  const find = (id: string, field = 'find_max') =>
    report([{ target: 'exercise', id, field, on: true }], findCtx).changes[0];

  it('on a rep exercise without a ladder, or as a retest of one; never while already waiting', () => {
    expect(find('ex_row')).toEqual({
      target: 'exercise',
      id: 'ex_row',
      field: 'find_max',
      value: true,
    });
    expect(find('ex_pull', 'retest')).toMatchObject({ field: 'find_max' });
    expect(find('ex_chin')).toBeUndefined();
    expect(find('ex_plank')).toBeUndefined();
    expect(find('ex_nope')).toBeUndefined();
  });

  it("applies through the editor's own button: waiting, earned gone, MAX off", () => {
    const climbed = { ...PULL, ladder: { max: 10, earned: 3 } };
    const retest = applyExerciseChange(climbed, {
      target: 'exercise',
      id: PULL.id,
      field: 'find_max',
      value: true,
    });
    expect(retest.ladder).toEqual({ max: 10, earned: 0, awaitingMax: true });
    const fromMax = applyExerciseChange(MAXED, {
      target: 'exercise',
      id: MAXED.id,
      field: 'find_max',
      value: true,
    });
    expect(fromMax.ladder?.awaitingMax).toBe(true);
    expect(fromMax.countToMax).toBeUndefined();
    expect(fromMax.id).toBe(MAXED.id);
  });

  it('the card says what the ladder is now, waiting included', () => {
    const rows = describeChanges(
      report(
        [
          { target: 'exercise', id: 'ex_pull', field: 'find_max' },
          { target: 'exercise', id: 'ex_row', field: 'find_max' },
          { target: 'exercise', id: 'ex_chin', field: 'ladder', number: 14 },
        ],
        findCtx,
      ).changes,
      { ...NOW, exercises: findCtx.exercises },
      'en',
    ).map((r) => `${r.subject} | ${r.label} | ${r.from} → ${r.to}`);
    expect(rows).toEqual([
      'Pull-up | Rep ladder | 10 → Find my max in the next workout',
      'Cable row | Rep ladder | Off → Find my max in the next workout',
      'Chin-up | Rep ladder max | MAX, then the ladder → 14',
    ]);
  });
});

describe('the weigh-in reminder', () => {
  const setting = (item: Record<string, unknown>) =>
    report([{ target: 'setting', ...item }]).changes[0] as AiChange | undefined;

  it('a switch, a set of days by name, a time', () => {
    expect(setting({ field: 'weigh_in_reminder', on: false })).toEqual({
      target: 'setting',
      field: 'weigh_in_reminder',
      value: false,
    });
    expect(setting({ field: 'weigh_in_days', text: 'Sun, wed and Mon' })).toMatchObject({
      value: [0, 2, 6],
    });
    expect(setting({ field: 'weigh_in_days', text: 'пн и чт' })).toMatchObject({ value: [0, 3] });
    expect(setting({ field: 'weigh_in_time', text: '7:05' })).toMatchObject({ value: '07:05' });
  });

  it('drops what would arm the wrong morning or none at all', () => {
    // Numbers are Monday = 1 to a person and 0 to the app: refused, not guessed.
    expect(setting({ field: 'weigh_in_days', text: '2, 6' })).toBeUndefined();
    expect(setting({ field: 'weigh_in_days', text: 'Wed, Funday' })).toBeUndefined();
    expect(setting({ field: 'weigh_in_days', text: '' })).toBeUndefined();
    expect(setting({ field: 'weigh_in_time', text: '25:00' })).toBeUndefined();
    expect(setting({ field: 'weigh_in_time', text: 'morning' })).toBeUndefined();
  });

  it('describes each against what is set now', () => {
    const rows = describeChanges(
      report([
        { target: 'setting', field: 'weigh_in_reminder', on: true },
        { target: 'setting', field: 'weigh_in_days', text: 'mon, thu' },
        { target: 'setting', field: 'weigh_in_time', text: '07:30' },
      ]).changes,
      {
        ...NOW,
        settings: {
          ...NOW.settings,
          weighInReminderEnabled: false,
          weighInReminderDays: [2, 6],
          weighInReminderTime: '06:00',
        },
      },
      'en',
    ).map((r) => `${r.subject} | ${r.label} | ${r.from} → ${r.to}`);
    expect(rows).toEqual([
      'Settings | Remind me to weigh in | Off → On',
      'Weigh-in reminder | On which days | Wed, Sun → Mon, Thu',
      'Weigh-in reminder | At what time | 06:00 → 07:30',
    ]);
    // And in Russian, from the same catalogue the screen uses.
    const ru = describeChanges(
      report([{ target: 'setting', field: 'weigh_in_days', text: 'mon' }]).changes,
      NOW,
      'ru',
    )[0];
    expect(ru.label).toBe('В какие дни');
  });
});
