/**
 * Wrapped (X1): a month or a year of training, told as a short run of story
 * cards — one fact a card, then a summary laid out to be kept.
 *
 *   SEPTEMBER 2026        TONNAGE              BEST RECORD           SUMMARY
 *   Your month            61,480 kg            96.3 kg e1RM          ╭ 9:16 ──────╮
 *   13 workouts.          About as heavy as    Bench press ·         │ WORKOUTS 13│
 *                         41 cars.             82.5 × 5 on 28 Sep.   │ TONNAGE …  │
 *                                                                    ╰────────────╯
 *
 * ── WHAT EACH CARD IS ALLOWED TO SAY ──────────────────────────────────────
 *
 * Every figure is something the log can stand behind, and a card with nothing
 * behind it is NOT DRAWN — a month with no records has no record card, not a
 * card of zeros. The rules, one card at a time:
 *
 *  • TONNAGE is each workout's stored volume added up: working sets only (the
 *    warm-ups were never in it, see `sessionVolume`), on the load the body moved.
 *    A workout saved without a bodyweight for its bodyweight sets says so, and so
 *    does the card. The comparison is a car of `CAR_KG`, rounded and said with
 *    "about"; under half a car there is no comparison rather than "0 cars".
 *  • WORKOUTS compares with the period before only when the log already existed
 *    then — a first month is not "13 more than August".
 *  • BEST RECORD is `recordsBrokenIn` asked of the whole period at once against
 *    everything before it: the T-09 rules (a bar must exist, ties are not records,
 *    the estimate ranks first, then the biggest jump). An exercise first done this
 *    month has no record in it.
 *  • BUSIEST WEEKDAY is read off the workouts when there are three or more of
 *    them; fewer has no card. Ties go to the earlier one in a Monday-first week.
 *
 * Rejected: a streak for training (IMPLEMENTATION_DECISIONS row 5 — none), and
 * any "you beat 87% of users": there are no other users, and nothing leaves the
 * phone.
 *
 * ── WHEN IT IS OFFERED ────────────────────────────────────────────────────
 *
 * IMPLEMENTATION_DECISIONS, T-10: last month's is reachable from the histories at
 * any time, and from a card during the first seven days of a month; the
 * year's is offered 1 December – 31 January (the current year in December, the
 * year just gone in January). `monthlyWrappedOffer` and `yearlyWrappedOffer` are
 * those two windows and nothing else — no dismissal to store, the card simply
 * stops being offered when its window closes.
 *
 * Pure: the stores are read by `hooks/useWrapped.ts` and handed in.
 */

import type { CompletedWorkout } from './completedWorkout';
import {
  dayKey,
  formatMonth,
  formatShortDay,
  pad,
  parseDay,
  weekdayIndex,
  weekdayNames,
} from './days';
import { plural, t, type Language } from './i18n';
import {
  recordSet,
  recordValue,
  recordsBrokenIn,
  type BodyweightLookup,
  type SessionRecord,
} from './records';
import { formatClock, formatValue, formatWeight, kgToLb, unitLabel } from './units';
import type { ID, UnitSystem } from '../types/models';

/**
 * The reference car, for "about as heavy as N cars": 1,500 kg, the round figure
 * for a passenger car's kerb weight (new cars sold in the EU average roughly
 * 1.4–1.6 t in the ICCT's European Vehicle Market Statistics pocketbooks). A
 * comparison is only ever "about", so a round figure is the honest one.
 */
export const CAR_KG = 1500;

/** Fewest workouts in a period before the busiest weekday is read off them. */
const WEEKDAY_FROM_WORKOUTS = 3;

/* ------------------------------------------------------------------ */
/* Periods and when they are offered                                   */
/* ------------------------------------------------------------------ */

/** `month` is 0-based, as `Date` uses it. */
export type WrappedPeriod =
  { kind: 'month'; year: number; month: number } | { kind: 'year'; year: number };

export interface DayRange {
  from: string;
  to: string;
}

/** First and last day of the period, as local `YYYY-MM-DD` keys. */
export function periodRange(period: WrappedPeriod): DayRange {
  if (period.kind === 'year') return { from: `${period.year}-01-01`, to: `${period.year}-12-31` };
  const days = new Date(period.year, period.month + 1, 0).getDate();
  const prefix = `${period.year}-${pad(period.month + 1)}`;
  return { from: `${prefix}-01`, to: `${prefix}-${pad(days)}` };
}

/** The month or year before. */
export function previousPeriod(period: WrappedPeriod): WrappedPeriod {
  if (period.kind === 'year') return { kind: 'year', year: period.year - 1 };
  return period.month === 0
    ? { kind: 'month', year: period.year - 1, month: 11 }
    : { kind: 'month', year: period.year, month: period.month - 1 };
}

/** The month before the one `today` is in — what the histories open. */
export function lastMonth(today: string): WrappedPeriod {
  const date = parseDay(today) ?? new Date();
  return previousPeriod({ kind: 'month', year: date.getFullYear(), month: date.getMonth() });
}

/** Last month's Wrapped, during the first seven days of a month; otherwise null. */
export function monthlyWrappedOffer(today: string): WrappedPeriod | null {
  const date = parseDay(today);
  if (!date || date.getDate() > 7) return null;
  return lastMonth(today);
}

/** The year's Wrapped: this year all December, the year just gone all January. */
export function yearlyWrappedOffer(today: string): WrappedPeriod | null {
  const date = parseDay(today);
  if (!date) return null;
  if (date.getMonth() === 11) return { kind: 'year', year: date.getFullYear() };
  if (date.getMonth() === 0) return { kind: 'year', year: date.getFullYear() - 1 };
  return null;
}

/* ------------------------------------------------------------------ */
/* The stats                                                           */
/* ------------------------------------------------------------------ */

export interface WrappedInput {
  period: WrappedPeriod;
  today: string;
  workouts: readonly CompletedWorkout[];
  /** Workout ordinals by id (`workoutNumbers`), for "Workout 88 to workout 100". */
  numbers?: Readonly<Record<ID, number>>;
  bodyweightAtDate?: BodyweightLookup;
}

export interface WrappedStats {
  period: WrappedPeriod;
  tonnage: { kg: number; partial: boolean } | null;
  workouts: {
    count: number;
    /** The period before's count, or null when the log did not exist yet. */
    previous: number | null;
    /** First and last ordinal in the period, when known. */
    first: number | null;
    last: number | null;
  } | null;
  record: { record: SessionRecord; name: string } | null;
  weekday: {
    /** Monday-first index. */
    weekday: number;
    workouts: number;
  } | null;
}

const within = (day: string, range: DayRange) => day >= range.from && day <= range.to;

function workoutsIn(workouts: readonly CompletedWorkout[], range: DayRange) {
  return workouts.filter((workout) => within(dayKey(workout.startedAt), range));
}

function bestRecord(input: WrappedInput, range: DayRange, inPeriod: readonly CompletedWorkout[]) {
  const before = input.workouts
    .filter((workout) => dayKey(workout.startedAt) < range.from)
    .flatMap((workout) => workout.sets);
  const [record] = recordsBrokenIn(
    inPeriod.flatMap((workout) => workout.sets),
    before,
    input.bodyweightAtDate,
    1,
  );
  if (!record) return null;
  // The name as that workout wrote it down — the snapshot history keeps.
  const workout = inPeriod.find((w) => w.id === record.sessionId);
  const name =
    workout?.exercises.find((e) => e.exerciseId === record.exerciseId)?.name ??
    inPeriod.flatMap((w) => w.exercises).find((e) => e.exerciseId === record.exerciseId)?.name ??
    '';
  return { record, name };
}

function busiestWeekday(inPeriod: readonly CompletedWorkout[]): WrappedStats['weekday'] {
  if (inPeriod.length < WEEKDAY_FROM_WORKOUTS) return null;
  const workouts = [0, 0, 0, 0, 0, 0, 0];
  for (const workout of inPeriod) {
    const date = parseDay(dayKey(workout.startedAt));
    if (date) workouts[weekdayIndex(date)] += 1;
  }
  let best = 0;
  // Strictly ahead, so an exact tie keeps the earlier day.
  for (let i = 1; i < 7; i += 1) if (workouts[i] > workouts[best]) best = i;
  return { weekday: best, workouts: workouts[best] };
}

/** The period in the log, or null when there is nothing to tell. */
export function wrappedStats(input: WrappedInput): WrappedStats | null {
  const range = periodRange(input.period);
  const before = periodRange(previousPeriod(input.period));
  const inPeriod = workoutsIn(input.workouts, range);

  const kg = inPeriod.reduce((sum, workout) => sum + (workout.totalVolumeKg || 0), 0);
  const tonnage =
    kg > 0 ? { kg: Math.round(kg), partial: inPeriod.some((w) => w.volumeIsPartial) } : null;

  let workouts: WrappedStats['workouts'] = null;
  if (inPeriod.length > 0) {
    const hadLog = input.workouts.some((w) => dayKey(w.startedAt) < range.from);
    const ordinals = inPeriod
      .map((w) => input.numbers?.[w.id])
      .filter((n): n is number => typeof n === 'number' && n >= 1);
    workouts = {
      count: inPeriod.length,
      previous: hadLog ? workoutsIn(input.workouts, before).length : null,
      first: ordinals.length > 0 ? Math.min(...ordinals) : null,
      last: ordinals.length > 0 ? Math.max(...ordinals) : null,
    };
  }

  const stats: WrappedStats = {
    period: input.period,
    tonnage,
    workouts,
    record: bestRecord(input, range, inPeriod),
    weekday: busiestWeekday(inPeriod),
  };
  const anything = stats.tonnage || stats.workouts || stats.record || stats.weekday;
  return anything ? stats : null;
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

export type WrappedCardKey = 'title' | 'tonnage' | 'workouts' | 'record' | 'weekday' | 'summary';

/** One story card. Empty strings are lines the card does not have. */
export interface WrappedCard {
  key: WrappedCardKey;
  kicker: string;
  big: string;
  unit: string;
  line: string;
  sub: string;
}

export interface WrappedWords {
  unitSystem: UnitSystem;
  lang: Language;
}

/** "September 2026" / "2026". */
function periodLabel(period: WrappedPeriod, lang: Language): string {
  return period.kind === 'year'
    ? String(period.year)
    : formatMonth(period.year, period.month, lang);
}

/** "the month before" / "the year before" — Russian needs no case for it. */
function before(period: WrappedPeriod, lang: Language): string {
  return t(period.kind === 'year' ? 'the year before' : 'the month before', lang);
}

/** "A, B and C" in either language. */
function listOf(parts: readonly string[], lang: Language): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} ${t('and', lang)} ${parts[parts.length - 1]}`;
}

function tonnageFigure(kg: number, unitSystem: UnitSystem): number {
  return Math.round(unitSystem === 'imperial' ? kgToLb(kg) : kg);
}

/** "61.5 t" / "820 kg" / "135.5k lb" — the summary's short form. */
export function shortTonnage(kg: number, unitSystem: UnitSystem, lang: Language): string {
  if (unitSystem === 'imperial') {
    const lb = tonnageFigure(kg, unitSystem);
    return lb >= 1000
      ? `${Number((lb / 1000).toFixed(1))}k ${unitLabel(unitSystem, lang)}`
      : `${lb} ${unitLabel(unitSystem, lang)}`;
  }
  return kg >= 1000
    ? `${Number((kg / 1000).toFixed(1))} ${t('t', lang)}`
    : `${Math.round(kg)} ${unitLabel(unitSystem, lang)}`;
}

/** "About as heavy as 41 cars." — or nothing under half a car. */
export function carsLine(kg: number, lang: Language): string {
  const cars = Math.round(kg / CAR_KG);
  if (cars < 1) return '';
  if (cars === 1) return t('About as heavy as a car.', lang);
  return t('About as heavy as {n} {cars}.', lang, {
    n: formatValue(cars),
    cars: plural(cars, lang, { one: t('car', lang), few: 'машин', many: t('cars', lang) }),
  });
}

function comparisonLine(
  count: number,
  previous: number | null,
  period: WrappedPeriod,
  lang: Language,
) {
  if (previous === null) return '';
  const diff = count - previous;
  const than = before(period, lang);
  if (diff === 0) return t('Same as {before}.', lang, { before: than });
  return diff > 0
    ? t('{n} more than {before}.', lang, { n: diff, before: than })
    : t('{n} fewer than {before}.', lang, { n: -diff, before: than });
}

function titleLine(stats: WrappedStats, lang: Language): string {
  const parts: string[] = [];
  if (stats.workouts) {
    const n = stats.workouts.count;
    parts.push(
      `${n} ${plural(n, lang, { one: t('workout', lang), few: 'тренировки', many: t('workouts', lang) })}`,
    );
  }
  return parts.length > 0 ? `${listOf(parts, lang)}.` : '';
}

function recordFigure(record: SessionRecord, words: WrappedWords): { big: string; unit: string } {
  const { unitSystem, lang } = words;
  if (record.kind === 'e1rm') {
    return {
      big: formatWeight(record.value, unitSystem),
      unit: `${unitLabel(unitSystem, lang)} e1RM`,
    };
  }
  if (record.kind === 'heaviest') {
    return { big: formatWeight(record.value, unitSystem), unit: unitLabel(unitSystem, lang) };
  }
  if (record.countUnit === 'seconds' || record.countUnit === 'rounds') {
    return { big: formatClock(record.value), unit: '' };
  }
  const shown = recordValue(record, unitSystem, lang);
  const space = shown.indexOf(' ');
  return space > 0
    ? { big: shown.slice(0, space), unit: shown.slice(space + 1) }
    : { big: shown, unit: '' };
}

/** The story cards, title first and summary last, with only the cards that have something. */
export function wrappedCards(stats: WrappedStats, words: WrappedWords): WrappedCard[] {
  const { lang, unitSystem } = words;
  const yearly = stats.period.kind === 'year';
  const cards: WrappedCard[] = [];

  cards.push({
    key: 'title',
    kicker: periodLabel(stats.period, lang),
    big: t(yearly ? 'Your year' : 'Your month', lang),
    unit: '',
    line: titleLine(stats, lang),
    sub: t('Tap the right side to step through.', lang),
  });

  if (stats.tonnage) {
    cards.push({
      key: 'tonnage',
      kicker: t('Tonnage', lang),
      big: formatValue(tonnageFigure(stats.tonnage.kg, unitSystem)),
      unit: unitLabel(unitSystem, lang),
      line: carsLine(stats.tonnage.kg, lang),
      sub: stats.tonnage.partial
        ? t('Working sets with a known load. Warm-ups are left out.', lang)
        : t('Every working set. Warm-ups are left out.', lang),
    });
  }

  if (stats.workouts) {
    const { count, previous, first, last } = stats.workouts;
    cards.push({
      key: 'workouts',
      kicker: t('Workouts', lang),
      big: String(count),
      unit: '',
      line: comparisonLine(count, previous, stats.period, lang),
      sub:
        first != null && last != null && last > first
          ? t('Workout {first} to workout {last}.', lang, { first, last })
          : '',
    });
  }

  if (stats.record) {
    const { record, name } = stats.record;
    const figure = recordFigure(record, words);
    cards.push({
      key: 'record',
      kicker: t('Best record', lang),
      ...figure,
      line: t('{name} · {set} on {date}.', lang, {
        name,
        set: recordSet(record, unitSystem),
        date: formatShortDay(dayKey(record.at), lang),
      }),
      sub: record.kind === 'e1rm' ? t('e1RM is an estimate (Epley).', lang) : '',
    });
  }

  if (stats.weekday) {
    const names = weekdayNames(lang);
    const { weekday, workouts } = stats.weekday;
    cards.push({
      key: 'weekday',
      kicker: t('Busiest weekday', lang),
      big: names[weekday],
      unit: '',
      line: `${workouts} ${plural(workouts, lang, {
        one: t('workout', lang),
        few: 'тренировки',
        many: t('workouts', lang),
      })}.`,
      sub: '',
    });
  }

  cards.push({ key: 'summary', kicker: t('Summary', lang), big: '', unit: '', line: '', sub: '' });
  return cards;
}

/** The summary card: a title, up to five figures, and the best record in a line. */
export interface WrappedSummary {
  kicker: string;
  title: string;
  cells: { key: string; label: string; value: string }[];
  record: string | null;
}

export function wrappedSummary(stats: WrappedStats, words: WrappedWords): WrappedSummary {
  const { lang, unitSystem } = words;
  const cells: WrappedSummary['cells'] = [];
  if (stats.workouts) {
    cells.push({
      key: 'workouts',
      label: t('Workouts', lang),
      value: String(stats.workouts.count),
    });
  }
  if (stats.tonnage) {
    cells.push({
      key: 'tonnage',
      label: t('Tonnage', lang),
      value: shortTonnage(stats.tonnage.kg, unitSystem, lang),
    });
  }
  let record: string | null = null;
  if (stats.record) {
    const { record: r, name } = stats.record;
    const figure = recordFigure(r, words);
    record = `${name} · ${recordSet(r, unitSystem)} · ${
      r.kind === 'e1rm'
        ? `e1RM ${figure.big} ${unitLabel(unitSystem, lang)}`
        : `${figure.big} ${figure.unit}`.trim()
    }`;
  }
  return {
    kicker: periodLabel(stats.period, lang),
    title: t(stats.period.kind === 'year' ? 'My year in numbers' : 'My month in numbers', lang),
    cells,
    record,
  };
}

/** The entry row: "September, wrapped" and "8 cards · your month in numbers". */
export function wrappedEntry(
  period: WrappedPeriod,
  cardCount: number,
  lang: Language,
): { title: string; detail: string } {
  const name =
    period.kind === 'year'
      ? String(period.year)
      : formatMonth(period.year, period.month, lang).split(' ')[0];
  const cards = `${cardCount} ${plural(cardCount, lang, {
    one: t('card', lang),
    few: 'карточки',
    many: t('cards', lang),
  })}`;
  return {
    title: t('{period}, wrapped', lang, { period: name }),
    detail: t(
      period.kind === 'year' ? '{cards} · your year in numbers' : '{cards} · your month in numbers',
      lang,
      {
        cards,
      },
    ),
  };
}
