/**
 * Achievements (E1, Wave 3, behind the one switch in `lib/engagement.ts`):
 * sixteen quiet badges over the training log, and the facts they are read off.
 *
 *   100 workouts        ● Gold     earned 14 Sep 2026
 *   1 tonne in a session ● Bronze  earned 2 Mar 2026
 *   10 records          ┆ locked   7 / 10 records
 *
 * ── A PURE FUNCTION OF THE LOGS ───────────────────────────────────────────
 *
 * Nothing here is stored. `logFacts` walks the log once and turns it into
 * dated events (a workout on a day, its sets, its kilograms, a record); every
 * badge is a threshold over one of those series, and the day it was earned is
 * the day of the event that crossed it. So:
 *
 *  • RETROACTIVE. Switching the layer on a year in shows a year of badges, each
 *    with the day it was really earned.
 *  • STABLE. The same logs always give the same badges and the same dates —
 *    recomputing on every render cannot move an earned date, because the date
 *    is the log's, not the clock's.
 *  • HONEST ABOUT EDITS. Delete the hundredth workout and "100 workouts" is not
 *    earned until there are a hundred again. Rejected: storing earned badges so
 *    they are "never taken back" — that is a second record of the past that can
 *    disagree with the log, and the log is the one the user can see and edit.
 *    Nothing in the UI ever says a badge was lost: a locked badge is a locked
 *    badge, with its progress.
 *
 * ── THE RULES THE SERIES FOLLOW ───────────────────────────────────────────
 *
 * One event per saved session, on the day it started. Tonnage is the stored
 * `totalVolumeKg` (working sets, `lib/draft.ts`), the same figure the history
 * and Wrapped print. Records are `recordMoments` — the Finish sheet's rules,
 * so the first record is the session whose sheet said so.
 *
 * ── TIERS ─────────────────────────────────────────────────────────────────
 *
 * Bronze, silver and gold are drawn in the THEME's three stops — c3, c2, c1 —
 * not in metal colours (the design's note): a gold badge is the brightest stop
 * of whatever theme is on, so a badge never clashes with the app around it.
 */

import { recordMoments, type BodyweightLookup } from './records';
import type { CompletedWorkout } from './completedWorkout';
import { dayKey, formatLongDay } from './days';
import { plural, t, term, type Language } from './i18n';
import { formatValue } from './units';

/* ------------------------------------------------------------------ */
/* The facts                                                           */
/* ------------------------------------------------------------------ */

export interface LogsInput {
  /** `YYYY-MM-DD`. Nothing after it counts. */
  today: string;
  /** Newest first, as the store keeps them — order does not matter here. */
  workouts: readonly CompletedWorkout[];
  /** For bodyweight work's records, as the exercise screen weighs them. */
  bodyweightAtDate?: BodyweightLookup;
}

/** One dated event and its size: a session's kilograms or sets, or 1. */
export interface FactPoint {
  day: string;
  value: number;
}

/** Every series a badge or the XP table reads, each OLDEST FIRST. */
export interface LogFacts {
  /** One per saved workout. */
  workouts: FactPoint[];
  /** One per saved workout; value = its working sets. */
  sets: FactPoint[];
  /** One per saved workout; value = kilograms moved in working sets. */
  tonnage: FactPoint[];
  /** One per (session, exercise) that set a record. */
  records: FactPoint[];
}

const byDay = (a: FactPoint, b: FactPoint) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);

export function logFacts(input: LogsInput): LogFacts {
  const { workouts, today, bodyweightAtDate } = input;
  const kept = workouts.filter((w) => dayKey(w.startedAt) <= today);
  const sessions = kept.map((w) => ({ day: dayKey(w.startedAt), value: 1 })).sort(byDay);
  const sets = kept
    .map((w) => ({ day: dayKey(w.startedAt), value: Math.max(0, w.setCount || 0) }))
    .sort(byDay);
  const tonnage = kept
    .map((w) => ({
      day: dayKey(w.startedAt),
      value: Number.isFinite(w.totalVolumeKg) ? Math.max(0, w.totalVolumeKg) : 0,
    }))
    .sort(byDay);
  const records = recordMoments(
    kept.flatMap((w) => w.sets),
    bodyweightAtDate,
  ).map((moment) => ({ day: dayKey(moment.at), value: 1 }));
  return { workouts: sessions, sets, tonnage, records };
}

/* ------------------------------------------------------------------ */
/* The badges                                                          */
/* ------------------------------------------------------------------ */

/** 1 bronze (c3) · 2 silver (c2) · 3 gold (c1). */
export type BadgeTier = 1 | 2 | 3;

/** How a progress figure is printed. */
type BadgeUnit = 'workouts' | 'tonnes' | 'records' | 'sets';

interface BadgeDef {
  id: string;
  tier: BadgeTier;
  /** The threshold, in the series' own units (kilograms for tonnage). */
  need: number;
  series: keyof LogFacts;
  /** `sum`: the series adds up. `max`: one event has to reach it. */
  measure: 'sum' | 'max';
  unit: BadgeUnit;
  /** English; translated through the catalogue. */
  title: string;
  what: string;
}

const TONNE = 1000;

/**
 * THE SIXTEEN, in the order the gallery shows them: each series from the first
 * step to the last, so a row reads as a ladder.
 */
export const BADGES: readonly BadgeDef[] = [
  b('workouts1', 1, 1, 'workouts', 'sum', 'workouts', 'First workout', 'Save your first workout.'),
  b('workouts10', 1, 10, 'workouts', 'sum', 'workouts', '10 workouts', 'Save 10 workouts.'),
  b('workouts50', 2, 50, 'workouts', 'sum', 'workouts', '50 workouts', 'Save 50 workouts.'),
  b('workouts100', 3, 100, 'workouts', 'sum', 'workouts', '100 workouts', 'Save 100 workouts.'),
  b('workouts250', 3, 250, 'workouts', 'sum', 'workouts', '250 workouts', 'Save 250 workouts.'),
  b('workouts500', 3, 500, 'workouts', 'sum', 'workouts', '500 workouts', 'Save 500 workouts.'),
  b(
    'session1t',
    1,
    TONNE,
    'tonnage',
    'max',
    'tonnes',
    '1 tonne in a session',
    'Move 1,000 kg in the working sets of one workout.',
  ),
  b(
    'session5t',
    2,
    5 * TONNE,
    'tonnage',
    'max',
    'tonnes',
    '5 tonnes in a session',
    'Move 5,000 kg in the working sets of one workout.',
  ),
  b(
    'session10t',
    3,
    10 * TONNE,
    'tonnage',
    'max',
    'tonnes',
    '10 tonnes in a session',
    'Move 10,000 kg in the working sets of one workout.',
  ),
  b(
    'tonnage10',
    1,
    10 * TONNE,
    'tonnage',
    'sum',
    'tonnes',
    '10 tonnes moved',
    'Move 10 tonnes in working sets, all workouts together.',
  ),
  b(
    'tonnage100',
    2,
    100 * TONNE,
    'tonnage',
    'sum',
    'tonnes',
    '100 tonnes moved',
    'Move 100 tonnes in working sets, all workouts together.',
  ),
  b(
    'tonnage1000',
    3,
    1000 * TONNE,
    'tonnage',
    'sum',
    'tonnes',
    '1,000 tonnes moved',
    'Move 1,000 tonnes in working sets, all workouts together.',
  ),
  b(
    'records1',
    1,
    1,
    'records',
    'sum',
    'records',
    'First record',
    'Beat a previous best: a new e1RM, heaviest set or most reps.',
  ),
  b(
    'records10',
    2,
    10,
    'records',
    'sum',
    'records',
    '10 records',
    'Beat a previous best in 10 exercise sessions.',
  ),
  b(
    'records50',
    3,
    50,
    'records',
    'sum',
    'records',
    '50 records',
    'Beat a previous best in 50 exercise sessions.',
  ),
  b(
    'sets1000',
    2,
    1000,
    'sets',
    'sum',
    'sets',
    '1,000 working sets',
    'Log 1,000 working sets. Warm-ups are not counted.',
  ),
];

function b(
  id: string,
  tier: BadgeTier,
  need: number,
  series: keyof LogFacts,
  measure: 'sum' | 'max',
  unit: BadgeUnit,
  title: string,
  what: string,
): BadgeDef {
  return { id, tier, need, series, measure, unit, title, what };
}

export interface Badge {
  id: string;
  tier: BadgeTier;
  need: number;
  /** The fact series it counts — what its glyph is drawn from. */
  series: keyof LogFacts;
  /** Where the log stands, capped at `need` once earned; never below 0. */
  have: number;
  /** The day the log crossed `need`, or null while locked. */
  earnedOn: string | null;
  /** 0–1, for the bar. 1 only when earned. */
  fraction: number;
  unit: BadgeUnit;
  title: string;
  what: string;
}

/**
 * Every badge, earned or not, in `BADGES` order. Same facts in, same badges out.
 */
export function achievements(facts: LogFacts): Badge[] {
  return BADGES.map((def) => {
    const series = facts[def.series];
    let have = 0;
    let earnedOn: string | null = null;
    for (const point of series) {
      have = def.measure === 'sum' ? have + point.value : Math.max(have, point.value);
      if (earnedOn === null && have >= def.need) earnedOn = point.day;
    }
    const capped = earnedOn !== null ? def.need : Math.max(0, have);
    return {
      id: def.id,
      tier: def.tier,
      need: def.need,
      series: def.series,
      have: capped,
      earnedOn,
      // 99% until it is truly there, as every other bar in the app.
      fraction: earnedOn !== null ? 1 : Math.min(0.99, capped / def.need),
      unit: def.unit,
      title: def.title,
      what: def.what,
    };
  });
}

/** The gallery's line: how many are earned. */
function earnedCount(badges: readonly Badge[]): number {
  return badges.filter((badge) => badge.earnedOn !== null).length;
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

export function tierName(tier: BadgeTier, lang: Language): string {
  return t(tier === 3 ? 'Gold' : tier === 2 ? 'Silver' : 'Bronze', lang);
}

/** `whole` tonnes from kilograms, rounded DOWN so a locked badge never reads as reached. */
function tonnes(kg: number): string {
  const tonnes = kg / TONNE;
  if (tonnes < 10) return String(Math.floor(tonnes * 10) / 10);
  return formatValue(Math.floor(tonnes));
}

const count = (n: number) => formatValue(Math.floor(n));

/** The noun after a progress figure, agreeing with `need` — `73 / 100 workouts`. */
function unitWord(unit: BadgeUnit, n: number, lang: Language): string {
  const forms: Record<BadgeUnit, [string, string, string]> = {
    workouts: ['workout', 'workouts', 'тренировки'],
    tonnes: ['t', 't', 'т'],
    records: ['record', 'records', 'рекорда'],
    sets: ['set', 'sets', 'подхода'],
  };
  const [one, many, few] = forms[unit];
  return plural(n, lang, { one: term('badge', one, lang), few, many: term('badge', many, lang) });
}

/**
 * The progress line: `73 / 100 workouts`, `0.6 / 1 t`. For a one-step badge
 * still locked there is no fraction worth printing, so it says so instead.
 */
export function describeBadgeProgress(badge: Badge, lang: Language): string {
  if (badge.unit === 'tonnes') {
    return `${tonnes(badge.have)} / ${tonnes(badge.need)} ${unitWord('tonnes', badge.need, lang)}`;
  }
  if (badge.need === 1 && badge.earnedOn === null) return t('Not yet', lang);
  return `${count(badge.have)} / ${count(badge.need)} ${unitWord(badge.unit, badge.need, lang)}`;
}

/** `Earned 14 September 2026`, or null while locked. */
export function describeEarned(badge: Badge, lang: Language): string | null {
  if (badge.earnedOn === null) return null;
  return t('Earned {date}', lang, { date: formatLongDay(badge.earnedOn, lang) });
}

/** The gallery's sentence above the grid. */
export function describeGallery(badges: readonly Badge[], lang: Language): string {
  return t('{n} of {total} earned.', lang, { n: earnedCount(badges), total: badges.length });
}
