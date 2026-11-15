/**
 * SparkBurst — what is left of the confetti that used to leave the day dial
 * when the day closed: the `celebrate()` haptic, and nothing on screen.
 *
 * ── WHY IT DRAWS NOTHING ───────────────────────────────────────────────────
 *
 * It was the one animation in the app that was purely decorative — fourteen
 * dots flying out over 1.1 s — and the motion pass that made the app calm cut
 * exactly that kind of flourish. The rising three-step you FEEL stays, because a
 * workout saved is still an event worth acknowledging and the haptic costs no
 * screen time at all.
 *
 * The component and `SPARK_MS` are kept rather than deleted so the caller's
 * mount-then-timeout logic needs no edit; deleting both is a safe follow-up.
 */

import { useEffect } from 'react';

import { celebrate } from '../lib/feedback';

export function SparkBurst(_props: { y?: number }) {
  useEffect(() => {
    celebrate();
  }, []);
  return null;
}

/** How long a caller keeps it mounted — just long enough for the effect to run. */
export const SPARK_MS = 300;
