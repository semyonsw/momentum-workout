import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAi, type AiMessage } from './aiStore';
import { BACKED_UP_FIELDS } from '../lib/backupWatch';
import { storesHydrated, watchBackedUpStores } from './backupWatch';
import { useLibrary } from './libraryStore';
import { DEFAULT_SETTINGS, useSettings } from './settingsStore';
import { useWorkoutHistory } from './workoutHistoryStore';

/**
 * Which REAL store changes ask for a backup write.
 *
 * The rule is in `lib/backupWatch.ts`; these pin it to the stores as they are,
 * because the failures are about them: the AI store flipping `pending` around
 * every question must not write, the backup recording itself in settings must not
 * write (or every write asks for the next one), and a rest-time change, a new
 * routine or a chat message must.
 */

const user = (id: string): AiMessage => ({ id, role: 'user', text: id, at: '2026-10-15' });

beforeAll(async () => {
  await Promise.all([useSettings, useLibrary, useAi].map((store) => store.persist.rehydrate()));
});

let onChange: ReturnType<typeof vi.fn>;
let stop: () => void;

beforeEach(() => {
  useSettings.getState().importSettings(DEFAULT_SETTINGS);
  onChange = vi.fn();
  stop = watchBackedUpStores(onChange);
});

afterEach(() => stop());

describe('what asks for a write', () => {
  it('has every store hydrated in this suite, so a silence below means "not a change"', () => {
    expect(storesHydrated()).toBe(true);
  });

  it('a setting', () => {
    useSettings.getState().setNumber('restSecondsBetweenSets', 75);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('the bodyweight', () => {
    useSettings.getState().setBodyweightKg(81.5);
    expect(onChange).toHaveBeenCalled();
  });

  it('a routine', () => {
    useLibrary.getState().createRoutine('Neck day');
    expect(onChange).toHaveBeenCalled();
  });

  it('an AI chat message', () => {
    useAi.getState().appendMessage('Workout', user('q'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a change to the history log', () => {
    useWorkoutHistory.setState({ workouts: [...useWorkoutHistory.getState().workouts] });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('what does not', () => {
  it('a question going in flight and landing', () => {
    useAi.getState().setPending('Workout', true);
    useAi.getState().setRetrying('Workout', true);
    useAi.getState().setPending('Workout', false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the backup recording itself — which would otherwise be a loop', () => {
    useSettings
      .getState()
      .recordBackup('2026-10-15T10:00:00.000Z', { uri: 'content://f', day: '2026-10-15' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the backup switch and its folder', () => {
    useSettings.getState().setAutoBackupEnabled(false);
    useSettings.getState().setAutoBackupFolder('content://tree/elsewhere');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a set that changes nothing', () => {
    useLibrary.setState({});
    expect(onChange).not.toHaveBeenCalled();
  });

  it('anything, once unsubscribed', () => {
    stop();
    useSettings.getState().setNumber('restSecondsBetweenSets', 60);
    expect(onChange).not.toHaveBeenCalled();
  });
});

/*
 * The watch lists are hand-written, so they can fall behind the stores: an edit
 * to a field missing from one would wait for some unrelated change to be saved.
 * Every field a store persists is a field the backup carries, so the persisted
 * keys are the list the watcher must cover.
 */
describe('the watch lists cover every persisted field', () => {
  const persisted = (
    store: { persist: { getOptions: () => { partialize?: unknown } } },
    state: object,
  ) => {
    const partialize = store.persist.getOptions().partialize as (state: object) => object;
    return Object.keys(partialize(state));
  };

  it('library', () => {
    for (const key of persisted(useLibrary, useLibrary.getState())) {
      expect(BACKED_UP_FIELDS.library).toContain(key);
    }
  });
});
