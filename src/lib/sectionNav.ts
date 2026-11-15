/**
 * The four roots — the training, the routines, the past and Settings — and the
 * gestures between them.
 *
 *   Workout · Routines · History · Settings
 *
 * ── WHY FOUR (4.0) ─────────────────────────────────────────────────────────
 *
 * From 3.0 to 4.0 there were two roots, and the routines and the history sat
 * behind captioned glyphs in the Workout corner. Every one of them worked, and
 * a newcomer still had to be told where "my routines" lived: a glyph in a corner
 * is a thing you learn, a named slot at the bottom is a thing you see. The four
 * places a user goes are the four places the bar names. Rejected: a fifth slot
 * for the exercise library (it is a half of Routines, behind the switch the
 * routine list already had — what can I train is one question) and keeping the
 * corner glyphs as well (two doors to one room is the clutter this removed).
 *
 * ── WHY THE ORDER IS A CONSTANT AND NOT A TAB BAR DETAIL ───────────────────
 *
 * The order is more than layout: a slide between two goes the way the bar's
 * blob does (`navigation/ShellStage.tsx`), and the spares are built along it
 * (`lib/stageBuilds.ts`). Two places deciding which side Settings is on is two
 * places for them to disagree, so the order lives here and all of them read it.
 */

export const SECTIONS = ['Workout', 'Routines', 'History', 'Settings'] as const;

export type SectionTab = (typeof SECTIONS)[number];

/* ══════════════════════════════════════════════════════════════════════════
   THE ROOTS — and the gestures between them.

     Root ◀──tap nav / back──▶ Workout
       │  ▲
       push  back / edge
       ▼  │
     Inner screen

   The training IS the landing — the thing you open the app to see — so it is
   the root Back returns to from the other three, Back on it arms the exit, and
   a route is exactly a section.
   ══════════════════════════════════════════════════════════════════════════ */

export type ShellRoute = SectionTab;

/** Where the app opens, and where Back from anywhere else in it lands. */
export const SHELL_ROOT: SectionTab = 'Workout';

/**
 * The nav bar's slot centres for the sections it shows, as fractions of the
 * bar's width: evenly spaced, each in the middle of its own share.
 *
 * Four slots land at 1/8, 3/8, 5/8 and 7/8 — each glyph centred in the quarter
 * it owns, with no gap left for the raised Home button the 2.x bar had (a hole
 * in the middle reads as something missing). Fractions, so a 340 dp bar keeps
 * its proportions.
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
 * screen pops, then any root but the training goes back to it (`root`) — not
 * to the tab before, since a back that walks the tab history is a back nobody
 * can predict — and there the first press arms an exit (a toast says so) and a
 * second within two seconds leaves.
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
