import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, describe, expect, it } from 'vitest';

import { BODYWEIGHT_LIMITS, clampBodyweightKg } from '../lib/bodyweightLog';
import {
  DEFAULT_SETTINGS,
  SETTING_LIMITS,
  clampSetting,
  currentSettings,
  sanitizeSettings,
  useSettings,
  type Settings,
} from './settingsStore';

afterEach(() => {
  /*
   * `importSettings`, not `resetToDefaults`. The reset button deliberately KEEPS the
   * bodyweight log and the granted backup folder — it is about durations
   * and toggles, not about destroying data — so it is the wrong tool for isolating
   * tests from each other. This replaces every key.
   */
  useSettings.getState().importSettings(DEFAULT_SETTINGS);
});

/*
 * These are all guarding one thing: a duration that reaches a timer must be a
 * usable whole number of seconds. `endsAt = Date.now() + NaN * 1000` is a
 * countdown that never ends and a pill that never leaves, and it can arrive from a
 * half-written persisted blob just as easily as from a text field.
 */

describe('clampSetting', () => {
  it('holds each setting inside its own range', () => {
    for (const key of Object.keys(SETTING_LIMITS) as (keyof typeof SETTING_LIMITS)[]) {
      const { min, max } = SETTING_LIMITS[key];
      expect(clampSetting(key, -9999)).toBe(min);
      expect(clampSetting(key, 9999)).toBe(max);
    }
  });

  it('rounds to whole seconds', () => {
    expect(clampSetting('prepareSeconds', 5.6)).toBe(6);
    expect(clampSetting('beepSeconds', 4.2)).toBe(4);
  });

  it('falls back to the default for anything unusable', () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'abc', {}, []]) {
      expect(clampSetting('restSecondsBetweenSets', bad)).toBe(
        DEFAULT_SETTINGS.restSecondsBetweenSets,
      );
    }
  });
});

describe('sanitizeSettings', () => {
  it('returns a complete object from nothing at all', () => {
    for (const input of [undefined, null, {}]) {
      expect(sanitizeSettings(input)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('fills keys a persisted blob from an older build would not have', () => {
    const old = { restSecondsBetweenSets: 90 } as never;
    const result = sanitizeSettings(old);

    expect(result.restSecondsBetweenSets).toBe(90);
    expect(result.beepSeconds).toBe(DEFAULT_SETTINGS.beepSeconds);
    expect(result.adjustStepSeconds).toBe(DEFAULT_SETTINGS.adjustStepSeconds);
    expect(Object.keys(result).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('repairs a corrupt blob rather than passing it through', () => {
    const result = sanitizeSettings({
      restSecondsBetweenSets: NaN,
      prepareSeconds: -40,
      beepSeconds: 9999,
      unitSystem: 'furlongs',
    } as never);

    expect(result.restSecondsBetweenSets).toBe(DEFAULT_SETTINGS.restSecondsBetweenSets);
    expect(result.prepareSeconds).toBe(SETTING_LIMITS.prepareSeconds.min);
    expect(result.beepSeconds).toBe(SETTING_LIMITS.beepSeconds.max);
    expect(result.unitSystem).toBe('metric');
  });

  it('keeps booleans, treating only an explicit false as off', () => {
    expect(sanitizeSettings({ soundEnabled: false } as never).soundEnabled).toBe(false);
    expect(sanitizeSettings({ soundEnabled: undefined } as never).soundEnabled).toBe(true);
  });
});

describe('the store', () => {
  it("bumps by the setting's own step and stops at the ceiling", () => {
    const { bumpNumber } = useSettings.getState();
    const step = SETTING_LIMITS.restSecondsBetweenSets.step;
    const start = useSettings.getState().restSecondsBetweenSets;

    bumpNumber('restSecondsBetweenSets', step);
    expect(useSettings.getState().restSecondsBetweenSets).toBe(start + step);

    for (let i = 0; i < 200; i += 1) bumpNumber('restSecondsBetweenSets', step);
    expect(useSettings.getState().restSecondsBetweenSets).toBe(
      SETTING_LIMITS.restSecondsBetweenSets.max,
    );
  });

  it('cannot be nudged below its floor', () => {
    const { bumpNumber } = useSettings.getState();
    for (let i = 0; i < 200; i += 1) bumpNumber('beepSeconds', -1);
    expect(useSettings.getState().beepSeconds).toBe(SETTING_LIMITS.beepSeconds.min);
  });

  it('rejects a bad direct set', () => {
    useSettings.getState().setNumber('prepareSeconds', NaN);
    expect(useSettings.getState().prepareSeconds).toBe(DEFAULT_SETTINGS.prepareSeconds);
  });

  it('currentSettings reads the live values outside React', () => {
    useSettings.getState().setNumber('restSecondsBetweenSets', 45);
    expect(currentSettings().restSecondsBetweenSets).toBe(45);
  });

  it('resets everything, not just the numbers', () => {
    const s = useSettings.getState();
    s.setNumber('beepSeconds', 1);
    s.setFlag('soundEnabled', false);
    s.setUnitSystem('imperial');

    s.resetToDefaults();
    expect(currentSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

/* ------------------------------------------------------------------ */

/**
 * The bodyweight is the one setting with no default, and that is the point.
 *
 * It is the multiplier on every bodyweight and assisted set the user has ever
 * logged, so a fallback number would quietly invent a year of volume figures.
 * `undefined` is a fact the app acts on: `effectiveLoadKg` returns null, session
 * volume leaves those sets out, and the history line drops its volume clause.
 */
describe('the bodyweight', () => {
  it('is unset by default, and stays unset through a sanitize', () => {
    expect(DEFAULT_SETTINGS.bodyweightKg).toBeUndefined();
    expect(sanitizeSettings(undefined).bodyweightKg).toBeUndefined();
    expect(sanitizeSettings({}).bodyweightKg).toBeUndefined();
  });

  it('is a declared key, so a device that upgraded gets it filled', () => {
    // Rule 2 of this store: it rehydrates TOTAL. A key missing from
    // DEFAULT_SETTINGS is a key `merge` never fills.
    expect(Object.keys(DEFAULT_SETTINGS)).toContain('bodyweightKg');
  });

  it('holds a real weight inside a believable range', () => {
    expect(clampBodyweightKg(82)).toBe(82);
    expect(clampBodyweightKg(82.4)).toBe(82.4);
    expect(clampBodyweightKg(1)).toBe(BODYWEIGHT_LIMITS.min);
    expect(clampBodyweightKg(5000)).toBe(BODYWEIGHT_LIMITS.max);
  });

  it('reads one decimal place, so a pound round-trip is not a paragraph', () => {
    expect(clampBodyweightKg(82.34567)).toBe(82.3);
  });

  it('takes a numeric string, because a text field hands one over', () => {
    expect(clampBodyweightKg('82.5')).toBe(82.5);
  });

  it('is UNSET rather than defaulted for anything unusable', () => {
    // Unlike `clampSetting`, which has a number to fall back to. Every one of
    // these would pass through `Number()` as a finite 0.
    for (const bad of [undefined, null, NaN, 0, -5, '', '  ', [], false, {}]) {
      expect(clampBodyweightKg(bad)).toBeUndefined();
    }
  });

  it('can be set and cleared through the store', () => {
    useSettings.getState().setBodyweightKg(82);
    expect(currentSettings().bodyweightKg).toBe(82);

    // Clearing is a real choice: "I would rather the app said nothing than guessed".
    useSettings.getState().setBodyweightKg(undefined);
    expect(currentSettings().bodyweightKg).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */

/**
 * Plate lists and gyms were settings until 4.0. A phone upgrading from an older
 * build still has them in its blob, and so does every older backup: they load,
 * and the keys are simply not carried forward.
 */
describe('plate lists and gyms from an older build', () => {
  it('load without error and are dropped', () => {
    const settings = sanitizeSettings({
      restSecondsBetweenSets: 60,
      availablePlatesKg: [20, 10],
      gyms: [{ id: 'g1', name: 'Home', platesKg: [10] }],
      activeGymId: 'g1',
    } as never);
    expect(settings.restSecondsBetweenSets).toBe(60);
    expect(settings).not.toHaveProperty('gyms');
    expect(settings).not.toHaveProperty('activeGymId');
    expect(settings).not.toHaveProperty('availablePlatesKg');
  });
});

/* ------------------------------------------------------------------ */

/**
 * AUTOMATIC BACKUP, from the store's side. The decisions are tested in
 * `lib/autoBackup.test.ts`; these are the facts the store has to keep straight.
 */
describe('the backup stamp', () => {
  const file = { uri: 'content://f/momentum-backup-2026-09-02.json', day: '2026-09-02' };

  it('records when a backup landed and which file it is in', () => {
    useSettings.getState().recordBackup('2026-09-02T10:00:00.000Z', file);
    expect(useSettings.getState().lastBackupAt).toBe('2026-09-02T10:00:00.000Z');
    expect(useSettings.getState().autoBackupFile).toEqual(file);
  });

  it('keeps the file when a stamp comes without one', () => {
    useSettings.getState().recordBackup('2026-09-02T10:00:00.000Z', file);
    useSettings.getState().recordBackup('2026-09-03T10:00:00.000Z');
    expect(useSettings.getState().autoBackupFile).toEqual(file);
  });

  it('forgets the file when the folder changes, and keeps it when the same one is re-granted', () => {
    useSettings.getState().setAutoBackupFolder('content://tree/here');
    useSettings.getState().recordBackup('2026-09-02T10:00:00.000Z', file);
    // Access was lost and the user picked the same folder: overwrite, not a twin.
    useSettings.getState().setAutoBackupFolder('content://tree/here');
    expect(useSettings.getState().autoBackupFile).toEqual(file);
    // A different folder: that URI is a file somewhere else now.
    useSettings.getState().setAutoBackupFolder('content://tree/elsewhere');
    expect(useSettings.getState().autoBackupFile).toBeUndefined();
  });

  it('refuses an unparseable stamp rather than storing NaN', () => {
    useSettings.getState().recordBackup('not a date');
    expect(Number.isFinite(Date.parse(useSettings.getState().lastBackupAt ?? ''))).toBe(true);
  });

  it('survives Reset, like the folder', () => {
    useSettings.getState().setAutoBackupFolder('content://tree/here');
    useSettings.getState().recordBackup('2026-09-02T10:00:00.000Z', file);
    useSettings.getState().resetToDefaults();
    expect(useSettings.getState().autoBackupFile).toEqual(file);
  });
});

/*
 * THE RETIRED INTERVAL. Every phone that ran 2.5.x has `autoBackupIntervalDays`
 * and `autoBackupUris` in its settings blob, and so does every backup file it
 * wrote. Neither may break hydration or an import — the key is read past and
 * dropped, and the switch and the folder beside it survive.
 */
describe('settings from a build with the weekly backup', () => {
  const old = {
    ...DEFAULT_SETTINGS,
    autoBackupEnabled: true,
    autoBackupFolderUri: 'content://tree/primary%3ADownload',
    autoBackupIntervalDays: 7,
    autoBackupUris: ['content://tree/primary%3ADownload/workout-tracker-auto-2026-09-01.json'],
    lastBackupAt: '2026-09-01T10:00:00.000Z',
  } as unknown as Partial<Settings>;

  it('sanitizes to the current shape, dropping the retired keys', () => {
    const clean = sanitizeSettings(old) as unknown as Record<string, unknown>;
    expect(clean).not.toHaveProperty('autoBackupIntervalDays');
    expect(clean).not.toHaveProperty('autoBackupUris');
    expect(clean.autoBackupEnabled).toBe(true);
    expect(clean.autoBackupFolderUri).toBe('content://tree/primary%3ADownload');
    expect(clean.lastBackupAt).toBe('2026-09-01T10:00:00.000Z');
    expect(clean.autoBackupFile).toBeUndefined();
  });

  it('hydrates from the old blob on disk', async () => {
    await AsyncStorage.setItem('settings', JSON.stringify({ state: old, version: 1 }));
    await useSettings.persist.rehydrate();
    const state = useSettings.getState() as unknown as Record<string, unknown>;
    expect(state.autoBackupFolderUri).toBe('content://tree/primary%3ADownload');
    expect(state.autoBackupIntervalDays).toBeUndefined();
    expect(useSettings.persist.hasHydrated()).toBe(true);
  });

  it('imports through importSettings without a throw', () => {
    useSettings.getState().importSettings(old);
    expect(useSettings.getState().restSecondsBetweenSets).toBe(
      DEFAULT_SETTINGS.restSecondsBetweenSets,
    );
  });
});

/*
 * The one flag that defaults OFF, which makes `!== false` — the test every other
 * flag in `sanitizeSettings` uses — exactly the wrong one for it. A device that
 * upgraded has no such key, and reading that absence as "on" would have it rewrite
 * its whole exercise library on first launch.
 */
describe('make every exercise a rep ladder', () => {
  it('is off by default and off when the key is missing', () => {
    expect(DEFAULT_SETTINGS.ladderAllExercises).toBe(false);
    expect(sanitizeSettings({}).ladderAllExercises).toBe(false);
    expect(sanitizeSettings(undefined).ladderAllExercises).toBe(false);
  });

  it('is on only for a literal true', () => {
    expect(sanitizeSettings({ ladderAllExercises: true }).ladderAllExercises).toBe(true);
    for (const value of [1, 'true', {}, []]) {
      expect(
        sanitizeSettings({ ladderAllExercises: value } as unknown as Partial<Settings>)
          .ladderAllExercises,
      ).toBe(false);
    }
  });

  it('round-trips through the store', () => {
    useSettings.getState().setFlag('ladderAllExercises', true);
    expect(currentSettings().ladderAllExercises).toBe(true);

    useSettings.getState().setFlag('ladderAllExercises', false);
    expect(currentSettings().ladderAllExercises).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

/**
 * The language, through the sanitizer.
 */
describe('the language', () => {
  it('ships in English, keeps a stored language, and falls back for anything unreadable', () => {
    expect(DEFAULT_SETTINGS.language).toBe('en');
    expect(sanitizeSettings({ language: 'ru' }).language).toBe('ru');
    expect(sanitizeSettings({ language: 'fr' } as unknown as Partial<Settings>).language).toBe(
      'en',
    );
    expect(sanitizeSettings({}).language).toBe('en');
  });

  // A blob from a build that had a first-launch picker and themes still reads.
  it('drops the retired language flag and theme fields', () => {
    const read = sanitizeSettings({
      language: 'ru',
      languageChosen: true,
      themeId: 'ember',
      customColors: ['#111111', '#222222', '#333333'],
    } as unknown as Partial<Settings>);
    expect(read.language).toBe('ru');
    expect(read).not.toHaveProperty('languageChosen');
    expect(read).not.toHaveProperty('themeId');
    expect(read).not.toHaveProperty('customColors');
  });

  /*
   * A reset that defaulted the language would flip the app under somebody who
   * pressed a button in the other one. Same carve-out as the bodyweight log.
   */
  it('keeps the language across a reset to defaults', () => {
    useSettings.setState({ language: 'ru', restSecondsBetweenSets: 45 });
    useSettings.getState().resetToDefaults();
    expect(useSettings.getState().language).toBe('ru');
    // And it really did reset the things it is for.
    expect(useSettings.getState().restSecondsBetweenSets).toBe(
      DEFAULT_SETTINGS.restSecondsBetweenSets,
    );
  });
});

describe('the assistant cards that were closed (U2)', () => {
  it('is absent by default and on a blob from 2.2.0, which had no such key', () => {
    expect(DEFAULT_SETTINGS.aiCardsDismissed).toBeUndefined();
    expect(sanitizeSettings({}).aiCardsDismissed).toBeUndefined();
    expect(sanitizeSettings(undefined).aiCardsDismissed).toBeUndefined();
  });

  it('keeps the training chat once, and drops 2.x keys for the other logs and anything else', () => {
    expect(
      sanitizeSettings({
        aiCardsDismissed: ['Expenses', 'Workout', 'Tasks', 'Workout', 'Garden'],
      } as unknown as Partial<Settings>).aiCardsDismissed,
    ).toEqual(['Workout']);
    expect(
      sanitizeSettings({ aiCardsDismissed: 'Tasks' } as unknown as Partial<Settings>)
        .aiCardsDismissed,
    ).toBeUndefined();
  });

  it('persists the ✕, and a second ✕ changes nothing', () => {
    useSettings.getState().dismissAiCard('Workout');
    useSettings.getState().dismissAiCard('Workout');
    expect(currentSettings().aiCardsDismissed).toEqual(['Workout']);
  });

  it('survives Reset settings to defaults — a closed card is not a timer', () => {
    useSettings.getState().dismissAiCard('Workout');
    useSettings.getState().resetToDefaults();
    expect(currentSettings().aiCardsDismissed).toEqual(['Workout']);
  });
});

describe('the weekly review closed this week (X3)', () => {
  it('is absent by default and on a blob from 2.2.0, which had no such key', () => {
    expect(DEFAULT_SETTINGS.weeklyReviewDismissed).toBeUndefined();
    expect(sanitizeSettings({}).weeklyReviewDismissed).toBeUndefined();
    expect(sanitizeSettings(undefined).weeklyReviewDismissed).toBeUndefined();
  });

  it('keeps only a real Monday', () => {
    const keep = (value: unknown) =>
      sanitizeSettings({ weeklyReviewDismissed: value } as unknown as Partial<Settings>)
        .weeklyReviewDismissed;
    expect(keep('2026-10-05')).toBe('2026-10-05');
    expect(keep('2026-10-06')).toBeUndefined(); // a Tuesday
    expect(keep('2026-02-30')).toBeUndefined();
    expect(keep(20261005)).toBeUndefined();
  });

  it('stamps the Monday of the week it was closed in', () => {
    useSettings.getState().dismissWeeklyReview('2026-10-08');
    expect(currentSettings().weeklyReviewDismissed).toBe('2026-10-05');
    useSettings.getState().dismissWeeklyReview('2027-01-03'); // Sunday, week of 28 Dec
    expect(currentSettings().weeklyReviewDismissed).toBe('2026-12-28');
  });

  it('survives Reset settings to defaults', () => {
    useSettings.getState().dismissWeeklyReview('2026-10-05');
    useSettings.getState().resetToDefaults();
    expect(currentSettings().weeklyReviewDismissed).toBe('2026-10-05');
  });
});

describe('keys of features that were removed', () => {
  it('a 3.x blob carrying them sanitizes cleanly and drops them', () => {
    const old = {
      restSecondsBetweenSets: 95,
      engagement: true,
      milestoneShown: 100,
      seenSetTypeTip: true,
      seenLeaveRunningTip: true,
    } as unknown as Partial<Settings>;
    const clean = sanitizeSettings(old) as unknown as Record<string, unknown>;
    expect(clean.restSecondsBetweenSets).toBe(95);
    for (const key of ['engagement', 'milestoneShown', 'seenSetTypeTip', 'seenLeaveRunningTip']) {
      expect(key in clean).toBe(false);
    }
  });
});

describe('keys of the debrief, reminder, Health Connect, measurements and goal', () => {
  it('a 3.x blob carrying them sanitizes cleanly and drops them', () => {
    const retired = [
      'askAfterWorkout',
      'workoutReminderEnabled',
      'workoutReminderDays',
      'workoutReminderTime',
      'shareToHealthConnect',
      'bodyMeasurements',
      'weeklyWorkoutGoal',
      'excusedWeeks',
    ];
    const old = {
      restSecondsBetweenSets: 95,
      askAfterWorkout: false,
      workoutReminderEnabled: true,
      workoutReminderDays: [0, 2],
      workoutReminderTime: '07:00',
      shareToHealthConnect: true,
      bodyMeasurements: { waist: [{ day: '2026-10-05', cm: 82.5 }] },
      weeklyWorkoutGoal: 4,
      excusedWeeks: ['2026-10-05'],
    } as unknown as Partial<Settings>;
    const clean = sanitizeSettings(old) as unknown as Record<string, unknown>;
    expect(clean.restSecondsBetweenSets).toBe(95);
    for (const key of retired) expect(key in clean).toBe(false);
  });
});

describe('the weigh-in reminder (4.0)', () => {
  it('is on, Wednesday and Sunday at 06:00, on a fresh install', () => {
    const fresh = sanitizeSettings(undefined);
    expect(fresh.weighInReminderEnabled).toBe(true);
    expect(fresh.weighInReminderDays).toEqual([2, 6]);
    expect(fresh.weighInReminderTime).toBe('06:00');
  });

  it('gives an old blob with no such keys the defaults — not the old workout reminder', () => {
    const old = {
      workoutReminderEnabled: false,
      workoutReminderDays: [0, 2, 4],
      workoutReminderTime: '18:00',
    } as unknown as Partial<Settings>;
    const clean = sanitizeSettings(old);
    expect(clean.weighInReminderEnabled).toBe(true);
    expect(clean.weighInReminderDays).toEqual([2, 6]);
    expect(clean.weighInReminderTime).toBe('06:00');
  });

  it('keeps it off once switched off', () => {
    expect(sanitizeSettings({ weighInReminderEnabled: false }).weighInReminderEnabled).toBe(false);
  });

  it('cleans the days: in range, whole, once each, sorted — or the default pair', () => {
    const days = (value: unknown) =>
      sanitizeSettings({ weighInReminderDays: value } as unknown as Partial<Settings>)
        .weighInReminderDays;
    expect(days([6, 0, 6, 9, -1, 2.5, '3'])).toEqual([0, 6]);
    expect(days([])).toEqual([2, 6]);
    expect(days('wed')).toEqual([2, 6]);
    expect(days([42])).toEqual([2, 6]);
  });

  it('normalises the time, and refuses one the scheduler cannot use', () => {
    const time = (value: unknown) =>
      sanitizeSettings({ weighInReminderTime: value } as unknown as Partial<Settings>)
        .weighInReminderTime;
    expect(time('6:30')).toBe('06:30');
    expect(time('24:00')).toBe('06:00');
    expect(time(630)).toBe('06:00');
  });

  it('switches itself off when the last day is unticked, and back on with days', () => {
    const s = useSettings.getState();
    s.toggleWeighInReminderDay(2);
    s.toggleWeighInReminderDay(6);
    expect(useSettings.getState().weighInReminderDays).toEqual([]);
    expect(useSettings.getState().weighInReminderEnabled).toBe(false);
    useSettings.getState().setWeighInReminderEnabled(true);
    expect(useSettings.getState().weighInReminderDays).toEqual([2, 6]);
    expect(useSettings.getState().weighInReminderEnabled).toBe(true);
  });

  it('adds a day in order, and writes the wheel as HH:MM', () => {
    useSettings.getState().toggleWeighInReminderDay(0);
    expect(useSettings.getState().weighInReminderDays).toEqual([0, 2, 6]);
    useSettings.getState().setWeighInReminderTime(7, 5);
    expect(useSettings.getState().weighInReminderTime).toBe('07:05');
  });
});
