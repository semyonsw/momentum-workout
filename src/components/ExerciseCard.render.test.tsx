import { beforeEach, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';

import type { DraftEntry, DraftSet } from '../lib/draft';
import { useSettings } from '../state/settingsStore';
import type { Exercise } from '../types/models';
import { ExerciseCard } from './ExerciseCard';

/**
 * The first row's warm-up toggle and the max test's label, as drawn. Which way
 * the toggle goes is `lib/warmup.ts`'s decision and is tested there; what only a
 * renderer shows is that the open card actually draws the chip, that it flips
 * with the rows, and that pressing it calls through.
 */

const bench: Exercise = {
  id: 'ex_bench',
  ownerId: null,
  name: 'Bench press',
  muscleGroups: ['chest'],
  requiresWeight: true,
  countUnit: 'reps',
  loadMode: 'external',
  isUnilateral: false,
  isArchived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const row = (localId: string, extra: Partial<DraftSet> = {}): DraftSet => ({
  localId,
  weightKg: 80,
  count: 8,
  isWarmup: false,
  isCompleted: false,
  completedAt: null,
  isPrefilled: true,
  ...extra,
});

const entry = (sets: DraftSet[], over: Partial<DraftEntry> = {}): DraftEntry => ({
  localId: 'e1',
  exercise: bench,
  targetSets: sets.length,
  restSeconds: 120,
  transitionRestSeconds: 150,
  sets,
  lastSessionSummary: null,
  lastSessionShort: null,
  ...over,
});

const handlers = () => ({
  onToggleExpanded: jest.fn(),
  onToggleSet: jest.fn(),
  onPatchSet: jest.fn(),
  onAddSet: jest.fn(),
  onRemoveSet: jest.fn(),
  onPressTimer: jest.fn(),
});

beforeEach(() => {
  useSettings.setState({ language: 'en' });
});

it('draws `+ Warm-up` on an open card and calls the toggle when pressed', () => {
  const onToggleWarmup = jest.fn();
  const view = render(
    <ExerciseCard
      {...handlers()}
      entry={entry([row('a'), row('b')])}
      isExpanded
      unitSystem="metric"
      onToggleWarmup={onToggleWarmup}
    />,
  );
  const chip = view.getByLabelText('Add a warm-up set on top');
  fireEvent.press(chip);
  expect(onToggleWarmup).toHaveBeenCalledTimes(1);
});

it('the same chip removes an unlogged warm-up, and is gone once it is logged', () => {
  const props = { ...handlers(), isExpanded: true, unitSystem: 'metric' as const };
  const view = render(
    <ExerciseCard
      {...props}
      entry={entry([row('w', { isWarmup: true, weightKg: 40 }), row('a')])}
      onToggleWarmup={jest.fn()}
    />,
  );
  expect(view.getByLabelText('Remove the warm-up set')).toBeTruthy();

  view.rerender(
    <ExerciseCard
      {...props}
      entry={entry([row('w', { isWarmup: true, isCompleted: true }), row('a')])}
      onToggleWarmup={jest.fn()}
    />,
  );
  expect(view.queryByLabelText('Remove the warm-up set')).toBeNull();
  expect(view.queryByLabelText('Add a warm-up set on top')).toBeNull();
});

it('labels a ladder’s max test on its row until it is logged', () => {
  const pull: Exercise = { ...bench, requiresWeight: false, loadMode: 'none' };
  const view = render(
    <ExerciseCard
      {...handlers()}
      entry={entry([row('t', { count: 0, weightKg: null }), row('b', { weightKg: null })], {
        exercise: { ...pull, ladder: { max: 12, earned: 0, awaitingMax: true } },
        ladder: { max: 12, earned: 0, awaitingMax: true },
      })}
      isExpanded
      unitSystem="metric"
    />,
  );
  expect(view.getByText('Max reps — go all out')).toBeTruthy();
  expect(view.getByLabelText('MAX')).toBeTruthy();
});
