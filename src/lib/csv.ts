/**
 * The training log as a spreadsheet: one row per set.
 *
 *   date,workout,routine,exercise,set,weight,unit,count,count_unit,load_mode,warmup,rest_s
 *   2026-10-03,212,Push,Bench press,1,60,kg,8,reps,external,true,
 *
 * The JSON backup is readable, but a spreadsheet cannot read nested JSON — the
 * set rows live inside an array inside a workout inside an array, and getting
 * them into columns means writing the script the file was supposed to make
 * unnecessary. So this is the flat form, and it is deliberately NOT a second
 * backup format:
 *
 *  • NO CSV IMPORT. A table of rows carries no library, no routines and no
 *    settings; reading one back would make a
 *    log that refers to things that do not exist. There is one way back in, the
 *    JSON file, and that stays true (see `state/dataTransfer.ts`).
 *  • DERIVED, NEVER SUMMARISED. Every cell comes off one stored row or the record
 *    around it. Nothing is totalled, averaged or estimated; the only arithmetic is
 *    the unit conversion a reader would otherwise have to do by hand — kg to lb
 *    for somebody who lifts in pounds.
 *
 * ── THE DECISIONS A SPREADSHEET NOTICES ───────────────────────────────────
 *
 *  • NUMBERS IN CELLS ARE PLAIN: a point for decimals, no thousands separator. A
 *    grouped `1,250` would be a quoted string in every tool that reads this.
 *  • HEADERS ARE ENGLISH, LOWERCASE, AND NEVER TRANSLATED. They are column names
 *    for formulas, not words for a reader, and a sheet that renamed its columns
 *    when the phone changed language would break every formula built on it. The
 *    DATA is the user's own words, in whatever script they typed them.
 *  • A UTF-8 BOM up front. Without it Excel opens a CSV in the machine's legacy
 *    code page and every Cyrillic exercise name arrives as mojibake; LibreOffice,
 *    Sheets and Numbers all skip it. It is three bytes and the price of `Жим`
 *    reading as `Жим`.
 *
 * ── RFC 4180 ───────────────────────────────────────────────────────────────
 *
 * Exercise names contain commas by nature ("Row, stomach"), a note can contain a
 * quote or a line break. The rule is the standard one: quote a field if it holds
 * a comma, a quote, a CR or an LF, and double any quote inside it. CRLF between
 * records, and after the last one, because that is what the RFC says and what
 * Excel expects.
 */

import { formatRir } from './effort';
import { setKindOf } from './setType';
import type { CompletedWorkout, WorkoutNumberAnchor } from './completedWorkout';
import { workoutNumbers } from './completedWorkout';
import { dayKey, pad } from './days';
import { kgToLb } from './units';
import type { UnitSystem } from '../types/models';

/** What makes Excel read the file as UTF-8. See the header. */
export const BOM = '﻿';

const CRLF = '\r\n';

export const SET_COLUMNS = [
  'date',
  'workout',
  'routine',
  'exercise',
  'set',
  'weight',
  'unit',
  'count',
  'count_unit',
  'load_mode',
  'warmup',
  'rest_s',
  // Appended, never inserted: a sheet built on the columns above keeps working.
  'rir',
  'set_type',
] as const;

/**
 * One field, quoted if it has to be.
 *
 * Only when it has to be, rather than always: an unquoted file is readable in a
 * terminal, and `diff`ing two exports is something somebody will want to do.
 */
export function csvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** Header plus records, BOM first, CRLF after every record — the whole file. */
export function csvDocument(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const lines = [columns, ...rows].map((row) => row.map(csvField).join(','));
  return `${BOM}${lines.join(CRLF)}${CRLF}`;
}

const bool = (value: boolean) => (value ? 'true' : 'false');

export interface WorkoutsCsvOptions {
  /** The pinned workout number, as the history list uses it. */
  numbering?: WorkoutNumberAnchor | null;
  unitSystem?: UnitSystem;
}

/** A weight in the user's unit: stored kg exactly, or lb to two decimals. */
function csvWeight(kg: number, unitSystem: UnitSystem): string {
  if (unitSystem === 'metric') return String(kg);
  return String(Number(kgToLb(kg).toFixed(2)));
}

/**
 * Every set in the log, oldest workout first, each workout's sets grouped by
 * exercise in the workout's exercise order, and in set order within one.
 *
 * ── THE EXERCISE NAME COMES FROM THE WORKOUT, NOT THE LIBRARY ──────────────
 *
 * Each `CompletedWorkout` carries a snapshot of the name of every exercise in it,
 * precisely so a rename or a delete cannot rewrite the log. An exercise deleted
 * from the library since still exports under the name it had when it was trained.
 *
 * `workout` is the number the history list prints (`workoutNumbers`, with the
 * user's pin), blank where that number would be below 1 — the list leaves those
 * unnumbered too. `routine` is the workout's title, which is the routine it was
 * started from or the name it was given. `set` is `setIndex + 1`, counted
 * within the exercise as the workout screen counts it (Bench 1–3, then Squat
 * 1–2), warm-ups included; `warmup` says which ones count.
 * `rir` is the reps in reserve when the set was graded, blank when it was not
 * (RPE is `10 − rir`, a formula a spreadsheet can do). `set_type` is what the set
 * was — `working`, `warmup`, `drop`, `failure` or `amrap` — so a filter on it does
 * not need the `warmup` column, which stays for the sheets already built on it.
 * Weight is blank, not 0, for unweighted work: a spreadsheet summing the column
 * must not be told a push-up weighed nothing.
 */
export function workoutsToCsv(
  workouts: readonly CompletedWorkout[],
  options: WorkoutsCsvOptions = {},
): string {
  const unitSystem = options.unitSystem ?? 'metric';
  const unit = unitSystem === 'imperial' ? 'lb' : 'kg';
  // `workoutNumbers` wants the store's order, newest first.
  const newestFirst = [...workouts].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const numbers = workoutNumbers(newestFirst, options.numbering ?? null);

  const rows: string[][] = [];
  for (const workout of [...newestFirst].reverse()) {
    const nameById = new Map(workout.exercises.map((e) => [e.exerciseId, e.name]));
    const date = dayKey(workout.startedAt);
    const number = numbers[workout.id];
    // `setIndex` counts within ONE exercise (`draftToSetHistory`), so sorting on
    // it alone interleaves them — Bench 1, Squat 1, Bench 2. The workout's own
    // exercise order first, then the set; an exercise the snapshot does not
    // list goes last rather than being dropped.
    const position = new Map(workout.exercises.map((e, i) => [e.exerciseId, i]));
    const rank = (exerciseId: string) => position.get(exerciseId) ?? workout.exercises.length;
    const sets = [...workout.sets].sort(
      (a, b) => rank(a.exerciseId) - rank(b.exerciseId) || a.setIndex - b.setIndex,
    );

    for (const set of sets) {
      rows.push([
        date,
        number != null && number >= 1 ? String(number) : '',
        workout.title,
        nameById.get(set.exerciseId) ?? set.exerciseId,
        String(set.setIndex + 1),
        set.weightKg == null ? '' : csvWeight(set.weightKg, unitSystem),
        set.weightKg == null ? '' : unit,
        String(set.count),
        set.countUnit,
        set.loadMode,
        bool(set.isWarmup),
        set.restTakenSeconds == null ? '' : String(Math.round(set.restTakenSeconds)),
        set.rir == null ? '' : formatRir(set.rir),
        setKindOf(set),
      ]);
    }
  }
  return csvDocument(SET_COLUMNS, rows);
}

/**
 * `momentum-workouts-2026-10-09-0912` — sortable, and it says what it is.
 *
 * A different stem from the JSON backups' on purpose: a folder holding both must
 * not leave anybody guessing which one restores, and the daily sweep matches its
 * own backup names exactly (`isBackupFileName` in `lib/autoBackup.ts`,
 * `momentum-workout-backup-<day>.json`), so it can never delete one of these —
 * `momentum-workouts-…` is not `momentum-workout-backup-…`. No extension: SAF
 * appends `.csv` from the MIME type.
 */
export function csvBaseName(now: Date = new Date()): string {
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `momentum-workouts-${dayKey(now)}-${time}`;
}
