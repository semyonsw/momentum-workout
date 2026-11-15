/**
 * The words on an open exercise card that are not set rows (redesign #3): the
 * sub-line under the name.
 *
 * ── THE SUB-LINE SAYS THE PLAN IN THE ORDER IT IS USED ───────────────────────
 *
 * It read `4 × 8–10 reps · last: +40 kg · 4 4`: the target, with the weight only
 * in the "last time" half. The redesign leads with what the card holds and what
 * each set is aiming at — `4 sets · target 80 kg × 8` — because "how many, how
 * heavy, how many reps" is the order a lifter checks them in. The weight is the
 * FIRST WORKING ROW's, the number the session is actually about to ask for, not a
 * plan figure the rows may already have moved away from.
 *
 * Rejected: reusing `formatTarget` whole and prefixing a weight. It speaks in
 * `N × reps`, so the line would have said the set count twice.
 */

import type { DraftEntry } from './draft';
import { formatTarget } from './draft';
import { plural, t, type Language } from './i18n';
import { countUnitLabel, formatWeight, unitLabel } from './units';
import type { UnitSystem } from '../types/models';

/** `4 sets` / `1 round`, in the reading language. */
export function countOfSets(n: number, rounds: boolean, lang: Language): string {
  const word = rounds
    ? plural(n, lang, { one: t('round', lang), few: 'круга', many: 'кругов' })
    : plural(n, lang, { one: t('set', lang), few: 'подхода', many: t('sets', lang) });
  return `${n} ${word}`;
}

/**
 * `4 sets · target 80 kg × 8`, `3 sets · target 2 min`, `5 sets · target 16 + 10 + 8`.
 *
 * The count is the session's WORKING rows (a warm-up is not a set of the plan),
 * falling back to the plan when there are none. The weight appears only on
 * weighted work with a number in its first working row.
 */
export function exerciseSubline(
  entry: Pick<DraftEntry, 'targetSets' | 'targetRepsMin' | 'targetRepsMax' | 'exercise' | 'sets'> &
    Partial<Pick<DraftEntry, 'ladder'>>,
  unitSystem: UnitSystem,
  lang: Language = 'en',
): string {
  const { exercise } = entry;
  const target = formatTarget(entry, lang);
  /*
   * `formatTarget` says `N × what`, except for a ladder, which states every set.
   * The N is split off so the line can say it as `N sets`; a ladder keeps its
   * whole string as the target.
   */
  const match = /^(\d+) × (.*)$/.exec(target);
  const working = entry.sets.filter((s) => !s.isWarmup).length;
  const n = match ? Number(match[1]) : working > 0 ? working : entry.targetSets;
  let what = match ? match[2] : target;

  const firstWorking = entry.sets.find((s) => !s.isWarmup);
  const kg = firstWorking?.weightKg;
  const weighted = exercise.requiresWeight && typeof kg === 'number' && kg > 0;
  if (weighted && match) {
    // `80 kg × 8`, not `80 kg × 8 reps`: next to a weight the bare number IS reps.
    const reps = ` ${countUnitLabel('reps', lang)}`;
    if (exercise.countUnit === 'reps' && what.endsWith(reps)) {
      what = what.slice(0, -reps.length);
    }
    what = `${formatWeight(kg, unitSystem, exercise.loadMode)} ${unitLabel(unitSystem, lang)} × ${what}`;
  }

  return t('{sets} · target {what}', lang, {
    sets: countOfSets(n, exercise.countUnit === 'rounds', lang),
    what: what.trim(),
  });
}
