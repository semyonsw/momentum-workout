/**
 * The backup file: what goes in it, and what it takes to trust one coming back.
 *
 *   {
 *     "format": "workout-tracker-backup",
 *     "version": 2,
 *     "exportedAt": "2026-08-19T09:12:44.001Z",
 *     "counts": { "exercises": 88, "routines": 6, "workouts": 42, "sets": 512 },
 *     "settings": { ... },
 *     "exercises": [ ... ],
 *     "routines":  [ ... ],
 *     "workouts":  [ ... ],
 *     "sequence":  { "isActive": false, "routineIds": [], "cursor": 0 },
 *     "numbering": { "workoutId": "d_session_x", "number": 91 },
 *     "aiChats":   { "chats": { "Workout": [ ... ] }, "archive": { ... }, ... }
 *   }
 *
 * A FILE FROM MOMENTUM 2.x OR ANY 3.0.0 APP OPENS HERE. Until 3.0.0 this app was
 * Momentum, and its file carried three logs — the training, daily tasks and
 * money (`tasks`, `money` at the top level). The tasks and the money are other
 * apps now; this one reads the training, its own AI chats and the settings out
 * of any version-2 envelope, and leaves every other key unread — including the
 * `debriefs` an earlier Workout wrote, whose post-workout questions are gone. A
 * file with no training in it — a Tasks or Expenses backup — is refused in words
 * rather than "restored" as zero rows. What it writes is the same envelope with
 * the training and nothing else — a file a 3.0.0 Workout app reads as its own,
 * and a 2.x build restores as a version-1-style training backup.
 *
 * WHY THIS EXISTS. Everything the user owns lives in a handful of AsyncStorage keys on one
 * phone. An uninstall, a wiped device, a new phone, or a debug build installed over
 * a release one takes all of it — and the app's whole value is a log that goes back
 * far enough to show a plateau. A backup is the only thing standing between a year
 * of training and a factory reset.
 *
 * ── THREE RULES ─────────────────────────────────────────────────────────────
 *
 *  1. THE FILE IS THE FORMAT, AND IT IS READABLE. Pretty-printed JSON with the same
 *     field names the app's own types use. Not because a human should have to edit
 *     it, but because a backup you cannot read is a backup you cannot check, and
 *     one you cannot check is a promise rather than a file. It also means a broken
 *     import can be diagnosed by opening the file, and that anything else — a
 *     script, a spreadsheet, a future version of this app — can read the log out.
 *
 *  2. EXPORT WRITES THE ROWS AS THEY ARE STORED. No reshaping, no summarising, no
 *     dropping of fields that "look derived". `CompletedWorkout` carries both its
 *     rendered summary lines and the raw `SetHistory` rows, and the second of those
 *     is what every prefill and every record reads — a backup that kept
 *     only the pretty version would restore a history that looks right and teaches
 *     the app nothing.
 *
 *  3. IMPORT TRUSTS NOTHING. This module only opens the ENVELOPE — is it JSON, is it
 *     ours, is it from a version we understand — and hands the collections on
 *     as `unknown`. Every row inside is validated by the store that owns it, by the
 *     same guards that already run on every rehydration from disk (`libraryStore`,
 *     `workoutHistoryStore`, `settingsStore`). There is exactly one validator per
 *     shape in this app, and a file off a user's SD card is not the place to add a
 *     second one that can disagree with it.
 */

import { plural, t, type Language, type PluralForms } from './i18n';

/**
 * The `format` field. A file without it is not ours; a file with it might be.
 * Still `workout-tracker-backup`: it names the FORMAT, and a second name would be
 * a file the 2.x and 3.0.0 builds refuse.
 */
export const BACKUP_FORMAT = 'workout-tracker-backup';

/**
 * The envelope version, NOT the app version.
 *
 * Bumped only when the shape around the collections changes. A file from a FUTURE
 * version is refused rather than half-read: the one thing worse than not restoring
 * a backup is restoring three quarters of it and reporting success.
 *
 * 2 — the daily tasks and the money joined the file. Both are OPTIONAL on the way
 * in, so every version-1 file still restores; what it restores is a phone with its
 * training replaced and its tasks and amounts left exactly where they were, which
 * is the honest reading of a file that never carried them.
 *
 * NOT bumped when the tasks and the money left for apps of their own (3.0.0):
 * this app's file is a version-2 envelope with those two keys ABSENT, which every
 * reader already handled as "leave them alone".
 */
export const BACKUP_VERSION = 2;

/** Human-readable row counts. Written for the reader; never trusted on the way in. */
export interface BackupCounts {
  exercises: number;
  routines: number;
  workouts: number;
  sets: number;
  /** AI conversations (open + past), when the file carries them. */
  chats?: number;
}

/**
 * What export writes. The three collections are typed loosely on purpose — see
 * rule 3: this module's job is the envelope, and the stores own the rows.
 */
export interface BackupPayload {
  settings: unknown;
  exercises: unknown[];
  routines: unknown[];
  workouts: unknown[];
  /**
   * The training sequence, if this phone has one. Optional because it arrived
   * after the format did: a file written by an older build simply has no sequence,
   * which restores as "off and empty" — the same thing a fresh install has.
   */
  sequence?: unknown;
  /**
   * The pinned workout number ("this session was number 91"), if one is set. Also
   * optional, for the same reason — and worth carrying, because it is the one
   * fact in the app that cannot be recomputed from the sessions themselves.
   */
  numbering?: unknown;
  /**
   * The AI conversations: `{ chats, archive, proposals }`, with only the
   * `Workout` chat in each group (`workoutChats`). Optional and
   * absent-means-absent; never the key, which lives in the keystore.
   */
  aiChats?: unknown;
}

export interface BackupEnvelope extends BackupPayload {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  counts: BackupCounts;
}

export type ParseResult =
  | { ok: true; envelope: BackupEnvelope; counts: BackupCounts }
  /** `error` is shown to the user verbatim, so it is written as a sentence. */
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The assistant's blob with only the training chat in it.
 *
 * A 2.x file holds a chat per section — `Workout`, `Tasks`, `Expenses` — under
 * `chats` and `archive`; the other two are the other apps' conversations, and
 * they are left in the file rather than restored here. Proposals are keyed by id
 * rather than by section and travel whole: they are small, a message points at
 * its proposal by id, and a proposal nothing points at is harmless where a
 * missing one is a broken card.
 */
export function workoutChats(aiChats: unknown): unknown {
  if (!isRecord(aiChats)) return aiChats;
  const pick = (group: unknown) => ({
    Workout: asArray(isRecord(group) ? group.Workout : undefined),
  });
  return { ...aiChats, chats: pick(aiChats.chats), archive: pick(aiChats.archive) };
}

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */

/** Open chats with anything in them, plus past chats — total over `unknown`. */
function countAiChats(section: unknown): number {
  if (typeof section !== 'object' || section === null) return 0;
  const { chats, archive } = section as { chats?: unknown; archive?: unknown };
  let count = 0;
  for (const group of [chats, archive]) {
    if (typeof group !== 'object' || group === null) continue;
    for (const list of Object.values(group as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      count += group === chats ? (list.length > 0 ? 1 : 0) : list.length;
    }
  }
  return count;
}

/** Count what a payload actually holds, rather than what it claims to. */
export function countPayload(payload: BackupPayload): BackupCounts {
  const workouts = asArray(payload.workouts);
  let sets = 0;
  for (const workout of workouts) {
    const rows = (workout as { sets?: unknown } | null)?.sets;
    if (Array.isArray(rows)) sets += rows.length;
  }
  const counts: BackupCounts = {
    exercises: asArray(payload.exercises).length,
    routines: asArray(payload.routines).length,
    workouts: workouts.length,
    sets,
  };
  if (payload.aiChats != null) counts.chats = countAiChats(payload.aiChats);
  return counts;
}

function buildBackupEnvelope(payload: BackupPayload, now: Date = new Date()): BackupEnvelope {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    counts: countPayload(payload),
    ...payload,
  };
}

/**
 * The file's text. Two-space indented — see rule 1.
 *
 * A year of training is a few hundred kilobytes either way, and the cost of
 * indentation is bytes on a disk that has gigabytes of them.
 */
export function serializeBackup(payload: BackupPayload, now?: Date): string {
  return `${JSON.stringify(buildBackupEnvelope(payload, now), null, 2)}\n`;
}

/*
 * The FILE NAME is not decided here any more. Exports used to be
 * `workout-tracker-backup-<day>-<minute>.json`, one per tap, with the earlier
 * ones deleted by name; now there is one backup file per day, written after
 * every change and by both buttons, and `lib/autoBackup.ts` names it
 * (`momentum-workout-backup-<day>.json`). The old files — those exports, and
 * 2.x's combined `momentum-backup-<day>.json` — are left where they are: this
 * module never deletes a file it no longer names.
 */

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Open the envelope, or say why it can't be opened.
 *
 * Refuses in four cases and repairs everything else:
 *
 *   • not JSON at all — the usual cause is a half-copied paste
 *   • from a NEWER envelope version, which may mean fields this build would drop
 *   • no recognisable collections in it, which is how a JSON file that is simply
 *     something else announces itself
 *   • no training in it: a Tasks or Expenses backup from 3.0.0. Said in words
 *     rather than "restored" as zero rows, which would read as success
 *
 * What comes back is the training, the training chat and the settings, and so
 * are its counts: the confirmation sheet states what this app
 * will restore, not what a combined 2.x file happens to hold for the other logs.
 *
 * A missing `format` on a file that does carry collections is accepted: a backup
 * hand-edited into a file with the arrays intact is still a backup, and the rows
 * themselves are validated downstream either way.
 */
export function parseBackup(text: string, lang: Language = 'en'): ParseResult {
  let raw: unknown;
  try {
    // A byte-order mark is not part of the JSON, and `JSON.parse` rejects it — so a
    // backup re-saved by Notepad, or any editor that writes UTF-8 with a BOM, read
    // as "not valid JSON" while every byte of the data was intact.
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return {
      ok: false,
      error: t('That is not valid JSON — the file or the paste is incomplete.', lang),
    };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: t('That file holds something other than a backup.', lang) };
  }

  const source = raw as Record<string, unknown>;
  const version =
    typeof source.version === 'number' && Number.isFinite(source.version) ? source.version : 1;
  if (version > BACKUP_VERSION) {
    return {
      ok: false,
      error: t(
        'That backup was written by a newer version of the app (format {version}). Update the app first.',
        lang,
        { version },
      ),
    };
  }

  const hasTraining =
    Array.isArray(source.exercises) ||
    Array.isArray(source.routines) ||
    Array.isArray(source.workouts);
  if (!hasTraining) {
    // A Tasks or Expenses file is a perfectly good backup — of another app.
    const otherLog = source.tasks != null || source.money != null;
    return {
      ok: false,
      error:
        source.format === BACKUP_FORMAT && !otherLog
          ? t('That backup is empty — there is nothing in it to restore.', lang)
          : t('That file has no exercises, routines or workouts in it.', lang),
    };
  }

  const payload: BackupPayload = {
    settings: source.settings ?? null,
    // Any one of the three arrays makes it a training backup; the others are
    // repaired to empty, as they always were.
    exercises: asArray(source.exercises),
    routines: asArray(source.routines),
    workouts: asArray(source.workouts),
    // Passed through untouched — the stores own what these may be, and a file
    // from before either existed simply has neither.
    sequence: source.sequence ?? null,
    numbering: source.numbering ?? null,
    // `?? undefined` rather than `?? null`, because absent has to stay absent:
    // `applyBackup` reads the difference to decide whether to touch the chats.
    aiChats: source.aiChats == null ? undefined : workoutChats(source.aiChats),
  };
  const counts = countPayload(payload);

  return {
    ok: true,
    counts,
    envelope: {
      format: BACKUP_FORMAT,
      version,
      exportedAt: typeof source.exportedAt === 'string' ? source.exportedAt : '',
      counts,
      ...payload,
    },
  };
}

/** "42 workouts · 512 sets · 88 exercises · 6 routines" — one line for a sheet. */
export function describeCounts(counts: BackupCounts, lang: Language = 'en'): string {
  /*
   * The counted noun goes through `plural`, not through an appended `s`: Russian
   * has three forms of every one of these words and none of them is the singular
   * with a letter on the end. `few` is the Russian-only form, so it is the
   * Russian word.
   */
  const counted = (n: number, forms: PluralForms) =>
    t('{count} {noun}', lang, { count: n, noun: plural(n, lang, forms) });

  const parts: string[] = [];
  parts.push(
    counted(counts.workouts, {
      one: t('workout', lang),
      few: 'тренировки',
      many: t('workouts', lang),
    }),
    counted(counts.sets, { one: t('set', lang), few: 'подхода', many: t('sets', lang) }),
    counted(counts.exercises, {
      one: t('exercise', lang),
      few: 'упражнения',
      many: t('exercises', lang),
    }),
    counted(counts.routines, {
      one: t('routine', lang),
      few: 'программы',
      many: t('routines', lang),
    }),
  );
  if (counts.chats != null && counts.chats > 0) {
    parts.push(
      counted(counts.chats, {
        one: t('AI chat', lang),
        few: 'чата с ИИ',
        many: t('AI chats', lang),
      }),
    );
  }
  return parts.join(' · ');
}
