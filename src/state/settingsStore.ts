/**
 * Settings store — every duration the app counts, in one place.
 *
 * These used to be constants scattered across `seedUser`, `lib/setTimer` and the
 * rest-timer pill. They are settings now for one reason: the correct length of a
 * rest is a fact about the lifter, not about the app, and the only person who
 * knows it is holding the phone.
 *
 * Three rules this store follows:
 *
 *  1. EVERY NUMBER HERE IS CLAMPED ON THE WAY IN (`sanitize`). A persisted blob
 *     from an older build, a half-finished write, or a NaN out of a text field
 *     must never reach the timer maths — a rest of `NaN` seconds is a deadline of
 *     `NaN`, which is a countdown that never ends and a pill that never leaves.
 *  2. IT REHYDRATES TOTAL. `merge` fills every key from `DEFAULT_SETTINGS`, so a
 *     setting added in a later version is never `undefined` on a device that
 *     upgraded rather than installed fresh.
 *  3. Nothing in here is read during a tick. Timers capture their lengths when
 *     they START, so dragging a setting mid-rest can't move a deadline the user
 *     is already watching.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { usableBackupFile, type BackupFileRecord } from '../lib/autoBackup';
import {
  clampBodyweightKg,
  recordBodyweight,
  sanitizeBodyweightLog,
  type BodyweightEntry,
} from '../lib/bodyweightLog';
import { formatClockTime, parseClockTime, parseDay, weekStart, type Weekday } from '../lib/days';
import { DEFAULT_WEIGH_IN_DAYS, DEFAULT_WEIGH_IN_TIME } from '../lib/weighInReminder';
import { AI_SECTIONS, type AiSection } from '../lib/ai/aiSchema';
import { usableLanguage, type Language } from '../lib/i18n';
import type { MuscleCluster, UnitSystem } from '../types/models';

export interface Settings {
  /**
   * The user's own bodyweight, in kilograms. UNSET BY DEFAULT, and unset means
   * unset — see `clampBodyweightKg`.
   *
   * It is here rather than derived because nothing else in the app can know it,
   * and it is optional because guessing it would be worse than not having it: it
   * is the multiplier on every bodyweight and assisted set the user has ever
   * logged, so a made-up 80 kg would quietly invent a year of volume figures. The
   * only thing that reads it is `effectiveLoadKg`.
   */
  bodyweightKg?: number;
  /**
   * EVERY bodyweight the user has typed, newest first — and the reason
   * `bodyweightKg` above is the HEAD of this list rather than a second opinion.
   *
   * `effectiveLoadKg` multiplies a bodyweight into every pull-up, dip and assisted
   * set in the log, and the right multiplier is different for every session. One
   * scalar answered that question with today's number, which repriced old sessions
   * on edit and hid real progress. `lib/bodyweightLog.ts` has the whole argument.
   *
   * The scalar stays because everything that only wants "what do I weigh now" reads
   * it, and `setBodyweightKg` writes both — so the two cannot drift.
   */
  bodyweightLog: BodyweightEntry[];
  /**
   * Rest after a set — for every exercise that has no rest of its own.
   *
   * SETTING IT CLEARS THOSE TOO. The write goes through `state/restSync.ts`, not
   * through `setNumber` alone, because this number is a claim about every set in
   * the app and an override the user has forgotten about makes it a false one.
   * That is the bug the whole of `lib/rest.ts` is about.
   */
  restSecondsBetweenSets: number;
  /** Rest after the LAST set of an exercise, before the next one. */
  restSecondsBetweenExercises: number;
  /** Get-ready countdown before a timed set's clock starts. 0 = straight to work. */
  prepareSeconds: number;
  /**
   * How many seconds of a countdown get an audible tick. The final second gets a
   * distinct, longer tone instead. 0 turns the count-in off entirely.
   */
  beepSeconds: number;
  /** The ± step on the rest pill and the set-timer pill. */
  adjustStepSeconds: number;
  /** Completing a set starts rest automatically. Off = rest is manual. */
  autoStartRest: boolean;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  /** Hold the screen on while a timer runs. */
  keepAwakeEnabled: boolean;
  /** Fire a local notification when a timer ends, for a phone in a pocket. */
  notifyOnTimerEnd: boolean;
  /**
   * EVERY rep-counted exercise runs a rep ladder.
   *
   * The ladder (`lib/repLadder.ts`) is a per-exercise fact — it derives a whole
   * session's reps from one max, and the max belongs to the lifter and the
   * movement. This setting does not change that; it is a BULK EDITOR with a memory.
   * Switching it on puts an `auto` ladder on every rep-counted exercise that hasn't
   * got one and makes new ones default to having a ladder; switching it off takes
   * back exactly the ladders it gave and nothing else — see `RepLadder.auto`.
   *
   * So it is a flag about the LIBRARY, kept here rather than derived, for one
   * reason: without it, "should the exercise I create tomorrow have a ladder?" has
   * no answer, and the setting would be a button that quietly stopped applying.
   */
  ladderAllExercises: boolean;
  unitSystem: UnitSystem;
  /**
   * WEEKLY SET TARGETS PER MUSCLE CLUSTER, and every one of them is optional.
   *
   * `lib/balance.ts` counts sets per cluster and refuses to score them — "a count,
   * not a score" — and that refusal is right about someone else's model of your
   * recovery. It is not right about a number YOU chose: a target you typed is a
   * fact about your plan, and comparing this week against it is arithmetic you
   * would otherwise do in your head.
   *
   * So: absent means no target and the count renders exactly as it always has. A
   * number means the row says `14 / 16` and nothing more — no colour, no warning,
   * no ratio the app invented.
   */
  weeklySetTargets: Partial<Record<MuscleCluster, number>>;

  /**
   * Which language the app speaks. English on a fresh install; an existing
   * install keeps whatever it has stored.
   *
   * A setting rather than the phone's locale, because the phone's locale is a
   * fact about the phone and this is a fact about the person holding it: the same
   * device is handed to somebody who reads Russian and somebody who does not, and
   * the toggle in the corner of Settings is one tap either way.
   */
  language: Language;
  /* --- automatic backup: see `lib/autoBackup.ts` --------------------- */
  /**
   * Rewrite the backup file after every change, without being asked.
   *
   * ON by default, and inert until a folder is granted — see `autoBackupFolderUri`.
   * The default is on because the alternative default is a year of training
   * protected by the user remembering a menu item.
   *
   * There used to be an `autoBackupIntervalDays` beside it (a weekly copy, taken
   * on launch). It is gone, not renamed: an old blob or an old backup file that
   * still carries it is read without complaint and the key is simply dropped by
   * `sanitizeSettings`, which builds its result from the known keys only.
   */
  autoBackupEnabled: boolean;
  /**
   * The SAF tree URI the copies are written into, or absent.
   *
   * Absent is the normal state on a fresh install and it means automatic backup
   * cannot run: Android's only writable-and-durable destination is a folder the
   * user grants, and the app's own sandbox dies with the app — which is one of the
   * events a backup exists to survive.
   */
  autoBackupFolderUri?: string;
  /** When the last backup — automatic or manual — actually landed. */
  lastBackupAt?: string;
  /**
   * The day's backup file — its URI and the day it belongs to — so the next write
   * that day overwrites it in place and the first write of a new day knows which
   * file to retire. SAF reaches files by URI only, so the name alone is not enough.
   * See `lib/autoBackup.ts`. Absent until the first write into the folder.
   *
   * It replaced `autoBackupUris`, the rotation list of the weekly
   * `workout-tracker-auto-*` copies; an old blob's list is dropped, and those
   * files are deliberately left where they are.
   */
  autoBackupFile?: BackupFileRecord;

  /* --- the assistant's entry card (U2) ------------------------------- */
  /**
   * The sections whose assistant card is gone for good: the ✕ was pressed, or a
   * chat was had there. After that the ✦ in the corner is the way in.
   *
   * OPTIONAL, and absent means "none": a phone upgrading from 2.2.0 and a backup
   * written by it have no such key, and both must come up showing all three
   * cards exactly as before. A list rather than three booleans so a section added
   * later needs no new key.
   */
  aiCardsDismissed?: AiSection[];

  /* --- the landing's weekly review (X3) ------------------------------ */
  /**
   * The Monday (`YYYY-MM-DD`) of the week whose review card was closed with ✕.
   * Stamped with the week rather than set as a flag, so next Monday's card comes
   * back on its own — see `lib/weeklyReview.ts`.
   *
   * OPTIONAL, absent = "not closed this week": a 2.2.0 phone and its backups
   * have no such key and come up showing the card.
   */
  weeklyReviewDismissed?: string;

  /* --- the weigh-in reminder: see `lib/weighInReminder.ts` ------------ */
  /**
   * Have the phone say "time to weigh in" on the mornings you weigh in.
   *
   * ON by default — unlike the workout reminder it replaced — because the owner
   * asked for it on, and because it is inert until notifications are granted:
   * `useWeighInReminder` schedules nothing behind a denied permission, and the
   * settings row says so. `!== false`, so a device upgrading from a build with no
   * such key comes up with it on, like a fresh install.
   */
  weighInReminderEnabled: boolean;
  /** Monday = 0 … Sunday = 6. Wednesday and Sunday by default. */
  weighInReminderDays: Weekday[];
  /** `HH:MM`, 24-hour. The wheel writes it; the snooze reuses it for "tomorrow". */
  weighInReminderTime: string;
}

export const DEFAULT_SETTINGS: Settings = {
  /*
   * Listed, and `undefined`. Rule 2 of this store is that it rehydrates TOTAL —
   * `merge` fills every key from here — so a key that is absent from this object is
   * a key a device that upgraded never gets filled. `undefined` IS the default for
   * a bodyweight: see `clampBodyweightKg` for why there is no number to fall back
   * to.
   */
  bodyweightKg: undefined,
  bodyweightLog: [],
  restSecondsBetweenSets: 120,
  restSecondsBetweenExercises: 150,
  prepareSeconds: 5,
  beepSeconds: 5,
  adjustStepSeconds: 15,
  autoStartRest: true,
  soundEnabled: true,
  hapticsEnabled: true,
  keepAwakeEnabled: true,
  notifyOnTimerEnd: true,
  ladderAllExercises: false,
  unitSystem: 'metric',
  weeklySetTargets: {},
  language: 'en',
  autoBackupEnabled: true,
  autoBackupFolderUri: undefined,
  lastBackupAt: undefined,
  autoBackupFile: undefined,
  // Declared so the key set is complete; absent on disk means "no card closed".
  aiCardsDismissed: undefined,
  weeklyReviewDismissed: undefined,
  weighInReminderEnabled: true,
  weighInReminderDays: [...DEFAULT_WEIGH_IN_DAYS],
  weighInReminderTime: DEFAULT_WEIGH_IN_TIME,
};

/**
 * Allowed range per numeric setting, and the step the settings screen nudges by.
 * The ceilings are not arbitrary: a rest longer than 15 minutes is a different
 * workout, and a get-ready longer than a minute is a nap.
 */
export const SETTING_LIMITS = {
  restSecondsBetweenSets: { min: 0, max: 900, step: 15 },
  restSecondsBetweenExercises: { min: 0, max: 900, step: 15 },
  prepareSeconds: { min: 0, max: 60, step: 1 },
  beepSeconds: { min: 0, max: 30, step: 1 },
  adjustStepSeconds: { min: 5, max: 60, step: 5 },
} as const satisfies Record<string, { min: number; max: number; step: number }>;

export type NumericSetting = keyof typeof SETTING_LIMITS;

/**
 * Whole seconds inside the setting's own range. Anything unusable → the default.
 *
 * Note what is NOT accepted: `null`, `undefined`, `[]`, `''` and `false` all pass
 * through `Number()` as a finite `0`, so a blanket `Number(value)` would turn a
 * missing rest length into "no rest" and call it valid. A number is a number; a
 * numeric string is allowed because a text field hands one over; everything else
 * is missing data and takes the default.
 */
export function clampSetting(key: NumericSetting, value: unknown): number {
  const { min, max } = SETTING_LIMITS[key];

  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;

  if (!Number.isFinite(n)) return DEFAULT_SETTINGS[key];
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * A complete, in-range `Settings` from anything at all — including `undefined`.
 *
 * Every field is named explicitly rather than spread through. This function is
 * also `partialize`, so it is handed the LIVE STORE STATE, which carries the
 * action functions alongside the values: a spread would put `setNumber` and
 * friends into the object written to disk and returned by `currentSettings`.
 * Listing the keys keeps the result exactly `Settings`, and makes a field added to
 * the interface without being sanitized a type error rather than an unchecked
 * number reaching a deadline.
 */
export function sanitizeSettings(input: Partial<Settings> | undefined | null): Settings {
  const raw: Settings = { ...DEFAULT_SETTINGS, ...(input ?? {}) };

  /*
   * The bodyweight log and the scalar are one fact in two shapes, and the LOG wins:
   * a scalar with no matching entry is a device upgrading from a build that only
   * had the scalar, so it is seeded as the first reading. Without that seeding, the
   * first thing the new bodyweight chart would show a long-time user is an empty
   * screen, and `bodyweightAt` would return null for their whole history.
   */
  const scalar = clampBodyweightKg(raw.bodyweightKg);
  const storedLog = sanitizeBodyweightLog(raw.bodyweightLog);
  const bodyweightLog =
    storedLog.length === 0 && scalar != null ? recordBodyweight([], scalar) : storedLog;

  return {
    // Named here like every other key, and `undefined` is a legal result: see
    // `clampBodyweightKg`. `JSON.stringify` drops it, so an unset bodyweight
    // costs no bytes on disk and reads back as unset.
    bodyweightKg: scalar,
    bodyweightLog,
    restSecondsBetweenSets: clampSetting('restSecondsBetweenSets', raw.restSecondsBetweenSets),
    restSecondsBetweenExercises: clampSetting(
      'restSecondsBetweenExercises',
      raw.restSecondsBetweenExercises,
    ),
    prepareSeconds: clampSetting('prepareSeconds', raw.prepareSeconds),
    beepSeconds: clampSetting('beepSeconds', raw.beepSeconds),
    adjustStepSeconds: clampSetting('adjustStepSeconds', raw.adjustStepSeconds),
    autoStartRest: raw.autoStartRest !== false,
    soundEnabled: raw.soundEnabled !== false,
    hapticsEnabled: raw.hapticsEnabled !== false,
    keepAwakeEnabled: raw.keepAwakeEnabled !== false,
    notifyOnTimerEnd: raw.notifyOnTimerEnd !== false,
    // The one flag that defaults OFF, so `!== false` would be the wrong test: an
    // upgraded device with no such key must not wake up having rewritten its
    // whole library.
    ladderAllExercises: raw.ladderAllExercises === true,
    unitSystem: raw.unitSystem === 'imperial' ? 'imperial' : 'metric',
    weeklySetTargets: sanitizeWeeklyTargets(raw.weeklySetTargets),
    language: usableLanguage(raw.language),
    autoBackupEnabled: raw.autoBackupEnabled !== false,
    autoBackupFolderUri: usableFolderUri(raw.autoBackupFolderUri),
    // `=== true`, not `!== false`: this one defaults OFF, so a device upgrading
    // from a build without the key must not wake up sharing its training data.
    lastBackupAt: usableInstant(raw.lastBackupAt),
    autoBackupFile: usableBackupFile(raw.autoBackupFile),
    aiCardsDismissed: usableSections(raw.aiCardsDismissed),
    weeklyReviewDismissed: usableMonday(raw.weeklyReviewDismissed),
    weighInReminderEnabled: raw.weighInReminderEnabled !== false,
    weighInReminderDays: usableWeekdays(raw.weighInReminderDays),
    weighInReminderTime: usableClockTime(raw.weighInReminderTime),
  };
}

/**
 * Weekly per-cluster targets: a whole number of sets, or the key is absent.
 *
 * Absent rather than zero, because zero is a real target ("I am not training legs
 * this block") and "no opinion" has to be distinguishable from it. Capped at 60 —
 * past any published maximum recoverable volume, so a number above it is a typo.
 */
const WEEKLY_TARGET_LIMITS = { min: 0, max: 60, step: 1 } as const;

function sanitizeWeeklyTargets(value: unknown): Partial<Record<MuscleCluster, number>> {
  if (typeof value !== 'object' || value == null) return {};
  const out: Partial<Record<MuscleCluster, number>> = {};
  for (const cluster of CLUSTER_KEYS) {
    const raw = (value as Record<string, unknown>)[cluster];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const { min, max } = WEEKLY_TARGET_LIMITS;
    out[cluster] = Math.min(max, Math.max(min, Math.round(raw)));
  }
  return out;
}

/**
 * The clusters, listed here rather than imported from `lib/muscles.ts`.
 *
 * `muscles.ts` imports nothing and is the compile-time proof that the muscle→cluster
 * mapping is total; this store already imports two libs and does not need a third
 * for five string literals. The `satisfies` is what keeps the two in step: a new
 * cluster added to the type stops compiling here.
 */
const CLUSTER_KEYS = [
  'push',
  'pull',
  'legs',
  'core',
  'cardio',
  'skill',
] as const satisfies readonly MuscleCluster[];

/** A folder URI that could plausibly have been granted, or undefined. */
function usableFolderUri(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** A parseable instant, or undefined — a `NaN` date would make every backup due. */
function usableInstant(value: unknown): string | undefined {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;
}

/**
 * Known sections, once each, in the app's own order — or `undefined` for none,
 * so a device that never dismissed a card writes no key at all.
 */
function usableSections(value: unknown): AiSection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept = AI_SECTIONS.filter((section) => value.includes(section));
  return kept.length > 0 ? kept : undefined;
}

/** A real `YYYY-MM-DD` that is a Monday, or absent. */
function usableMonday(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return parseDay(value) != null && weekStart(value) === value ? value : undefined;
}

/**
 * Weekdays, once each and in order — or the default pair.
 *
 * An empty or unreadable list falls back to Wednesday and Sunday rather than
 * staying empty: the only way to reach an empty list is unticking the last chip,
 * which also switches the reminder off, so turning it back on after a relaunch
 * finds two days to fire on instead of a switch that does nothing.
 */
function usableWeekdays(value: unknown): Weekday[] {
  if (!Array.isArray(value)) return [...DEFAULT_WEIGH_IN_DAYS];
  const kept = new Set(
    value.filter((day): day is Weekday => Number.isInteger(day) && day >= 0 && day <= 6),
  );
  return kept.size > 0 ? [...kept].sort((a, b) => a - b) : [...DEFAULT_WEIGH_IN_DAYS];
}

/**
 * `HH:MM` on a 24-hour clock, or the default. Through `parseClockTime` and back
 * out, so a legal but untidy `6:00` is normalised to `06:00` and every reader
 * downstream gets one shape — and anything refused lands on a time the
 * scheduler can actually use rather than a `NaN` trigger.
 */
function usableClockTime(value: unknown): string {
  const parsed = parseClockTime(value);
  return parsed ? formatClockTime(parsed.hour, parsed.minute) : DEFAULT_WEIGH_IN_TIME;
}

interface SettingsState extends Settings {
  setNumber: (key: NumericSetting, value: number) => void;
  /** Relative nudge, for the ± controls on the settings rows. */
  bumpNumber: (key: NumericSetting, delta: number) => void;
  setFlag: (
    key:
      | 'autoStartRest'
      | 'soundEnabled'
      | 'hapticsEnabled'
      | 'keepAwakeEnabled'
      | 'notifyOnTimerEnd'
      | 'ladderAllExercises',
    value: boolean,
  ) => void;
  setUnitSystem: (unitSystem: UnitSystem) => void;
  /**
   * The one write behind the РУ / EN toggle in the corner of Settings.
   */
  setLanguage: (language: Language) => void;
  /**
   * Set or clear the bodyweight. `undefined` clears it, which is a real choice —
   * "I would rather the app said nothing than guessed".
   */
  setBodyweightKg: (kg: number | undefined) => void;
  /** A weekly set target for one cluster. `undefined` clears it. */
  setWeeklyTarget: (cluster: MuscleCluster, sets: number | undefined) => void;
  /** The weigh-in reminder, as three writes because they are three questions. */
  setWeighInReminderEnabled: (enabled: boolean) => void;
  toggleWeighInReminderDay: (day: Weekday) => void;
  setWeighInReminderTime: (hour: number, minute: number) => void;

  /* --- automatic backup: see `lib/autoBackup.ts` --------------------- */
  setAutoBackupEnabled: (enabled: boolean) => void;
  /** Remember the granted folder. `undefined` forgets it, which turns backup off. */
  setAutoBackupFolder: (folderUri: string | undefined) => void;
  /**
   * Record that a backup landed, and which file it is now in.
   *
   * Called by every write — the automatic one, `Back up now` and `Export
   * everything` all go through `runBackupNow` — so "last backup" means the last
   * time the data actually left the phone, whoever asked for it. Neither field is
   * watched by the automatic backup (`lib/backupWatch.ts`), which is what stops a
   * write recording itself from asking for another write.
   */
  recordBackup: (at: string, file?: BackupFileRecord) => void;

  /** Hide one section's assistant card for good (U2). */
  dismissAiCard: (section: AiSection) => void;

  /** Close the weekly review until next Monday (X3); `today` picks the week. */
  dismissWeeklyReview: (today: string) => void;

  /** `Reset every setting` — see the action for what it keeps. */
  resetToDefaults: () => void;
  /**
   * Replace every setting from a restored backup.
   *
   * Takes `unknown` and leans on `sanitizeSettings`, which is total: a backup
   * missing a field added in a later build gets that field's default rather than an
   * `undefined` that would reach a deadline as `NaN`.
   */
  importSettings: (raw: unknown) => void;
}

/** Set by the persist error callback below — declared first so it exists by then. */
let settingsReadFailed = false;
const readFailedListeners = new Set<() => void>();

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,

      setNumber: (key, value) => set({ [key]: clampSetting(key, value) } as Partial<Settings>),

      bumpNumber: (key, delta) =>
        set({ [key]: clampSetting(key, get()[key] + delta) } as Partial<Settings>),

      setFlag: (key, value) => set({ [key]: value } as Partial<Settings>),

      setUnitSystem: (unitSystem) => set({ unitSystem }),

      setLanguage: (language) => set({ language: usableLanguage(language) }),

      /*
       * BOTH, always. The scalar is what "what do I weigh now" reads and the log is
       * what "what did I weigh in June" reads; writing one without the other is how
       * two homes for one number becomes one of them being stale (`Settings.bodyweightKg`).
       * Clearing it leaves the log alone — "stop guessing my load" is not "forget
       * every weigh-in I ever recorded", and the log is what a restored history needs.
       */
      setBodyweightKg: (kg) => {
        const clamped = clampBodyweightKg(kg);
        set({
          bodyweightKg: clamped,
          bodyweightLog:
            clamped == null ? get().bodyweightLog : recordBodyweight(get().bodyweightLog, clamped),
        });
      },

      setWeeklyTarget: (cluster, sets) => {
        const current = { ...get().weeklySetTargets };
        if (sets == null) delete current[cluster];
        else current[cluster] = sets;
        set({ weeklySetTargets: sanitizeWeeklyTargets(current) });
      },

      setAutoBackupEnabled: (autoBackupEnabled) => set({ autoBackupEnabled }),

      setAutoBackupFolder: (folderUri) => {
        const next = usableFolderUri(folderUri);
        /*
         * The day's file belongs to a folder. Pointing somewhere else makes that
         * URI a file in the old folder, and overwriting or deleting it would be
         * wrong — the new folder gets its own file on the next write. Re-granting
         * the SAME folder (access was lost and the user picked it again) keeps it,
         * so the next write overwrites that file rather than creating a twin.
         */
        set(
          next === get().autoBackupFolderUri
            ? { autoBackupFolderUri: next }
            : { autoBackupFolderUri: next, autoBackupFile: undefined },
        );
      },

      recordBackup: (at, file) => {
        const stamp = usableInstant(at) ?? new Date().toISOString();
        const record = usableBackupFile(file);
        set(record ? { lastBackupAt: stamp, autoBackupFile: record } : { lastBackupAt: stamp });
      },

      dismissAiCard: (section) =>
        set({ aiCardsDismissed: usableSections([...(get().aiCardsDismissed ?? []), section]) }),

      /*
       * Turning it on with no days would arm a reminder that can never fire,
       * which reads on screen as the switch not working — so it comes back with
       * the default pair.
       */
      setWeighInReminderEnabled: (weighInReminderEnabled) =>
        set({
          weighInReminderEnabled,
          weighInReminderDays:
            weighInReminderEnabled && get().weighInReminderDays.length === 0
              ? [...DEFAULT_WEIGH_IN_DAYS]
              : get().weighInReminderDays,
        }),

      toggleWeighInReminderDay: (day) => {
        const current = get().weighInReminderDays;
        const next = current.includes(day)
          ? current.filter((d) => d !== day)
          : [...current, day].sort((a, b) => a - b);
        // Unticking the last day switches the reminder off: an armed reminder
        // with no day is the switch lying about what it does.
        set({
          weighInReminderDays: next,
          weighInReminderEnabled: next.length === 0 ? false : get().weighInReminderEnabled,
        });
      },

      setWeighInReminderTime: (hour, minute) =>
        set({ weighInReminderTime: formatClockTime(hour, minute) }),

      dismissWeeklyReview: (today) =>
        set({ weeklyReviewDismissed: usableMonday(weekStart(today)) }),

      resetToDefaults: () =>
        /*
         * The bodyweight log and the granted folder are NOT settings in the sense
         * this button means. "Reset settings to defaults" is about the durations
         * and the toggles; it is not about deleting a year of weigh-ins, or a
         * folder permission the user would then have to grant again. `Delete all workout history` is the
         * button that destroys data, and it says so.
         *
         * THE LANGUAGE IS THE SAME KIND OF EXCEPTION, and it is the sharpest one.
         * Defaulting it would flip the app to English under somebody who just
         * pressed a button in Russian. The reset is about the durations
         * and the toggles inside the app's section; which language those words
         * are in is not one of them, and the РУ / EN toggle is right there.
         */
        set({
          ...DEFAULT_SETTINGS,
          language: get().language,
          bodyweightKg: get().bodyweightKg,
          bodyweightLog: get().bodyweightLog,
          autoBackupFolderUri: get().autoBackupFolderUri,
          lastBackupAt: get().lastBackupAt,
          autoBackupFile: get().autoBackupFile,
          // A card the user closed is not a duration or a switch; resetting the
          // timers is no reason for it to come back.
          aiCardsDismissed: get().aiCardsDismissed,
          weeklyReviewDismissed: get().weeklyReviewDismissed,
        }),

      importSettings: (raw) =>
        set({ ...sanitizeSettings(raw as Partial<Settings> | undefined | null) }),
    }),
    {
      name: 'settings',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      /*
       * Actions are recreated by the initializer on every launch; only the values
       * are worth writing to disk, and writing the functions would break the
       * JSON round-trip.
       */
      partialize: (state) => sanitizeSettings(state),
      /*
       * Rehydration is where a bad blob would otherwise become a NaN deadline.
       * Everything from disk goes through `sanitizeSettings` first, and the
       * actions come from the freshly-built store rather than from storage.
       */
      merge: (persisted, current) => ({
        ...current,
        ...sanitizeSettings(persisted as Partial<Settings> | undefined),
      }),
      /*
       * A read that FAILS (storage error, a blob that is not JSON) never marks the
       * store hydrated, and never fires `onFinishHydration` — and the root waits
       * on exactly that, so the app was a blank screen on every launch with no
       * way out but clearing its data. Say it failed, and let the root go on
       * with the defaults.
       */
      onRehydrateStorage: () => (_state, error) => {
        if (error == null) return;
        settingsReadFailed = true;
        for (const listener of [...readFailedListeners]) listener();
      },
    },
  ),
);

/** Whether reading the settings from disk failed this launch. */
export function settingsHydrationFailed(): boolean {
  return settingsReadFailed;
}

/** Called once if the settings read fails; returns the unsubscribe. */
export function onSettingsHydrationFailed(listener: () => void): () => void {
  readFailedListeners.add(listener);
  return () => readFailedListeners.delete(listener);
}

/**
 * The settings a session needs, as a plain object.
 *
 * Read OUTSIDE React (`useSettings.getState()`) on purpose: this is called from
 * store actions and from timer callbacks, not from render, and subscribing there
 * would tie a lifter's rest length to a component's lifecycle.
 */
export function currentSettings(): Settings {
  return sanitizeSettings(useSettings.getState());
}
