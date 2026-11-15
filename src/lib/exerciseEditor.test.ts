import { describe, expect, it } from 'vitest';

import { advancedLabels, advancedRows, WEIGHT_CHOICES } from './exerciseEditor';
import { emptyExerciseDraft, type ExerciseDraft } from './exerciseDraft';
import { translatedKeys } from './i18n';

function draft(patch: Partial<ExerciseDraft>): ExerciseDraft {
  return { ...emptyExerciseDraft('Row'), ...patch };
}

describe('advancedRows', () => {
  it('a weighted rep exercise folds the ladder, MAX and the increment', () => {
    expect(
      advancedRows(draft({ requiresWeight: true, countUnit: 'reps', ladderOn: false })),
    ).toEqual(['ladder', 'max', 'increment']);
  });

  it('unweighted work has no increment', () => {
    expect(advancedRows(draft({ requiresWeight: false, countUnit: 'reps' }))).toEqual([
      'ladder',
      'max',
    ]);
  });

  it('time and distance never offer a ladder or MAX', () => {
    for (const countUnit of ['seconds', 'meters', 'rounds'] as const) {
      const rows = advancedRows(draft({ requiresWeight: false, countUnit }));
      expect(rows).not.toContain('ladder');
      expect(rows).not.toContain('max');
    }
  });

  it('is empty for unweighted time and distance, so the screen shows no Advanced row', () => {
    for (const countUnit of ['seconds', 'meters', 'rounds'] as const) {
      expect(advancedRows(draft({ requiresWeight: false, countUnit }))).toEqual([]);
    }
  });

  it('names the rows in render order', () => {
    expect(
      advancedLabels(draft({ requiresWeight: true, countUnit: 'reps', ladderOn: true })),
    ).toEqual(['Rep ladder', 'Reps to MAX', 'Increment']);
  });
});

describe('WEIGHT_CHOICES', () => {
  it('offers each weighted load mode once, in the brief’s order', () => {
    expect(WEIGHT_CHOICES.map((c) => c.value)).toEqual([
      'external',
      'added_bodyweight',
      'assisted',
    ]);
  });

  it('every label and example is in Russian', () => {
    for (const choice of WEIGHT_CHOICES) {
      expect(translatedKeys()).toContain(choice.label);
      expect(translatedKeys()).toContain(choice.example);
    }
  });
});
