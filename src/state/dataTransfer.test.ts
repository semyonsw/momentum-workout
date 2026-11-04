import { beforeEach, describe, expect, it } from 'vitest';

import {
  UnreadableLogError,
  applyBackup,
  currentSnapshot,
  exportBackupText,
  exportCsvText,
} from './dataTransfer';
import { useLibrary } from './libraryStore';
import { DEFAULT_SETTINGS, useSettings } from './settingsStore';
import { useWorkoutHistory } from './workoutHistoryStore';
import { sanitizeAi, useAi } from './aiStore';
import { useDebriefs } from './debriefStore';
import { parseBackup } from '../lib/backup';
import { buildDraftSession, type DraftSession } from '../lib/draft';
import { seedExercises, seedRoutine, seedUser } from '../data/seed';
import { fixtureHistoryByExerciseId } from '../../test/fixtures/history';
import type { Exercise, ID } from '../types/models';

const exercisesById = Object.fromEntries(seedExercises.map((e) => [e.id, e])) as Record<
  ID,
  Exercise
>;

/** A finished session with real logged sets, so history has something in it. */
function loggedDraft(startedAt: string): DraftSession {
  const session = buildDraftSession({
    routine: seedRoutine,
    exercisesById,
    historyByExerciseId: fixtureHistoryByExerciseId,
    policy: seedUser.overloadPolicy,
    unitSystem: 'metric',
    defaultRestSeconds: 120,
    defaultTransitionRestSeconds: 150,
    startedAt,
    now: new Date(startedAt),
  });
  const [first, ...rest] = session.entries;
  return {
    ...session,
    entries: [
      { ...first, sets: first.sets.map((s) => ({ ...s, isCompleted: true, isPrefilled: false })) },
      ...rest,
    ],
  };
}

beforeEach(() => {
  useLibrary.getState().restoreSeedLibrary();
  useWorkoutHistory.getState().clearHistory();
  useSettings.getState().resetToDefaults();
});

/* ------------------------------------------------------------------ */

describe('the round trip', () => {
  it('exports what is on the phone and restores it byte for byte', () => {
    useWorkoutHistory.getState().saveSession(loggedDraft('2026-08-17T17:00:00.000Z'));
    useSettings.getState().setNumber('restSecondsBetweenSets', 75);
    const created = useLibrary.getState().createRoutine('Neck day');

    const text = exportBackupText();
    const before = currentSnapshot();

    // Wipe the phone as thoroughly as the app can from inside itself.
    useLibrary.getState().importLibrary({ exercises: [], routines: [] });
    useWorkoutHistory.getState().clearHistory();
    useSettings.getState().resetToDefaults();
    expect(useLibrary.getState().exercises).toEqual([]);

    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const applied = applyBackup(parsed.envelope);

    expect(currentSnapshot()).toEqual(before);
    expect(applied.workouts).toBe(1);
    expect(applied.exercises).toBe(seedExercises.length);
    expect(useLibrary.getState().routines.some((r) => r.id === created.id)).toBe(true);
    // Settings ride along: the rest lengths are what every timer in the app reads.
    expect(useSettings.getState().restSecondsBetweenSets).toBe(75);
    expect(applied.settingsApplied).toBe(true);
  });

  it('carries the raw set rows, not just the summary lines', () => {
    useWorkoutHistory.getState().saveSession(loggedDraft('2026-08-17T17:00:00.000Z'));
    const parsed = parseBackup(exportBackupText());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    useWorkoutHistory.getState().clearHistory();
    applyBackup(parsed.envelope);

    // These rows are what every prefill and every overload verdict reads. A
    // backup that kept only the pretty summary would restore a history that looks
    // right and teaches the app nothing.
    const [workout] = useWorkoutHistory.getState().workouts;
    expect(workout.sets.length).toBeGreaterThan(0);
    expect(workout.sets[0].exerciseId).toBeTruthy();
    expect(workout.sets[0].countUnit).toBeTruthy();
  });

  /**
   * A ladder is two numbers on a library row, and losing them costs more than it
   * looks: `max` is a tested maximum and `earned` is how many sessions of progress
   * stand behind it. Neither can be recomputed from the log — a session that met
   * its target looks exactly like one that beat a different target.
   */
  it('carries a rep ladder, max and earned reps both', () => {
    const [first] = useLibrary.getState().exercises;
    useLibrary.getState().updateExercise(first.id, {
      ...first,
      countUnit: 'reps',
      ladder: { max: 16, earned: 2 },
    });

    const parsed = parseBackup(exportBackupText());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    useLibrary.getState().importLibrary({ exercises: [], routines: [] });
    applyBackup(parsed.envelope);

    const restored = useLibrary.getState().exercises.find((e) => e.id === first.id);
    expect(restored?.ladder).toEqual({ max: 16, earned: 2 });
  });

  it('never writes the store actions into the file', () => {
    const file = JSON.parse(exportBackupText()) as { settings: Record<string, unknown> };

    // `settings` is sanitized rather than spread: the live store carries its
    // actions alongside its values, and functions do not survive JSON.
    //
    // Asserted as a SUBSET rather than an exact key match, because one setting is
    // legitimately absent from the file: `bodyweightKg` is `undefined` until the
    // user types one, and `JSON.stringify` drops an undefined value. What must
    // hold is that nothing in the file is a key `Settings` does not declare — an
    // action leaking through would be exactly that.
    const declared = new Set(Object.keys(DEFAULT_SETTINGS));
    for (const key of Object.keys(file.settings)) expect(declared.has(key)).toBe(true);
    expect(Object.keys(file.settings).length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */

describe('importing is validated, not trusted', () => {
  it('drops malformed rows and reports what actually landed', () => {
    const applied = applyBackup({
      settings: null,
      exercises: [
        // The one good row.
        {
          id: 'ex_ok',
          name: 'Neck curl',
          muscleGroups: ['neck'],
          requiresWeight: true,
          countUnit: 'reps',
          loadMode: 'external',
          isUnilateral: false,
          isArchived: false,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        { id: 'ex_bad' }, // no shape at all
        'not even an object',
      ],
      routines: [{ id: 'r_bad' }],
      workouts: [{ id: 'w_bad' }],
    });

    expect(applied.exercises).toBe(1);
    expect(applied.routines).toBe(0);
    expect(applied.workouts).toBe(0);
    expect(applied.settingsApplied).toBe(false);
    expect(useLibrary.getState().exercises.map((e) => e.id)).toEqual(['ex_ok']);
  });

  it('drops routine items pointing at exercises the file did not carry', () => {
    applyBackup({
      settings: null,
      exercises: [],
      routines: [
        {
          id: 'r_1',
          name: 'Pull',
          items: [{ id: 'ri_1', exerciseId: 'ex_missing', order: 0, targetSets: 4 }],
        },
      ],
      workouts: [],
    });

    // A routine holding an unresolvable id plans fewer sets than it says it does.
    expect(useLibrary.getState().routines[0].items).toEqual([]);
  });

  it('replaces rather than merges — a restore is not a union', () => {
    const kept = useLibrary.getState().createRoutine('Made after the backup');
    applyBackup({ settings: null, exercises: [], routines: [], workouts: [] });

    expect(useLibrary.getState().routines.some((r) => r.id === kept.id)).toBe(false);
    expect(useLibrary.getState().routines).toEqual([]);
  });

  it('leaves settings alone when the file has none', () => {
    useSettings.getState().setNumber('restSecondsBetweenSets', 45);
    applyBackup({ settings: null, exercises: [], routines: [], workouts: [] });

    expect(useSettings.getState().restSecondsBetweenSets).toBe(45);
  });

  it('clamps a settings block that would otherwise reach a timer as NaN', () => {
    applyBackup({
      settings: { restSecondsBetweenSets: 'nonsense', beepSeconds: 9999 },
      exercises: [],
      routines: [],
      workouts: [],
    });

    expect(useSettings.getState().restSecondsBetweenSets).toBe(
      DEFAULT_SETTINGS.restSecondsBetweenSets,
    );
    expect(useSettings.getState().beepSeconds).toBe(30); // the setting's ceiling
  });
});

describe('the training sequence rides along', () => {
  it('is exported and restored with the routines it points at', () => {
    const routine = useLibrary.getState().routines[0];
    useLibrary.getState().addSequenceStep(routine.id);
    useLibrary.getState().setSequenceActive(true);

    const text = exportBackupText(new Date('2026-08-19T09:00:00.000Z'));

    // Wreck it, then restore.
    useLibrary.getState().restoreSeedLibrary();
    expect(useLibrary.getState().sequence.routineIds).toEqual([]);

    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    applyBackup(parsed.envelope);

    expect(useLibrary.getState().sequence).toEqual({
      isActive: true,
      routineIds: [routine.id],
      cursor: 0,
    });
  });

  it('restores as off from a file written before sequences existed', () => {
    useLibrary.getState().addSequenceStep(useLibrary.getState().routines[0].id);
    useLibrary.getState().setSequenceActive(true);

    // A restore is "make this phone look like that backup", so a file with no
    // sequence in it must not leave the local one standing.
    applyBackup({
      settings: null,
      exercises: useLibrary.getState().exercises,
      routines: useLibrary.getState().routines,
      workouts: [],
    });

    expect(useLibrary.getState().sequence).toEqual({
      isActive: false,
      routineIds: [],
      cursor: 0,
    });
  });
});

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */

describe('the pinned workout number rides along', () => {
  it('is exported and restored', () => {
    useWorkoutHistory.getState().saveSession(loggedDraft('2026-08-17T17:00:00.000Z'));
    const workout = useWorkoutHistory.getState().workouts[0];
    useWorkoutHistory.getState().setWorkoutNumber(workout.id, 91);

    const text = exportBackupText(new Date('2026-08-19T09:00:00.000Z'));
    useWorkoutHistory.getState().clearHistory();
    expect(useWorkoutHistory.getState().numbering).toBeNull();

    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    applyBackup(parsed.envelope);

    // The one fact in the app that cannot be recomputed from the sessions.
    expect(useWorkoutHistory.getState().numbering).toEqual({ workoutId: workout.id, number: 91 });
  });
});

/* ------------------------------------------------------------------ */

/**
 * THE PATH THAT TURNS A FAILED READ INTO A REAL LOSS.
 *
 * Exporting is what a careful person does first when the app looks wrong. If the
 * log could not be read, the snapshot's `workouts` is empty for a reason that has
 * nothing to do with what is on disk — and a file with `"workouts": []` in it is
 * one `Replace everything from a file` away from making the loss permanent and
 * unrecoverable.
 */
describe('a backup is refused when the log could not be read', () => {
  it('throws instead of writing a file with the log missing', () => {
    useWorkoutHistory.getState().saveSession(loggedDraft('2026-08-17T17:00:00.000Z'));
    // The state a failed read leaves: nothing in memory, everything on disk.
    useWorkoutHistory.setState({ workouts: [], loadFailed: true });

    expect(() => exportBackupText()).toThrow(UnreadableLogError);
  });

  it('exports normally once the log has been read', () => {
    useWorkoutHistory.getState().saveSession(loggedDraft('2026-08-17T17:00:00.000Z'));
    useWorkoutHistory.setState({ loadFailed: false });

    const parsed = parseBackup(exportBackupText());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.counts.workouts).toBe(1);
  });

  it('still exports an empty log that is genuinely empty', () => {
    // A fresh install has nothing to back up and that is not an error: the file is
    // valid, it just has no workouts in it.
    useWorkoutHistory.getState().clearHistory();
    useWorkoutHistory.setState({ loadFailed: false });

    expect(() => exportBackupText()).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */

describe('the CSV export reads the stores', () => {
  it('workouts: one row per logged set, refused on an unreadable log', () => {
    useWorkoutHistory.getState().saveSession(loggedDraft('2026-08-17T17:00:00.000Z'));
    useWorkoutHistory.setState({ loadFailed: false });
    const sets = useWorkoutHistory.getState().workouts[0].sets.length;
    const lines = exportCsvText()
      .split('\r\n')
      .filter((l) => l !== '');
    expect(lines).toHaveLength(1 + sets);

    useWorkoutHistory.setState({ workouts: [], loadFailed: true });
    expect(() => exportCsvText()).toThrow(UnreadableLogError);
    useWorkoutHistory.setState({ loadFailed: false });
  });

});

/* ------------------------------------------------------------------ */

describe('what the assistant leaves out of a backup', () => {
  /*
   * Chats DO travel now — a restored phone should open on the conversations it
   * had, past chats included. What must never travel is the key, the model
   * choice or the connection state: a restored phone tests its own key.
   */
  it('carries the chats and past chats, and nothing that looks like a key', () => {
    const marker = 'CHAT-MARKER-7f3kQ2';
    const past = 'PAST-CHAT-MARKER-9x';
    useAi.setState(sanitizeAi({}));
    useAi.getState().appendMessage('Workout', {
      id: 'p1',
      role: 'user',
      text: past,
      at: '2026-09-26T18:00:00.000Z',
    });
    useAi.getState().clearChat('Workout');
    useAi.getState().appendMessage('Workout', {
      id: 'm1',
      role: 'user',
      text: marker,
      at: '2026-09-27T18:00:00.000Z',
    });
    useAi.getState().markReady(800);

    const text = exportBackupText();
    expect(text).toContain(marker);
    expect(text).toContain(past);
    expect(text).not.toContain('AIza');
    expect(text).not.toContain('gemini');
    expect(text).not.toContain('"status": "ready"');
    expect(Object.keys(useAi.getState())).not.toContain('key');
    expect(Object.keys(useAi.getState())).not.toContain('apiKey');

    // Restored onto a phone with nothing: the open chat and the past one back.
    useAi.setState(sanitizeAi({}));
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.counts.chats).toBe(2);
    const applied = applyBackup(parsed.envelope);
    expect(applied.chats).toBe(2);
    expect(useAi.getState().chats.Workout.map((m) => m.id)).toEqual(['m1']);
    expect(useAi.getState().archive.Workout[0].title).toBe(past);
    // The connection is the phone's own, not the file's.
    expect(useAi.getState().status).toBe('off');
    useAi.setState(sanitizeAi({}));
  });

  it('leaves the chats alone when restoring a file from before they travelled', () => {
    useAi.setState(sanitizeAi({}));
    useAi.getState().appendMessage('Workout', {
      id: 'keep',
      role: 'user',
      text: 'keep me',
      at: '2026-09-27T18:00:00.000Z',
    });
    const parsed = parseBackup(JSON.stringify({ exercises: [], routines: [], workouts: [] }));
    if (!parsed.ok) throw new Error(parsed.error);
    applyBackup(parsed.envelope);
    expect(useAi.getState().chats.Workout.map((m) => m.id)).toEqual(['keep']);
    useAi.setState(sanitizeAi({}));
  });
});

describe('the debriefs', () => {
  const debriefWorkout = {
    id: 'w_debrief',
    title: 'Push',
    startedAt: '2026-09-27T18:00:00.000Z',
    endedAt: '2026-09-27T19:00:00.000Z',
    durationMinutes: 60,
    setCount: 1,
    totalVolumeKg: 0,
    volumeIsPartial: false,
    exercises: [],
    sets: [],
  };

  it('travel in a backup and come back', () => {
    useDebriefs.setState({ debriefs: [], openId: null });
    useDebriefs.getState().offer(debriefWorkout, false);
    useDebriefs.getState().saveAnswers('w_debrief', { load: { choices: ['heavy'] } }, true);
    const text = exportBackupText();
    useDebriefs.setState({ debriefs: [] });
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    applyBackup(parsed.envelope);
    expect(useDebriefs.getState().debriefs).toHaveLength(1);
    expect(useDebriefs.getState().debriefs[0].answers).toEqual({ load: { choices: ['heavy'] } });
  });

  it('are left alone by a file from before they existed', () => {
    useDebriefs.setState({ debriefs: [], openId: null });
    useDebriefs.getState().offer(debriefWorkout, false);
    const parsed = parseBackup(JSON.stringify({ exercises: [], routines: [], workouts: [] }));
    if (!parsed.ok) throw new Error(parsed.error);
    applyBackup(parsed.envelope);
    expect(useDebriefs.getState().debriefs).toHaveLength(1);
  });
});

describe('the closed assistant cards', () => {
  it('travel in a backup and come back', () => {
    useSettings.getState().dismissAiCard('Workout');
    const text = exportBackupText();
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    expect(useSettings.getState().aiCardsDismissed).toBeUndefined();

    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    applyBackup(parsed.envelope);
    expect(useSettings.getState().aiCardsDismissed).toEqual(['Workout']);
  });

  it('a 2.2.0 backup, written before the key existed, imports unchanged and shows every card', () => {
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    const v220 = JSON.stringify({
      format: 'workout-tracker-backup',
      version: 1,
      settings: { restSecondsBetweenSets: 90 },
      exercises: [],
      routines: [],
      workouts: [],
    });
    const parsed = parseBackup(v220);
    if (!parsed.ok) throw new Error(parsed.error);
    applyBackup(parsed.envelope);

    expect(useSettings.getState().restSecondsBetweenSets).toBe(90);
    expect(useSettings.getState().aiCardsDismissed).toBeUndefined();
    expect(useSettings.getState().weeklyReviewDismissed).toBeUndefined();
  });

  it('the closed weekly review travels in a backup and comes back', () => {
    useSettings.getState().dismissWeeklyReview('2026-10-07');
    const text = exportBackupText();
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    expect(useSettings.getState().weeklyReviewDismissed).toBeUndefined();

    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    applyBackup(parsed.envelope);
    expect(useSettings.getState().weeklyReviewDismissed).toBe('2026-10-05');
  });
});

describe('body measurements (W9)', () => {
  it('travel in a backup and come back', () => {
    useSettings.getState().recordMeasurement('waist', '2026-10-05', 82.5);
    useSettings.getState().recordMeasurement('arm', '2026-09-01', 36.83);
    const text = exportBackupText();
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    expect(useSettings.getState().bodyMeasurements).toBeUndefined();

    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    applyBackup(parsed.envelope);
    expect(useSettings.getState().bodyMeasurements).toEqual({
      waist: [{ day: '2026-10-05', cm: 82.5 }],
      arm: [{ day: '2026-09-01', cm: 36.83 }],
    });
  });

  it('a 2.2.0 backup, written before the key existed, imports unchanged with none', () => {
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    const v220 = JSON.stringify({
      format: 'workout-tracker-backup',
      version: 1,
      settings: {
        restSecondsBetweenSets: 90,
        bodyweightKg: 80,
        bodyweightLog: [{ at: '2026-08-30T08:00:00.000Z', kg: 80 }],
      },
      exercises: [],
      routines: [],
      workouts: [],
    });
    const parsed = parseBackup(v220);
    if (!parsed.ok) throw new Error(parsed.error);
    applyBackup(parsed.envelope);

    expect(useSettings.getState().restSecondsBetweenSets).toBe(90);
    expect(useSettings.getState().bodyweightKg).toBe(80);
    expect(useSettings.getState().bodyweightLog).toEqual([
      { at: '2026-08-30T08:00:00.000Z', kg: 80 },
    ]);
    expect(useSettings.getState().bodyMeasurements).toBeUndefined();
  });
});

describe('the engagement switch (Wave 3)', () => {
  it('travels in a backup and comes back on', () => {
    useSettings.getState().setEngagement(true);
    const text = exportBackupText();
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    expect(useSettings.getState().engagement).toBeUndefined();
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    applyBackup(parsed.envelope);
    expect(useSettings.getState().engagement).toBe(true);
  });

  it('a 2.2.0 backup, written before the key existed, imports unchanged and off', () => {
    useSettings.getState().setEngagement(true);
    const v220 = JSON.stringify({
      format: 'workout-tracker-backup',
      version: 1,
      settings: { restSecondsBetweenSets: 90, bodyweightKg: 80 },
      exercises: [],
      routines: [],
      workouts: [],
    });
    const parsed = parseBackup(v220);
    if (!parsed.ok) throw new Error(parsed.error);
    applyBackup(parsed.envelope);
    expect(useSettings.getState().restSecondsBetweenSets).toBe(90);
    expect(useSettings.getState().bodyweightKg).toBe(80);
    expect(useSettings.getState().engagement).toBeUndefined();
  });
});

describe('the milestone stamp (E4)', () => {
  it('travels in a backup, and a 2.2.0 backup has none', () => {
    useSettings.getState().recordMilestone(250);
    const text = exportBackupText();
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    expect(useSettings.getState().milestoneShown).toBeUndefined();
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    applyBackup(parsed.envelope);
    expect(useSettings.getState().milestoneShown).toBe(250);

    const v220 = JSON.stringify({
      format: 'workout-tracker-backup',
      version: 1,
      settings: { restSecondsBetweenSets: 90 },
      exercises: [],
      routines: [],
      workouts: [],
    });
    const old = parseBackup(v220);
    if (!old.ok) throw new Error(old.error);
    applyBackup(old.envelope);
    expect(useSettings.getState().restSecondsBetweenSets).toBe(90);
    expect(useSettings.getState().milestoneShown).toBeUndefined();
  });
});

describe('the weekly training goal (W8)', () => {
  it('the goal and the excused weeks travel in a backup and come back', () => {
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    useSettings.getState().stepWeeklyWorkoutGoal(1);
    useSettings.getState().setWeekExcused('2026-10-08', true, '2026-10-08');
    const text = exportBackupText();
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    expect(useSettings.getState().weeklyWorkoutGoal).toBeUndefined();
    expect(useSettings.getState().excusedWeeks).toBeUndefined();

    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    applyBackup(parsed.envelope);
    expect(useSettings.getState().weeklyWorkoutGoal).toBe(4);
    expect(useSettings.getState().excusedWeeks).toEqual(['2026-10-05']);
  });

  it('a 2.2.0 backup, written before the keys existed, imports unchanged with none', () => {
    useSettings.getState().importSettings(DEFAULT_SETTINGS);
    const v220 = JSON.stringify({
      format: 'workout-tracker-backup',
      version: 1,
      settings: { restSecondsBetweenSets: 90, bodyweightKg: 80 },
      exercises: [],
      routines: [],
      workouts: [],
    });
    const parsed = parseBackup(v220);
    if (!parsed.ok) throw new Error(parsed.error);
    applyBackup(parsed.envelope);

    expect(useSettings.getState().restSecondsBetweenSets).toBe(90);
    expect(useSettings.getState().bodyweightKg).toBe(80);
    expect(useSettings.getState().weeklyWorkoutGoal).toBeUndefined();
    expect(useSettings.getState().excusedWeeks).toBeUndefined();
  });
});

/*
 * THE WEEKLY BACKUP'S KEYS. Every file a 2.5.x phone wrote carries
 * `autoBackupIntervalDays` and `autoBackupUris` in its settings. The interval is
 * gone and the rotation list is replaced by the day's file, and neither may stop
 * that file restoring ("Never break import of an old backup").
 */
describe('a backup from the weekly auto-backup era', () => {
  const v25 = (settings: Record<string, unknown>) =>
    JSON.stringify({
      format: 'workout-tracker-backup',
      version: 2,
      settings,
      exercises: [],
      routines: [],
      workouts: [],
    });

  it('imports, keeps its real settings and drops the retired keys', () => {
    const parsed = parseBackup(
      v25({
        restSecondsBetweenSets: 105,
        autoBackupEnabled: false,
        autoBackupFolderUri: 'content://tree/other-phone',
        autoBackupIntervalDays: 14,
        autoBackupUris: ['content://tree/other-phone/workout-tracker-auto-2026-09-01.json'],
        lastBackupAt: '2026-09-01T10:00:00.000Z',
      }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const applied = applyBackup(parsed.envelope);

    expect(applied.settingsApplied).toBe(true);
    expect(useSettings.getState().restSecondsBetweenSets).toBe(105);
    const state = useSettings.getState() as unknown as Record<string, unknown>;
    expect(state.autoBackupIntervalDays).toBeUndefined();
    expect(state.autoBackupUris).toBeUndefined();
  });

  it('keeps THIS phone’s folder, day file and switch, not the file’s', () => {
    useSettings.getState().setAutoBackupFolder('content://tree/this-phone');
    const file = {
      uri: 'content://tree/this-phone/momentum-backup-2026-10-15.json',
      day: '2026-10-15',
    };
    useSettings.getState().recordBackup('2026-10-15T10:00:00.000Z', file);

    const parsed = parseBackup(
      v25({
        autoBackupEnabled: false,
        autoBackupFolderUri: 'content://tree/other-phone',
        autoBackupIntervalDays: 3,
        autoBackupFile: { uri: 'content://tree/other-phone/x.json', day: '2026-01-01' },
      }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    applyBackup(parsed.envelope);

    expect(useSettings.getState().autoBackupFolderUri).toBe('content://tree/this-phone');
    expect(useSettings.getState().autoBackupFile).toEqual(file);
    expect(useSettings.getState().autoBackupEnabled).toBe(DEFAULT_SETTINGS.autoBackupEnabled);
  });

  it('writes no retired key into a new backup', () => {
    const text = exportBackupText();
    expect(text).not.toContain('autoBackupIntervalDays');
    expect(text).not.toContain('autoBackupUris');
  });
});

/*
 * THE FILES THIS APP MUST STILL OPEN, AND THE FILE IT MUST STILL WRITE. The phone
 * has Momentum 2.x combined backups and 3.0.0 Workout backups on it, and a
 * 3.0.0 Workout app may be handed what this one exports. Each shape is spelled
 * out here as the JSON those builds wrote, not built through today's code.
 */
describe('backups from Momentum 2.x and 3.0.0', () => {
  const workoutRow = {
    id: 'w_old',
    title: 'Push',
    startedAt: '2026-09-01T17:00:00.000Z',
    endedAt: '2026-09-01T18:00:00.000Z',
    durationMinutes: 60,
    setCount: 0,
    totalVolumeKg: 0,
    volumeIsPartial: false,
    exercises: [],
    sets: [],
  };

  it('a combined 2.x file restores its training and leaves the tasks and money unread', () => {
    useAi.setState(sanitizeAi({}));
    const combined = JSON.stringify({
      format: 'workout-tracker-backup',
      version: 2,
      settings: { restSecondsBetweenSets: 100, currencyCode: 'EUR', autoTickTasks: false },
      exercises: seedExercises.slice(0, 2),
      routines: [],
      workouts: [workoutRow],
      tasks: { tasks: [{ id: 't1', name: 'Read' }], log: {} },
      money: { accounts: [], categories: [], amounts: [{ id: 'a1' }] },
      aiChats: {
        chats: {
          Workout: [{ id: 'mw', role: 'user', text: 'bench?', at: '2026-09-01' }],
          Tasks: [{ id: 'mt', role: 'user', text: 'tasks?', at: '2026-09-01' }],
          Expenses: [{ id: 'me', role: 'user', text: 'money?', at: '2026-09-01' }],
        },
        archive: { Workout: [], Tasks: [], Expenses: [] },
        proposals: {},
      },
    });
    const parsed = parseBackup(combined);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.counts).toEqual({ exercises: 2, routines: 0, workouts: 1, sets: 0, chats: 1 });
    expect(parsed.envelope).not.toHaveProperty('tasks');
    expect(parsed.envelope).not.toHaveProperty('money');

    applyBackup(parsed.envelope);
    expect(useWorkoutHistory.getState().workouts.map((w) => w.id)).toEqual(['w_old']);
    expect(useSettings.getState().restSecondsBetweenSets).toBe(100);
    expect(useAi.getState().chats.Workout.map((m) => m.id)).toEqual(['mw']);
    expect(Object.keys(useAi.getState().chats)).toEqual(['Workout']);
    // Nothing from the other logs rides back out in this app's own file.
    const text = exportBackupText();
    expect(text).not.toContain('tasks?');
    expect(text).not.toContain('money?');
    useAi.setState(sanitizeAi({}));
  });

  it('a 3.0.0 Workout file restores whole', () => {
    const v300 = JSON.stringify({
      format: 'workout-tracker-backup',
      version: 2,
      exportedAt: '2026-11-04T10:00:00.000Z',
      counts: { exercises: 1, routines: 0, workouts: 1, sets: 0 },
      settings: { restSecondsBetweenSets: 80 },
      exercises: seedExercises.slice(0, 1),
      routines: [],
      workouts: [workoutRow],
      sequence: { isActive: false, routineIds: [], cursor: 0 },
      numbering: null,
      debriefs: [],
    });
    const parsed = parseBackup(v300);
    if (!parsed.ok) throw new Error(parsed.error);
    const applied = applyBackup(parsed.envelope);
    expect(applied).toMatchObject({ settingsApplied: true, exercises: 1, workouts: 1 });
    expect(useSettings.getState().restSecondsBetweenSets).toBe(80);
  });

  it('a 3.0.0 Tasks or Expenses file is refused in words, before anything is applied', () => {
    useSettings.getState().setNumber('restSecondsBetweenSets', 70);
    for (const other of [
      { tasks: { tasks: [], log: {} } },
      { money: { accounts: [], categories: [], amounts: [] } },
    ]) {
      const parsed = parseBackup(
        JSON.stringify({
          format: 'workout-tracker-backup',
          version: 2,
          settings: { restSecondsBetweenSets: 200 },
          ...other,
        }),
      );
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.error).toMatch(/no exercises, routines or workouts/);
    }
    expect(useSettings.getState().restSecondsBetweenSets).toBe(70);
  });

  it('writes the version-2 envelope a 3.0.0 Workout app reads: the training, no other log', () => {
    useWorkoutHistory.getState().saveSession(loggedDraft('2026-08-17T17:00:00.000Z'));
    const file = JSON.parse(exportBackupText()) as Record<string, unknown>;
    expect(file.format).toBe('workout-tracker-backup');
    expect(file.version).toBe(2);
    for (const key of ['settings', 'exercises', 'routines', 'workouts', 'sequence', 'numbering']) {
      expect(file).toHaveProperty(key);
    }
    expect(Array.isArray(file.exercises)).toBe(true);
    expect(Array.isArray(file.workouts)).toBe(true);
    expect(file).not.toHaveProperty('tasks');
    expect(file).not.toHaveProperty('money');
    const chats = file.aiChats as { chats: Record<string, unknown> };
    expect(Object.keys(chats.chats)).toEqual(['Workout']);
  });
});
