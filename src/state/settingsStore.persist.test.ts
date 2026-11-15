import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SETTINGS,
  onSettingsHydrationFailed,
  sanitizeSettings,
  settingsHydrationFailed,
  useSettings,
} from './settingsStore';

/**
 * The settings through a relaunch, run for real against the storage stub.
 *
 * `settingsStore.test.ts` pins `sanitizeSettings` key by key, and `rehydrate.test.ts`
 * reads back the 2.2.0 additions one at a time. What neither does is put a
 * whole changed configuration down and pick it up again, or hand `rehydrate` the
 * blobs a real phone can have on it: one carrying keys from an older build, one
 * that was cut off half-way through a write, one that is not JSON at all. Each of
 * those is a launch, and a launch that comes up on the wrong rest length — or on
 * a blank screen — is the bug this store's rule 2 exists to prevent.
 *
 * One test below makes the read fail on purpose, and the flag that records it is
 * module state with no reset. It is the LAST test in the file for that reason;
 * vitest gives every file its own module graph, so nothing else ever sees it.
 */

afterEach(async () => {
  vi.restoreAllMocks();
  useSettings.getState().importSettings(DEFAULT_SETTINGS);
  await AsyncStorage.removeItem('settings');
});

async function relaunch() {
  const blob = await AsyncStorage.getItem('settings');
  if (!blob) throw new Error('nothing was written');
  useSettings.getState().importSettings(DEFAULT_SETTINGS);
  await AsyncStorage.setItem('settings', blob);
  await useSettings.persist.rehydrate();
}

const stored = (state: unknown) =>
  AsyncStorage.setItem('settings', JSON.stringify({ version: 1, state }));

describe('a configured phone, relaunched', () => {
  it('reads back every setting it wrote', async () => {
    const s = useSettings.getState();
    s.setNumber('restSecondsBetweenSets', 95);
    s.bumpNumber('prepareSeconds', 3);
    s.setFlag('soundEnabled', false);
    s.setUnitSystem('imperial');
    s.setLanguage('ru');
    s.setBodyweightKg(81.4);
    s.setWeeklyTarget('push', 14);

    const before = sanitizeSettings(useSettings.getState());
    await relaunch();
    expect(sanitizeSettings(useSettings.getState())).toEqual(before);
    // A few spelled out, so a failure says which one went missing.
    expect(useSettings.getState()).toMatchObject({
      restSecondsBetweenSets: 95,
      prepareSeconds: 8,
      soundEnabled: false,
      unitSystem: 'imperial',
      language: 'ru',
      bodyweightKg: 81.4,
      weeklySetTargets: { push: 14 },
    });
  });

  it('keeps the actions working after a relaunch — they are never read from disk', async () => {
    useSettings.getState().setNumber('beepSeconds', 3);
    await relaunch();
    useSettings.getState().bumpNumber('beepSeconds', 1);
    expect(useSettings.getState().beepSeconds).toBe(4);
  });

  it('an unset bodyweight comes back unset, not as zero', async () => {
    useSettings.getState().setBodyweightKg(80);
    useSettings.getState().setBodyweightKg(undefined);
    await relaunch();
    expect(useSettings.getState().bodyweightKg).toBeUndefined();
    // …and the weigh-in it had is still in the log.
    expect(useSettings.getState().bodyweightLog.map((entry) => entry.kg)).toEqual([80]);
  });
});

describe('older and damaged blobs', () => {
  it('a blob with the plate lists and gyms of an older build loses nothing else', async () => {
    await stored({
      restSecondsBetweenSets: 60,
      availablePlatesKg: [20, 10, 5],
      gyms: [{ id: 'g1', name: 'Home', platesKg: [10] }],
      activeGymId: 'deleted',
    });
    await useSettings.persist.rehydrate();
    const state = sanitizeSettings(useSettings.getState());
    expect(state.restSecondsBetweenSets).toBe(60);
    expect(state).not.toHaveProperty('gyms');
  });

  it('a blob from before the bodyweight log seeds the log from the scalar', async () => {
    await stored({ bodyweightKg: 77 });
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().bodyweightKg).toBe(77);
    expect(useSettings.getState().bodyweightLog.map((entry) => entry.kg)).toEqual([77]);
  });

  it('a half-written blob fills every missing key from the defaults', async () => {
    await stored({ soundEnabled: false });
    await useSettings.persist.rehydrate();
    const state = sanitizeSettings(useSettings.getState());
    expect(state).toEqual({ ...sanitizeSettings(DEFAULT_SETTINGS), soundEnabled: false });
  });

  it('junk in every numeric key comes up on the defaults, never NaN', async () => {
    await stored({
      restSecondsBetweenSets: 'abc',
      restSecondsBetweenExercises: null,
      prepareSeconds: {},
      beepSeconds: [],
      adjustStepSeconds: true,
    });
    await useSettings.persist.rehydrate();
    const s = useSettings.getState();
    expect([
      s.restSecondsBetweenSets,
      s.restSecondsBetweenExercises,
      s.prepareSeconds,
      s.beepSeconds,
      s.adjustStepSeconds,
    ]).toEqual([
      DEFAULT_SETTINGS.restSecondsBetweenSets,
      DEFAULT_SETTINGS.restSecondsBetweenExercises,
      DEFAULT_SETTINGS.prepareSeconds,
      DEFAULT_SETTINGS.beepSeconds,
      DEFAULT_SETTINGS.adjustStepSeconds,
    ]);
  });

  it('a state that is not an object comes up on the defaults', async () => {
    await stored('nonsense');
    await useSettings.persist.rehydrate();
    expect(sanitizeSettings(useSettings.getState())).toEqual(sanitizeSettings(DEFAULT_SETTINGS));
  });
});

describe('a read that fails', () => {
  it('is reported, the defaults stand, and the listener hears it once', async () => {
    const heard = vi.fn();
    const off = onSettingsHydrationFailed(heard);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    expect(settingsHydrationFailed()).toBe(false);

    await AsyncStorage.setItem('settings', '{"version":1,"state":{"restSec');
    await useSettings.persist.rehydrate();

    expect(settingsHydrationFailed()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(useSettings.getState().restSecondsBetweenSets).toBe(
      DEFAULT_SETTINGS.restSecondsBetweenSets,
    );
    off();
  });
});
