/**
 * `useAiPrompts()` — the suggested questions, named from the user's own log and
 * in the language in force.
 *
 * A hook because two places draw the same list — the card under the hero and
 * the chat itself — and a chip that said "Improve Push" on one screen and
 * "Improve Pull" on the next would be two answers to one question. The decision
 * is `lib/ai/aiPrompts.ts`; this is the subscription.
 *
 * It reads only the three slices the prompts need — the finished workouts, the
 * exercises and the routines.
 */

import { useMemo } from 'react';

import { workoutFacts } from '../lib/ai/aiContext';
import { suggestedPrompts, type SuggestedPrompt } from '../lib/ai/aiPrompts';
import { useLibrary } from '../state/libraryStore';
import { useWorkoutHistory } from '../state/workoutHistoryStore';
import { useLanguage } from './useT';

export function useAiPrompts(): SuggestedPrompt[] {
  const lang = useLanguage();
  const exercises = useLibrary((s) => s.exercises);
  const routines = useLibrary((s) => s.routines);
  const workouts = useWorkoutHistory((s) => s.workouts);

  const facts = useMemo(() => {
    const found = workoutFacts({ exercises, routines, workouts });
    return { topLift: found.topLift, lastRoutine: found.lastRoutine?.name ?? null };
  }, [exercises, routines, workouts]);

  return useMemo(() => suggestedPrompts(facts, lang), [facts, lang]);
}
