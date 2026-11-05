import { beforeEach, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';

import type { DraftSet } from '../lib/draft';
import { useSettings } from '../state/settingsStore';
import type { Exercise } from '../types/models';
import { SetRow } from './SetRow';

/**
 * What a screen reader says for a set row. A pure test cannot reach it: the
 * label is assembled in the component, and it once read the raw count — so a
 * 1:30 plank, stored as 90 seconds and drawn as `1:30 MIN`, was announced as
 * "90 min".
 */

const plank: Exercise = {
  id: 'ex_plank',
  ownerId: null,
  name: 'Plank',
  muscleGroups: ['core'],
  requiresWeight: false,
  countUnit: 'seconds',
  loadMode: 'none',
  isUnilateral: false,
  isArchived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const hold: DraftSet = {
  localId: 's1',
  weightKg: null,
  count: 90,
  isWarmup: false,
  isCompleted: false,
  completedAt: null,
  isPrefilled: false,
};

beforeEach(() => {
  useSettings.setState({ language: 'en' });
});

it('a timed set is announced as the clock it shows, not as raw seconds', () => {
  const view = render(
    <SetRow
      set={hold}
      workingNumber={1}
      position={1}
      exercise={plank}
      unitSystem="metric"
      focusedField={null}
      onFocusField={jest.fn()}
      onToggleComplete={jest.fn()}
    />,
  );
  expect(view.getByLabelText('1:30 min')).toBeTruthy();
  expect(view.queryByLabelText('90 min')).toBeNull();
});
