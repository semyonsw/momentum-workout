/**
 * The warm-up toggle — one set, on top, at half the working weight.
 *
 *   before   [1] 80 × 8 · [2] 80 × 8 · [3] 80 × 8 · [4] 80 × 8
 *   tap      [W] 40 × 8 · [1] 80 × 8 · [2] 80 × 8 · [3] 80 × 8 · [4] 80 × 8
 *   tap      back to the four
 *
 * ── WHY ONE SET AND NOT A RAMP ──────────────────────────────────────────────
 *
 * The 40 · 60 · 80 generator this replaces was three rows and a sheet's worth of
 * decisions for something most people do as one lighter set. One toggle on the
 * first row is the whole feature: it says "I warm up on this", inserts the set
 * that means, and takes it back on the second tap. More than one warm-up is still
 * possible — `Add set` in edit mode, history's warm-up flag — it is just not what
 * the one-tap control makes.
 *
 * ── THE NUMBERS ─────────────────────────────────────────────────────────────
 *
 * HALF the first working set's weight, rounded to 2.5 kg — the smallest pair of
 * plates most gyms have, so the number is one you can actually load. The reps are
 * the working set's own: a warm-up is the same movement lighter, not a different
 * rep scheme.
 *
 * What "half" means depends on what the number IS (`LoadMode`):
 *
 *   • external — the number is the load. Half of it.
 *   • added_bodyweight — the number is the belt. Half the belt, which at the small
 *     end rounds to bodyweight alone — exactly the warm-up a weighted dip wants.
 *   • assisted — the number is HELP. Halving it makes the set harder, which is the
 *     opposite of a warm-up, so it is left as it is.
 *   • unweighted — there is no number. `null`, as on every row of such a movement.
 *
 * ── WHAT IT NEVER DOES ──────────────────────────────────────────────────────
 *
 * It never touches a working set: the insert is a splice at index 0 and the
 * removal filters warm-ups only, so sets 1..n come back as the same objects. And a
 * LOGGED warm-up is history — the toggle does not offer to remove one (edit mode's
 * `−` still can), because a toggle that deletes something you did is a toggle you
 * stop trusting.
 */

import type { DraftSet } from './draft';
import type { Exercise, ID } from '../types/models';

/** The fraction of the working weight a warm-up is loaded at. */
export const WARMUP_FRACTION = 0.5;

/** What a warm-up's weight rounds to, in kg — the smallest common plate pair. */
export const WARMUP_STEP_KG = 2.5;

/** What the toggle on the first row offers right now, or null for no toggle. */
export type WarmupToggle = 'add' | 'remove' | null;

/**
 * The warm-up weight for a working weight, by load mode — see the file header.
 */
export function warmupWeight(
  exercise: Pick<Exercise, 'requiresWeight' | 'loadMode'>,
  workingKg: number | null,
): number | null {
  if (!exercise.requiresWeight) return null;
  if (workingKg == null || !Number.isFinite(workingKg)) return workingKg ?? null;
  if (exercise.loadMode === 'assisted') return workingKg;
  if (workingKg <= 0) return 0;
  const half = workingKg * WARMUP_FRACTION;
  return Math.round(half / WARMUP_STEP_KG) * WARMUP_STEP_KG;
}

/**
 * Which way the toggle goes.
 *
 *  • 'remove' — the first row is an unlogged warm-up.
 *  • 'add'    — no warm-up anywhere, and the first row is not logged yet. Once
 *    the first working set is done, a warm-up "before" it is a row in the past.
 *  • null     — a warm-up that is already logged or is the only row, or one that is not on top (a
 *    row moved there by hand is the user's arrangement, not the toggle's), or no
 *    rows at all.
 */
export function warmupToggleState(
  sets: readonly Pick<DraftSet, 'isWarmup' | 'isCompleted'>[],
): WarmupToggle {
  const first = sets[0];
  if (!first) return null;
  // Not when the warm-up is all there is: removing it would leave no card.
  if (first.isWarmup) return first.isCompleted || sets.every((s) => s.isWarmup) ? null : 'remove';
  if (sets.some((s) => s.isWarmup)) return null;
  return first.isCompleted ? null : 'add';
}

/**
 * The rows after one tap on the toggle. The SAME array when the toggle has
 * nothing to do, so a stray tap repaints nothing.
 *
 * Removing takes every unlogged warm-up off the top — a session prefilled with
 * last time's two warm-ups is still "a warm-up" to the person tapping, and taking
 * off one of two would read as the tap half-working.
 */
export function toggleWarmupSets(
  sets: readonly DraftSet[],
  exercise: Pick<Exercise, 'requiresWeight' | 'loadMode'>,
  makeId: () => ID,
): DraftSet[] {
  const state = warmupToggleState(sets);
  if (state === 'remove') {
    let leading = 0;
    while (leading < sets.length && sets[leading].isWarmup && !sets[leading].isCompleted) {
      leading += 1;
    }
    // Never the last row: a card with no sets is not a card (see `removeSet`).
    if (leading >= sets.length) return sets as DraftSet[];
    return sets.slice(leading);
  }
  if (state !== 'add') return sets as DraftSet[];

  const first = sets[0];
  const reps = sets.find((s) => s.count > 0)?.count ?? 10;
  const warmup: DraftSet = {
    localId: makeId(),
    weightKg: warmupWeight(exercise, first.weightKg),
    // The first working set's reps; a counter at zero (a `MAX` row, a max test)
    // has none to copy, so the first row that does.
    count: first.count > 0 ? first.count : reps,
    isWarmup: true,
    isCompleted: false,
    completedAt: null,
    // A number the app chose, so it is ghosted and one ✓ away like any prefill.
    isPrefilled: true,
  };
  return [warmup, ...sets];
}
