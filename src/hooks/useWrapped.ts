/**
 * A Wrapped period, read off the stores — the one place the screen and the
 * history rows get their numbers from, so the "8 cards" on an entry is the
 * number of cards the screen then shows.
 *
 * `null` in, `null` out, so a caller with no period to offer can still call it
 * unconditionally. The arithmetic is all `lib/wrapped.ts`.
 */

import { useMemo } from 'react';

import { bodyweightAt } from '../lib/bodyweightLog';
import { workoutNumbers } from '../lib/completedWorkout';
import {
  wrappedCards,
  wrappedStats,
  wrappedSummary,
  type WrappedCard,
  type WrappedPeriod,
  type WrappedSummary,
} from '../lib/wrapped';
import { useSettings } from '../state/settingsStore';
import { useWorkoutHistory } from '../state/workoutHistoryStore';
import { useToday } from './useToday';
import { useLanguage } from './useT';

export interface WrappedView {
  cards: WrappedCard[];
  summary: WrappedSummary;
}

export function useWrapped(period: WrappedPeriod | null): WrappedView | null {
  const today = useToday();
  const lang = useLanguage();
  const workouts = useWorkoutHistory((s) => s.workouts);
  const numbering = useWorkoutHistory((s) => s.numbering);
  const bodyweightLog = useSettings((s) => s.bodyweightLog);
  const unitSystem = useSettings((s) => s.unitSystem);

  // Keyed on the period's parts, so a fresh `{…}` literal each render is not a change.
  const kind = period?.kind ?? null;
  const year = period?.year ?? 0;
  const month = period?.kind === 'month' ? period.month : 0;

  const stats = useMemo(() => {
    if (kind === null) return null;
    const p: WrappedPeriod = kind === 'year' ? { kind, year } : { kind, year, month };
    return wrappedStats({
      period: p,
      today,
      workouts,
      numbers: workoutNumbers(workouts, numbering),
      bodyweightAtDate: (at) => bodyweightAt(bodyweightLog, at),
    });
  }, [bodyweightLog, kind, month, numbering, today, workouts, year]);

  return useMemo(() => {
    if (!stats) return null;
    const words = { unitSystem, lang };
    return { cards: wrappedCards(stats, words), summary: wrappedSummary(stats, words) };
  }, [lang, stats, unitSystem]);
}
