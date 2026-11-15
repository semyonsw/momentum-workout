/**
 * A max test, remembered on the exercise the moment it is logged.
 *
 * Sibling of `state/weightSync.ts`, for the same reason: it spans two stores, and
 * the arrow has to run session → library and never back. `libraryStore` is the
 * only import, so `activeWorkoutStore` can call this without a cycle.
 *
 * WHY AT THE ✓ AND NOT AT FINISH. Finish writes a ladder only when the session MET
 * its plan (`ladderOutcomes`), which is right for progression and wrong for a
 * test: the max is what the first set proved, whether or not the backoffs built
 * from it got finished. Writing it here means a session abandoned after the test
 * still leaves the exercise with a real max, and the next one runs the ladder
 * instead of testing again.
 */

import { useLibrary } from './libraryStore';
import type { ID } from '../types/models';

/** The test set proved `max`; `replacing` is what it read before an edit. */
export function rememberTestedMax(
  exerciseId: ID,
  max: number,
  replacing: number | null = null,
): void {
  useLibrary.getState().setExerciseTestedMax(exerciseId, max, replacing);
}
