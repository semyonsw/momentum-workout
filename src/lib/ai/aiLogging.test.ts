import { describe, expect, it } from 'vitest';

import {
  describeChanges,
  validateChanges,
  type AiChange,
  type ChangeContext,
  type CurrentValues,
} from './aiChanges';
import type { Exercise } from '../../types/models';

/**
 * The things the chat can LOG rather than tune — a weigh-in, a past set's
 * kind. Same contract as every suggestion: the model's items are untrusted, an
 * id the context never named is dropped, and the card is drawn from what
 * survived.
 */

const BENCH = {
  id: 'ex_bench',
  name: 'Bench press',
  ownerId: 'u1',
  muscleGroups: ['chest'],
  requiresWeight: true,
  countUnit: 'reps',
  loadMode: 'external',
  isUnilateral: false,
  isArchived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
} as Exercise;

const WORKOUT = {
  id: 'w_mon',
  startedAt: '2026-10-27T17:00:00.000Z',
  sets: [
    { id: 's_w', exerciseId: 'ex_bench', setIndex: 0, isWarmup: true },
    { id: 's_1', exerciseId: 'ex_bench', setIndex: 1, isWarmup: false },
    { id: 's_2', exerciseId: 'ex_bench', setIndex: 2, isWarmup: false },
    { id: 's_r', exerciseId: 'ex_row', setIndex: 3, isWarmup: false },
  ],
};

const ctx: ChangeContext = { exercises: [BENCH], workouts: [WORKOUT] };

describe('logging bodyweight', () => {
  it('rounds to 0.1 kg and holds to sensible bounds', () => {
    expect(validateChanges([{ target: 'bodyweight', field: 'log', number: 81.26 }], ctx)).toEqual([
      { target: 'bodyweight', field: 'log', value: 81.3 },
    ]);
    expect(validateChanges([{ target: 'bodyweight', field: 'log', number: 4 }], ctx)).toEqual([]);
  });
});

describe("correcting a saved set's kind", () => {
  it('finds set 1 by its place among the WORKING sets, skipping the warm-up', () => {
    const [change] = validateChanges(
      [
        {
          target: 'workout_set',
          id: 'w_mon',
          exerciseId: 'ex_bench',
          field: 'kind',
          number: 1,
          text: 'warm-up',
        },
      ],
      ctx,
    );
    expect(change).toMatchObject({
      target: 'workout_set',
      setId: 's_1',
      value: 'warmup',
      day: '2026-10-27',
      position: 1,
    });
  });

  it('drops a set that is not there, an unknown workout, and an unknown kind', () => {
    const base = { target: 'workout_set', exerciseId: 'ex_bench', field: 'kind', text: 'warmup' };
    expect(
      validateChanges(
        [
          { ...base, id: 'w_mon', number: 3 },
          { ...base, id: 'w_mon', number: 0 },
          { ...base, id: 'w_tue', number: 1 },
          { ...base, id: 'w_mon', number: 1, text: 'superset' },
          { ...base, id: 'w_mon', number: 1, text: 'drop' },
          { ...base, id: 'w_mon', exerciseId: 'ex_squat', number: 1 },
        ],
        ctx,
      ),
    ).toEqual([]);
  });

  it('drops a change to the kind the set already is', () => {
    expect(
      validateChanges(
        [
          {
            target: 'workout_set',
            id: 'w_mon',
            exerciseId: 'ex_bench',
            field: 'kind',
            number: 2,
            text: 'working',
          },
        ],
        ctx,
      ),
    ).toEqual([]);
  });
});

describe('the card rows for logged things', () => {
  const now: CurrentValues = {
    exercises: [BENCH],
    settings: { restSecondsBetweenSets: 90, restSecondsBetweenExercises: 120, autoStartRest: true },
    bodyweightKg: 82,
    formatDay: (day) => (day === '2026-10-27' ? '27 Oct' : day),
  };

  it('says what will be written, in plain words', () => {
    const changes: AiChange[] = [
      { target: 'bodyweight', field: 'log', value: 81.5 },
      {
        target: 'workout_set',
        field: 'kind',
        id: 'w_mon',
        exerciseId: 'ex_bench',
        setId: 's_1',
        from: 'working',
        value: 'warmup',
        day: '2026-10-27',
        position: 1,
      },
    ];
    expect(describeChanges(changes, now, 'en')).toEqual([
      { subject: 'Body weight', label: 'Today', from: '82 kg', to: '81.5 kg' },
      { subject: 'Bench press · 27 Oct', label: 'Set 1', from: 'Working set', to: 'Warm-up' },
    ]);
  });
});
