/**
 * The two directions a backup moves, and the only place every store is read and
 * written together.
 *
 *   stores ──currentSnapshot──► payload ──serializeBackup──► the file
 *   the file ──parseBackup──► envelope ──applyBackup──► stores
 *
 * It lives in `state/` rather than in `lib/` because it touches every store, and
 * outside React on purpose: an export is triggered by a button and a restore
 * replaces the state the buttons are rendered from, so neither belongs to a
 * component's lifecycle. `lib/backup.ts` stays pure and knows nothing about zustand.
 *
 * WHAT IS NOT IN A BACKUP: the workout in progress. It is persisted (that is what
 * makes a mid-set crash cost nothing), but it is a live thing with a running clock
 * and a rest deadline in epoch milliseconds — restoring one onto another phone,
 * hours later, would drop the user into a session with a two-hour rest timer and a
 * plank that "ended" while the file was on an SD card. Finish the workout, then back
 * up; the screen says so.
 *
 * ORDER MATTERS ON THE WAY IN. Settings first (they are what every duration is read
 * from), then the library, then the log — so that if anything throws, what is left
 * on the phone is a prefix of a valid restore rather than a log referring to
 * exercises that were never written.
 *
 * ── ONE WAY OUT AND ONE WAY IN ─────────────────────────────────────────────
 *
 * An export carries the training, the training chat and the settings, and
 * `applyBackup` REPLACES exactly those with what the file says. A combined 2.x
 * file also carries daily tasks and money, and an older file this app's own
 * post-workout debriefs; those keys are left unread (`lib/backup.ts`), and the
 * Tasks and Expenses apps that were split out at 3.0.0 restore the first two
 * from the same file. That is what a restore is, and it
 * is the only one there is.
 *
 * There used to be four more: a merge that added only the workouts this phone did
 * not have, a CSV reader for training that predated the app, a CSV export, and a
 * per-section export and import for each log the app used to hold. Eight rows, seven of which were
 * answering a question nobody was asking twice — and eight rows of export and
 * import are worse than two, because the one that matters (the whole phone, out
 * to a file you can read) stops being obvious among them. One file holds
 * everything; putting it back puts everything back.
 */

import {
  countPayload,
  serializeBackup,
  type BackupCounts,
  type BackupPayload,
} from '../lib/backup';
import { t } from '../lib/i18n';
import { chatsForBackup, useAi } from './aiStore';
import { useLibrary } from './libraryStore';
import { sanitizeSettings, useSettings } from './settingsStore';
import { useWorkoutHistory } from './workoutHistoryStore';

/** What the backup carries, straight out of the stores. */
export function currentSnapshot(): BackupPayload {
  const library = useLibrary.getState();
  return {
    // Sanitized rather than spread: the live store carries its action functions
    // alongside its values, and a JSON file with `setNumber: undefined` in it is a
    // file that says something untrue about the format.
    settings: sanitizeSettings(useSettings.getState()),
    exercises: library.exercises,
    routines: library.routines,
    sequence: library.sequence,
    workouts: useWorkoutHistory.getState().workouts,
    numbering: useWorkoutHistory.getState().numbering,
    aiChats: chatsForBackup(useAi.getState()),
  };
}

/**
 * What a restore would replace, counted the way a file is — the confirmation
 * sheet's "this phone has…".
 */
export function restorableCounts(): BackupCounts {
  return countPayload(currentSnapshot());
}

/**
 * Thrown by `exportBackupText` rather than writing a backup that is missing the
 * log. Carried as a class so the screen can tell it from a file-system error and
 * say something true about it.
 */
export class UnreadableLogError extends Error {
  constructor() {
    /*
     * Reaches the user verbatim through `describeError`, so it is written as the
     * sentence they need: what happened, that nothing is lost, and the one thing
     * that fixes it.
     */
    super(
      t(
        'The log could not be read, so a backup would be missing it. Nothing is lost — close the app and open it again.',
        useSettings.getState().language,
      ),
    );
    this.name = 'UnreadableLogError';
  }
}

/**
 * The file's text, ready to write or share.
 *
 * ── IT REFUSES TO WRITE A BACKUP WITH THE LOG MISSING ──────────────────────
 *
 * `currentSnapshot` reads the stores, and the history store's array is empty in two
 * very different situations: nothing has been logged, and the log could not be READ
 * (see `workoutHistoryStore.loadFailed`). Exporting is what a careful person does
 * FIRST when the app looks wrong, and in the second case that would hand them a
 * file with `"workouts": []` in it — which `Replace everything from a file` will
 * then faithfully restore over a database that was fine.
 *
 * That is the one path in this app that can turn a failed read into permanent loss,
 * so it is closed here rather than warned about: a backup nobody can trust is worse
 * than no backup, because the whole point of one is being trusted later.
 */
export function exportBackupText(now?: Date): string {
  if (useWorkoutHistory.getState().loadFailed) throw new UnreadableLogError();
  return serializeBackup(currentSnapshot(), now);
}

/** What a restore actually put on the phone — validated rows, not claimed ones. */
export interface AppliedCounts extends BackupCounts {
  settingsApplied: boolean;
}

/**
 * Write a parsed backup into the stores, replacing the training, the training
 * chat and the settings, and nothing else.
 *
 * Returns what survived each store's own validation. The counts a file states in its
 * envelope are what the exporting phone had; these are what this phone now has, and
 * when the two differ the screen reports THESE — a restore that quietly drops eleven
 * malformed workouts and says "42 restored" is how a user learns not to trust the
 * feature.
 */
export function applyBackup(payload: BackupPayload): AppliedCounts {
  /*
   * THE LOG FIRST. It is the one step that can realistically throw (a SQLite
   * write), and it is transactional — so a failure here leaves the phone exactly
   * as it was. Last, it used to throw after the file's settings and library had
   * already replaced this phone's, leaving a mix of the two.
   */
  const workouts = useWorkoutHistory.getState().importWorkouts(payload.workouts, payload.numbering);

  /*
   * Only a settings object WITH something in it counts: `importSettings({})` is a
   * reset to defaults, and a file that says nothing about the settings — no
   * block, an empty one, or something that is not an object at all — must not
   * clobber them with nothing.
   */
  const fromFile =
    typeof payload.settings === 'object' &&
    payload.settings !== null &&
    !Array.isArray(payload.settings)
      ? (payload.settings as Record<string, unknown>)
      : {};
  const settingsApplied = Object.keys(fromFile).length > 0;
  if (settingsApplied) {
    /*
     * The file's settings, except what belongs to THIS PHONE: the backup folder
     * is a grant this phone holds (another phone's URI is a folder it has no
     * permission for, and every auto-backup after the restore failed), and the
     * day's file and last-backup time describe this phone's own files.
     */
    const here = useSettings.getState();
    const local = {
      autoBackupEnabled: here.autoBackupEnabled,
      autoBackupFolderUri: here.autoBackupFolderUri,
      autoBackupFile: here.autoBackupFile,
      lastBackupAt: here.lastBackupAt,
    };
    useSettings.getState().importSettings({ ...fromFile, ...local });
  }

  const library = useLibrary.getState().importLibrary({
    exercises: payload.exercises,
    routines: payload.routines,
    sequence: payload.sequence,
  });
  let sets = 0;
  for (const workout of useWorkoutHistory.getState().workouts) sets += workout.sets.length;
  const applied: AppliedCounts = {
    settingsApplied,
    exercises: library.exercises,
    routines: library.routines,
    workouts,
    sets,
  };

  // The training chat from the file (`lib/backup.workoutChats` cut it to that).
  if (payload.aiChats != null) {
    applied.chats = useAi.getState().importChats(payload.aiChats);
  }

  return applied;
}
