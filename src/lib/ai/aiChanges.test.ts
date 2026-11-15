import { describe, expect, it } from 'vitest';

import {
  CUE_MAX,
  applyExerciseChange,
  describeChanges,
  validateChanges,
  type AiChange,
  type ChangeContext,
  type CurrentValues,
} from './aiChanges';
import type { Exercise } from '../../types/models';

/**
 * The settings card, from what the model wrote to what Apply writes. The model's
 * items are untrusted, so every test here is a shape it could send — and the
 * rule is the one every suggestion keeps: an id the context never named, a field
 * the exercise cannot take, a target the app does not have, is dropped, never
 * forced; a number is held to its own editor's range.
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
  defaultSets: 3,
  defaultRestSeconds: 120,
  incrementKg: 2.5,
  cue: 'Tuck elbows',
});
const PULL = exercise({
  id: 'ex_pull',
  name: 'Pull-up',
  defaultCount: 10,
  ladder: { max: 10, earned: 4 },
});
const PLANK = exercise({
  id: 'ex_plank',
  name: 'Plank',
  countUnit: 'seconds',
  defaultCount: 60,
  prepareSeconds: 5,
});
const DIPS = exercise({ id: 'ex_dips', name: 'Dips', countToMax: true, defaultCount: 15 });
const OLD = exercise({ id: 'ex_old', name: 'Old row', isArchived: true });
const EXERCISES = [BENCH, PULL, PLANK, DIPS, OLD];

const ctx: ChangeContext = { exercises: EXERCISES };
const workout = (items: unknown[]) => validateChanges(items, ctx);

/** The one change an item validates to, or undefined. */
const one = (item: Record<string, unknown>) => workout([item])[0];
const onBench = (item: Record<string, unknown>) =>
  one({ target: 'exercise', id: 'ex_bench', ...item });

/* ------------------------------------------------------------------ */

describe('exercise changes', () => {
  it('rest: a number, clamped, under any spelling of the field', () => {
    expect(onBench({ field: 'rest_seconds', number: 90 })).toEqual({
      target: 'exercise',
      id: 'ex_bench',
      field: 'rest_seconds',
      value: 90,
    });
    for (const field of ['rest', 'Rest Seconds', 'rest-seconds', ' REST_SECONDS ']) {
      expect(onBench({ field, number: 75 })?.value).toBe(75);
    }
    expect(onBench({ field: 'rest', number: 2000 })?.value).toBe(900);
    expect(onBench({ field: 'rest', number: -5 })?.value).toBe(0);
    expect(onBench({ field: 'rest', number: '60' })?.value).toBe(60);
    expect(onBench({ field: 'rest' })).toBeUndefined();
  });

  it('rest: "follow", "default" or on:false sends it back to the setting', () => {
    for (const item of [
      { text: 'follow' },
      { text: 'Default' },
      { text: 'settings' },
      { on: false },
    ]) {
      expect(onBench({ field: 'rest', ...item })?.value).toBeNull();
    }
  });

  it('sets: rounded and held to 1–20', () => {
    expect(onBench({ field: 'sets', number: 3.6 })?.value).toBe(4);
    expect(onBench({ field: 'default_sets', number: 0 })?.value).toBe(1);
    expect(onBench({ field: 'sets', number: 50 })?.value).toBe(20);
    expect(onBench({ field: 'sets', number: 'lots' })).toBeUndefined();
  });

  it('rep target: reps only, never on a ladder exercise, held to 1–100', () => {
    expect(onBench({ field: 'reps', number: 12 })?.value).toBe(12);
    expect(onBench({ field: 'target_reps', number: 500 })?.value).toBe(100);
    // A ladder's rep number is its max — that goes through `ladder`.
    expect(
      one({ target: 'exercise', id: 'ex_pull', field: 'rep_target', number: 12 }),
    ).toBeUndefined();
    expect(
      one({ target: 'exercise', id: 'ex_plank', field: 'rep_target', number: 45 }),
    ).toBeUndefined();
  });

  it('max reps: a flag, from on or a word, reps only', () => {
    expect(onBench({ field: 'max_reps', on: true })?.value).toBe(true);
    expect(onBench({ field: 'count_to_max', text: 'yes' })?.value).toBe(true);
    expect(onBench({ field: 'max_reps', text: 'Disabled' })?.value).toBe(false);
    expect(onBench({ field: 'max_reps', text: 'maybe' })).toBeUndefined();
    expect(
      one({ target: 'exercise', id: 'ex_plank', field: 'max_reps', on: true }),
    ).toBeUndefined();
  });

  it('ladder: a max switches it on, held to 1–100', () => {
    expect(onBench({ field: 'ladder', number: 12 })?.value).toBe(12);
    expect(onBench({ field: 'ladder_max', number: 500 })?.value).toBe(100);
    expect(one({ target: 'exercise', id: 'ex_pull', field: 'rep_ladder', number: 14 })?.value).toBe(
      14,
    );
  });

  it('ladder: on:true alone starts at the current number', () => {
    expect(onBench({ field: 'ladder', on: true })?.value).toBe(8);
    expect(one({ target: 'exercise', id: 'ex_pull', field: 'ladder', on: true })?.value).toBe(10);
    // Nothing to start from: no number, no default — dropped.
    const blank = exercise({ id: 'ex_blank', name: 'Blank' });
    expect(
      validateChanges([{ target: 'exercise', id: 'ex_blank', field: 'ladder', on: true }], {
        ...ctx,
        exercises: [blank],
      }),
    ).toEqual([]);
  });

  it('ladder: off only where there is one, and never on a timed exercise', () => {
    expect(
      one({ target: 'exercise', id: 'ex_pull', field: 'ladder', on: false })?.value,
    ).toBeNull();
    expect(onBench({ field: 'ladder', on: false })).toBeUndefined();
    expect(
      one({ target: 'exercise', id: 'ex_plank', field: 'ladder', number: 30 }),
    ).toBeUndefined();
    expect(one({ target: 'exercise', id: 'ex_plank', field: 'ladder', on: true })).toBeUndefined();
  });

  it('increment: weighted only, positive, on a quarter-kg grid, held to 0.25–50', () => {
    expect(onBench({ field: 'increment_kg', number: 1.3 })?.value).toBe(1.25);
    expect(onBench({ field: 'increment', number: 0.1 })?.value).toBe(0.25);
    expect(onBench({ field: 'increment', number: 100 })?.value).toBe(50);
    expect(onBench({ field: 'increment', number: 0 })).toBeUndefined();
    expect(onBench({ field: 'increment', number: -2 })).toBeUndefined();
    expect(
      one({ target: 'exercise', id: 'ex_pull', field: 'increment', number: 2.5 }),
    ).toBeUndefined();
  });

  it('cue: one tidy line, capped; an empty text clears it', () => {
    expect(onBench({ field: 'cue', text: '  Keep   chest\nup ' })?.value).toBe('Keep chest up');
    expect(onBench({ field: 'form_cue', text: '' })?.value).toBe('');
    expect(onBench({ field: 'cue', text: '   ' })?.value).toBe('');
    expect((onBench({ field: 'cue', text: 'x'.repeat(500) })?.value as string).length).toBe(
      CUE_MAX,
    );
    expect(onBench({ field: 'cue' })).toBeUndefined();
    expect(onBench({ field: 'cue', number: 3 })).toBeUndefined();
  });

  it('get-ready countdown: timed only, held to 0–60', () => {
    const plank = (item: Record<string, unknown>) =>
      one({ target: 'exercise', id: 'ex_plank', ...item });
    expect(plank({ field: 'prepare_seconds', number: 10 })?.value).toBe(10);
    expect(plank({ field: 'countdown', number: 99 })?.value).toBe(60);
    expect(plank({ field: 'countdown', number: -1 })?.value).toBe(0);
    expect(onBench({ field: 'prepare_seconds', number: 10 })).toBeUndefined();
  });

  it('drops an unknown field, an unknown id, an archived exercise, and junk', () => {
    expect(onBench({ field: 'colour', text: 'red' })).toBeUndefined();
    expect(onBench({ field: 42, number: 1 })).toBeUndefined();
    expect(one({ target: 'exercise', id: 'ex_nope', field: 'rest', number: 60 })).toBeUndefined();
    expect(one({ target: 'exercise', id: 'ex_old', field: 'rest', number: 60 })).toBeUndefined();
    expect(one({ target: 'exercise', field: 'rest', number: 60 })).toBeUndefined();
    expect(one({ target: 'routine', id: 'ex_bench', field: 'rest', number: 60 })).toBeUndefined();
    expect(workout([null, 'rest 60', 3, ['x'], {}])).toEqual([]);
  });

  it('reads an id with stray spaces', () => {
    expect(one({ target: 'exercise', id: ' ex_bench ', field: 'rest', number: 60 })?.value).toBe(
      60,
    );
  });
});

describe('app settings', () => {
  const setting = (item: Record<string, unknown>) => one({ target: 'setting', ...item });

  it('rest between sets / exercises: on the 15-second grid, clamped', () => {
    expect(setting({ field: 'rest_between_sets', number: 100 })).toEqual({
      target: 'setting',
      field: 'rest_between_sets',
      value: 105,
    });
    expect(setting({ field: 'rest seconds between sets', number: 90 })?.value).toBe(90);
    expect(setting({ field: 'rest_between_exercises', number: 2000 })?.value).toBe(900);
    expect(setting({ field: 'rest_seconds_between_exercises', number: -30 })?.value).toBe(0);
    expect(setting({ field: 'rest_between_sets' })).toBeUndefined();
  });

  it('auto rest: a flag', () => {
    expect(setting({ field: 'auto_rest', on: false })?.value).toBe(false);
    expect(setting({ field: 'auto_start_rest', text: 'On' })?.value).toBe(true);
    expect(setting({ field: 'auto_rest', number: 1 })).toBeUndefined();
  });

  it('the retired weekly goal is an unknown field', () => {
    expect(setting({ field: 'weekly_goal', number: 4 })).toBeUndefined();
  });

  it('"settings" is read as the target too, and an unknown field is dropped', () => {
    expect(one({ target: 'Settings', field: 'auto_rest', on: true })?.value).toBe(true);
    expect(setting({ field: 'theme', text: 'dark' })).toBeUndefined();
  });
});

describe('only the training is changed', () => {
  it('drops the targets the combined 2.x assistant had — a task, a budget, an amount', () => {
    const mixed = [
      { target: 'exercise', id: 'ex_bench', field: 'rest', number: 60 },
      { target: 'setting', field: 'auto_rest', on: true },
      { target: 'task', id: 't_read', field: 'archive' },
      { target: 'budget', id: 'c_food', field: 'monthly', number: 300 },
      { target: 'amount', id: 'c_food', field: 'add', number: 12 },
    ];
    expect(workout(mixed).map((c) => c.target)).toEqual(['exercise', 'setting']);
  });
});

describe('the same thing twice in one card', () => {
  it('keeps the later one, in the later place', () => {
    const out = workout([
      { target: 'exercise', id: 'ex_bench', field: 'rest', number: 90 },
      { target: 'setting', field: 'auto_rest', on: true },
      { target: 'exercise', id: 'ex_bench', field: 'rest_seconds', number: 60 },
    ]);
    expect(out).toEqual([
      { target: 'setting', field: 'auto_rest', value: true },
      { target: 'exercise', id: 'ex_bench', field: 'rest_seconds', value: 60 },
    ]);
  });

  it('keeps different fields of one exercise, and one field of two', () => {
    const out = workout([
      { target: 'exercise', id: 'ex_bench', field: 'rest', number: 90 },
      { target: 'exercise', id: 'ex_bench', field: 'sets', number: 4 },
      { target: 'exercise', id: 'ex_pull', field: 'rest', number: 90 },
    ]);
    expect(out).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ */

const NOW: CurrentValues = {
  exercises: EXERCISES,
  settings: { restSecondsBetweenSets: 90, restSecondsBetweenExercises: 120, autoStartRest: true },
};
const rows = (changes: AiChange[]) => describeChanges(changes, NOW, 'en');
const ex = (id: string, field: string, value: unknown): AiChange =>
  ({ target: 'exercise', id, field, value }) as AiChange;

describe('what the card says', () => {
  it('rest: own → own, own → the setting, the setting → own', () => {
    expect(rows([ex('ex_bench', 'rest_seconds', 90)])).toEqual([
      { subject: 'Bench press', label: 'Rest between sets', from: '2:00', to: '1:30' },
    ]);
    expect(rows([ex('ex_bench', 'rest_seconds', null)])[0]).toMatchObject({
      from: '2:00',
      to: '1:30 (setting)',
    });
    expect(rows([ex('ex_pull', 'rest_seconds', 45)])[0]).toMatchObject({
      from: '1:30 (setting)',
      to: '0:45',
    });
  });

  it('every exercise field, from and to', () => {
    const out = rows([
      ex('ex_bench', 'sets', 4),
      ex('ex_bench', 'rep_target', 10),
      ex('ex_dips', 'max_reps', false),
      ex('ex_bench', 'ladder', 12),
      ex('ex_pull', 'ladder', null),
      ex('ex_bench', 'increment_kg', 1.25),
      ex('ex_bench', 'cue', ''),
      ex('ex_pull', 'cue', 'Dead hang'),
      ex('ex_plank', 'prepare_seconds', 10),
    ]);
    expect(out.map(({ label, from, to }) => [label, from, to])).toEqual([
      ['Sets', '3', '4'],
      ['Rep target', '8', '10'],
      ['Reps to MAX', 'On', 'Off'],
      ['Rep ladder max', 'Off', '12'],
      ['Rep ladder max', '10', 'Off'],
      ['Weight step', '2.5 kg', '1.25 kg'],
      ['Form cue', 'Tuck elbows', 'None'],
      ['Form cue', '', 'Dead hang'],
      ['Get-ready countdown', '5 s', '10 s'],
    ]);
  });

  it('settings', () => {
    const out = rows([
      { target: 'setting', field: 'rest_between_sets', value: 60 },
      { target: 'setting', field: 'rest_between_exercises', value: 180 },
      { target: 'setting', field: 'auto_rest', value: false },
    ]);
    expect(out.map(({ subject, label, from, to }) => [subject, label, from, to])).toEqual([
      ['Settings', 'Rest between sets', '1:30', '1:00'],
      ['Settings', 'Rest between exercises', '2:00', '3:00'],
      ['Settings', 'Start rest automatically', 'On', 'Off'],
    ]);
  });

  it('draws no row for something that is not there', () => {
    expect(rows([ex('ex_nope', 'sets', 4)])).toEqual([]);
  });

  it('is translated', () => {
    const [row] = describeChanges([ex('ex_bench', 'sets', 4)], NOW, 'ru');
    expect(row.label).not.toBe('Sets');
    expect(row.subject).toBe('Bench press');
  });
});

/* ------------------------------------------------------------------ */

describe('applying an exercise change', () => {
  const apply = (e: Exercise, field: string, value: unknown) =>
    applyExerciseChange(e, ex(e.id, field, value) as Extract<AiChange, { target: 'exercise' }>);

  it('is pure', () => {
    const before = JSON.stringify(BENCH);
    apply(BENCH, 'rest_seconds', null);
    apply(BENCH, 'cue', '');
    expect(JSON.stringify(BENCH)).toBe(before);
  });

  it('rest: a number is its own; null deletes it, never zeroes it', () => {
    expect(apply(BENCH, 'rest_seconds', 60).defaultRestSeconds).toBe(60);
    expect(apply(BENCH, 'rest_seconds', 0).defaultRestSeconds).toBe(0);
    const follows = apply(BENCH, 'rest_seconds', null);
    expect('defaultRestSeconds' in follows).toBe(false);
  });

  it('MAX on takes the ladder off; MAX off leaves no flag behind', () => {
    const maxed = apply(PULL, 'max_reps', true);
    expect(maxed.countToMax).toBe(true);
    expect('ladder' in maxed).toBe(false);
    const off = apply(DIPS, 'max_reps', false);
    expect('countToMax' in off).toBe(false);
  });

  it('a ladder takes MAX off, and its max is the rep number', () => {
    const laddered = apply(DIPS, 'ladder', 12);
    expect(laddered.ladder).toEqual({ max: 12, earned: 0 });
    expect(laddered.defaultCount).toBe(12);
    expect('countToMax' in laddered).toBe(false);
  });

  it('a new max starts the climb again; the same max keeps what it earned', () => {
    expect(apply(PULL, 'ladder', 14).ladder).toEqual({ max: 14, earned: 0 });
    expect(apply(PULL, 'ladder', 10).ladder).toEqual({ max: 10, earned: 4 });
    expect(apply(PULL, 'ladder', 10).defaultCount).toBe(10);
  });

  it('ladder off deletes it', () => {
    const off = apply(PULL, 'ladder', null);
    expect('ladder' in off).toBe(false);
    expect(off.defaultCount).toBe(10);
  });

  it('the plain fields', () => {
    expect(apply(BENCH, 'sets', 5).defaultSets).toBe(5);
    expect(apply(BENCH, 'rep_target', 12).defaultCount).toBe(12);
    expect(apply(BENCH, 'increment_kg', 1.25).incrementKg).toBe(1.25);
    expect(apply(BENCH, 'cue', 'Pause on chest').cue).toBe('Pause on chest');
    expect('cue' in apply(BENCH, 'cue', '')).toBe(false);
    expect(apply(PLANK, 'prepare_seconds', 0).prepareSeconds).toBe(0);
  });

  it('touches nothing but the field', () => {
    const next = apply(BENCH, 'sets', 5);
    expect({ ...next, defaultSets: 3 }).toEqual(BENCH);
  });
});
