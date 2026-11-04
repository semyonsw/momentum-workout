/**
 * The two roots — the training and Settings — and the gestures between them.
 *
 *   Workout · Settings
 *
 * ── WHY THE ORDER IS A CONSTANT AND NOT A TAB BAR DETAIL ───────────────────
 *
 * The order is more than layout: a slide between the two goes the way the
 * bar's blob does (`navigation/ShellStage.tsx`), and the spare is built along
 * it (`lib/stageBuilds.ts`). Two places deciding which side Settings is on is
 * two places for them to disagree, so the order lives here and all of them
 * read it.
 */

export const SECTIONS = ['Workout', 'Settings'] as const;

export type SectionTab = (typeof SECTIONS)[number];

/* ══════════════════════════════════════════════════════════════════════════
   THE TRAINING AND SETTINGS — and the gestures between them.

     Section ◀──tap nav / back──▶ Settings
        │  ▲
        push  back / edge
        ▼  │
     Inner screen

   There used to be a landing above the sections (2.0–2.10): tiles and a raised
   Home button in the middle of the bar, which only made sense while the app
   held more than one log. The training IS the landing — the thing you open the
   app to see — so it is the root, Back on it arms the exit, and a route is
   exactly a section.
   ══════════════════════════════════════════════════════════════════════════ */

export type ShellRoute = SectionTab;

/** Where the app opens, and where Back from anywhere else in it lands. */
export const SHELL_ROOT: SectionTab = 'Workout';

/**
 * The nav bar's slot centres for the sections it shows, as fractions of the
 * bar's width: evenly spaced, each in the middle of its own share.
 *
 * Two slots land at 1/4 and 3/4 — the halves of the bar, each glyph centred in
 * the half it owns. The 2.x layout drew four at 44 · 110 | 258 · 324 of 368 dp
 * around a raised Home button; reusing two of those positions would leave a
 * hole in the middle where a button used to be, which reads as something
 * missing rather than as a two-item bar. Fractions, so a 340 dp bar keeps its
 * proportions.
 */
export function navSlots(sections: readonly SectionTab[]): Partial<Record<SectionTab, number>> {
  const slots: Partial<Record<SectionTab, number>> = {};
  sections.forEach((section, i) => {
    slots[section] = (i + 0.5) / sections.length;
  });
  return slots;
}

/**
 * Which way a switch slides: +1 when `to` is to the RIGHT of `from` on the bar
 * the app actually draws, so the screen goes the way the blob does.
 */
export function slideDir(
  sections: readonly SectionTab[],
  from: SectionTab,
  to: SectionTab,
): 1 | -1 {
  return sections.indexOf(to) < sections.indexOf(from) ? -1 : 1;
}

/** Half the lit blob's width at rest, in dp. */
export const BLOB_HALF = 30;

/** The edge that starts a back-swipe on a pushed screen. */
export const EDGE_BACK_PX = 44;

/** Released edge-swipe: pop past 120 dp or a flick faster than 0.6 px/ms. */
export function edgeBackCommits(dx: number, vx: number): boolean {
  return dx > 120 || vx > 0.6;
}

/** How long a first back press on the root keeps the second one armed. */
export const EXIT_WINDOW_MS = 2000;

export type BackAction = 'closeSheet' | 'pop' | 'root' | 'armExit' | 'exit';

/**
 * Android back, in the design's order: a sheet closes first, then a pushed
 * screen pops, then Settings goes back to the training (`root`), and there the
 * first press arms an exit (a toast says so) and a second within two seconds
 * leaves.
 *
 * `root` is `SHELL_ROOT`, passed in so the rule reads the same whichever root
 * a test stands in. `exitArmedAt` is when the last press armed it, or null.
 */
export function backAction(state: {
  sheetOpen: boolean;
  stackDepth: number;
  route: ShellRoute;
  root: ShellRoute;
  exitArmedAt: number | null;
  now: number;
}): BackAction {
  if (state.sheetOpen) return 'closeSheet';
  if (state.stackDepth > 0) return 'pop';
  if (state.route !== state.root) return 'root';
  if (state.exitArmedAt != null && state.now - state.exitArmedAt <= EXIT_WINDOW_MS) return 'exit';
  return 'armExit';
}
