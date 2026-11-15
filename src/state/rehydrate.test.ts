import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * REHYDRATION, run for real against the storage stub. zustand's `persist` calls
 * `merge` on a FIRST launch too, with `undefined`, and a version bump without a
 * `migrate` does not reach `merge` with the old blob at all — so what a launch
 * comes up with is tested here, against blobs as older builds wrote them.
 */

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('settings written by 2.2.0', () => {
  it('cold-start with every assistant card showing, and nothing else lost', async () => {
    const { useSettings, DEFAULT_SETTINGS } = await import('./settingsStore');
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({ version: 1, state: { restSecondsBetweenSets: 95, language: 'en' } }),
    );

    await useSettings.persist.rehydrate();

    expect(useSettings.getState().restSecondsBetweenSets).toBe(95);
    expect(useSettings.getState().language).toBe('en');
    expect(useSettings.getState().aiCardsDismissed).toBeUndefined();
    expect(useSettings.getState().weeklyReviewDismissed).toBeUndefined();
  });

  it('read a closed card back after a restart', async () => {
    const { useSettings, DEFAULT_SETTINGS } = await import('./settingsStore');
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({ version: 1, state: { aiCardsDismissed: ['Workout'] } }),
    );

    await useSettings.persist.rehydrate();

    expect(useSettings.getState().aiCardsDismissed).toEqual(['Workout']);
  });

  it('read a closed weekly review back after a restart', async () => {
    const { useSettings, DEFAULT_SETTINGS } = await import('./settingsStore');
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({ version: 1, state: { weeklyReviewDismissed: '2026-10-05' } }),
    );

    await useSettings.persist.rehydrate();

    expect(useSettings.getState().weeklyReviewDismissed).toBe('2026-10-05');
  });
  it('cold-start from a blob with measurements and a weekly goal: read past, rest kept', async () => {
    const { useSettings, DEFAULT_SETTINGS } = await import('./settingsStore');
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({
        version: 1,
        state: {
          bodyweightKg: 81,
          restSecondsBetweenSets: 95,
          bodyMeasurements: { waist: [{ day: '2026-10-05', cm: 82.5 }] },
          weeklyWorkoutGoal: 5,
          excusedWeeks: ['2026-12-28'],
        },
      }),
    );
    await useSettings.persist.rehydrate();
    const state = useSettings.getState() as unknown as Record<string, unknown>;
    expect(state.bodyweightKg).toBe(81);
    expect(state.restSecondsBetweenSets).toBe(95);
    expect(state.bodyMeasurements).toBeUndefined();
    expect(state.weeklyWorkoutGoal).toBeUndefined();
    expect(state.excusedWeeks).toBeUndefined();
  });
});

describe('a stored blob with keys of removed features', () => {
  it('rehydrates, and the old keys are dropped', async () => {
    const { useSettings, DEFAULT_SETTINGS } = await import('./settingsStore');
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({
        version: 1,
        state: { restSecondsBetweenSets: 95, engagement: true, milestoneShown: 100 },
      }),
    );
    await useSettings.persist.rehydrate();
    const state = useSettings.getState() as unknown as Record<string, unknown>;
    expect(state.restSecondsBetweenSets).toBe(95);
    expect(state.engagement).toBeUndefined();
    expect(state.milestoneShown).toBeUndefined();
  });
});
