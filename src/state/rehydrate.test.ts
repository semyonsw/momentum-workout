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
  it('cold-start with no body measurements, and read them back when there are some', async () => {
    const { useSettings, DEFAULT_SETTINGS } = await import('./settingsStore');
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({ version: 1, state: { bodyweightKg: 81, restSecondsBetweenSets: 95 } }),
    );
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().bodyMeasurements).toBeUndefined();
    expect(useSettings.getState().bodyweightKg).toBe(81);
    expect(useSettings.getState().restSecondsBetweenSets).toBe(95);

    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({
        version: 1,
        state: { bodyMeasurements: { waist: [{ day: '2026-10-05', cm: 82.5 }] } },
      }),
    );
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().bodyMeasurements).toEqual({
      waist: [{ day: '2026-10-05', cm: 82.5 }],
    });
  });
  it('cold-start with no weekly goal, and read one back when there is one (W8)', async () => {
    const { useSettings, DEFAULT_SETTINGS } = await import('./settingsStore');
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({ version: 1, state: { restSecondsBetweenSets: 95 } }),
    );
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().weeklyWorkoutGoal).toBeUndefined();
    expect(useSettings.getState().excusedWeeks).toBeUndefined();
    expect(useSettings.getState().restSecondsBetweenSets).toBe(95);

    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({
        version: 1,
        state: { weeklyWorkoutGoal: 5, excusedWeeks: ['2026-12-28'] },
      }),
    );
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().weeklyWorkoutGoal).toBe(5);
    expect(useSettings.getState().excusedWeeks).toEqual(['2026-12-28']);
  });
});

describe('the engagement switch on a cold start (Wave 3)', () => {
  it('a 2.2.0 blob comes up off; a stored true comes up on', async () => {
    const { useSettings, DEFAULT_SETTINGS } = await import('./settingsStore');
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({ version: 1, state: { restSecondsBetweenSets: 95 } }),
    );
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().engagement).toBeUndefined();
    expect(useSettings.getState().restSecondsBetweenSets).toBe(95);

    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({ version: 1, state: { engagement: true } }),
    );
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().engagement).toBe(true);
  });

  it('the milestone stamp: absent on a 2.2.0 blob, read back when there is one', async () => {
    const { useSettings, DEFAULT_SETTINGS } = await import('./settingsStore');
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    await AsyncStorage.setItem('settings', JSON.stringify({ version: 1, state: {} }));
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().milestoneShown).toBeUndefined();
    await AsyncStorage.setItem(
      'settings',
      JSON.stringify({ version: 1, state: { milestoneShown: 100 } }),
    );
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().milestoneShown).toBe(100);
  });
});
