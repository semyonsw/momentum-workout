/**
 * What can be found without being told (U11, U15, U23, U24).
 *
 * Four rules, and each one is a decision about where a control is SEEN, not
 * about what it does — every action here existed before this file did.
 *
 * ── A LONG PRESS ALWAYS HAS A MARK ────────────────────────────────────────
 *
 * Holding is the app's gesture for "the other thing about this" (moving a card,
 * the die's options), and it was invisible: nothing on a card said a hold would
 * do anything. So every surface that answers a hold now carries a mark, and
 * where the mark can be a target it IS one, opening exactly what the hold opens:
 *
 *   • the die shows a `⋮` beside it that opens the options sheet;
 *   • a reorderable exercise card shows a grip. That one is only a mark: a
 *     reorder is a drag, and a drag cannot be started by a tap.
 *
 * `holdActions` and `cueActions` are two functions on purpose, though for now
 * they agree everywhere: the screens open their menus through them, and the
 * test that asserts they agree is what stops a later row being added to one
 * gesture and not the other. Rejected: an "ⓘ hold for more" hint line under each
 * surface (a sentence nobody reads twice, on every screen) and moving the hold
 * actions to a settings screen (further from the thing they act on).
 *
 * ── DELETE IS A MODE IN THE PICKER, NOT A MARK ON EVERY ROW ───────────────
 *
 * The add-exercise picker drew a `−` on every row, and in a list you are PICKING
 * from, a minus reads as "deselect". Deleting an exercise is the rare act and
 * edits every routine holding it, so it moved behind an `Edit` in the header:
 * while editing, each row shows a bin and a tap on the row picks nothing; out of
 * it, rows only pick. The confirmation sheet is unchanged — it is the parent's,
 * and it already asks (an exercise delete is not undoable from a toast, because
 * it reaches into routines).
 *
 * ── ONE DOOR FOR ROUTINES AND EXERCISES ───────────────────────────────────
 *
 * The workout corner had ≡ and 📖, two unlabelled glyphs that look alike and
 * lead to two halves of one question — "what can I train". They are one
 * destination now, `Routines & exercises`, with a Routines | Exercises switch in
 * its header; the corner reads ✦, that door, then ⟲ last. Rejected: one long
 * screen with both lists (the library is a tree you open and would push the
 * routines a screen away from their own header), and keeping two glyphs with
 * captions (the corner is icons only, see `SectionTopBar`).
 *
 * ── A SECTION'S SETTINGS ARE AT THE FOOT OF ITS HISTORY ───────────────────
 *
 * The settings that shape the training (rest times, plates, weekly targets)
 * were reachable only from Settings → a row. The history is where you notice
 * one of them is wrong, so its foot carries `Settings ›`, to `workoutSettings`.
 */

/* ------------------------------------------------------------------ */
/* The add-exercise picker and the library (U15)                       */
/* ------------------------------------------------------------------ */

/** What one exercise row offers. */
export interface ExerciseRowControls {
  /** A tap on the row picks it (adds it, or opens it in the library). */
  pick: boolean;
  /** The bin at the row's end. */
  remove: boolean;
}

/**
 * Out of edit mode a row only picks; in it, a row only deletes. Never both: a
 * pick and a delete one mis-tap apart is the thing this replaces.
 */
export function exerciseRowControls(editing: boolean): ExerciseRowControls {
  return editing ? { pick: false, remove: true } : { pick: true, remove: false };
}

/* ------------------------------------------------------------------ */
/* Long-press surfaces and their visible marks (U11)                   */
/* ------------------------------------------------------------------ */

export type HoldSurface = 'exerciseCard' | 'routineDie';

export const HOLD_SURFACES: readonly HoldSurface[] = ['exerciseCard', 'routineDie'];

export type HoldAction =
  /** Lift the card and slide it. */
  | 'reorder'
  /** The die's "what goes in it" sheet. */
  | 'dieOptions';

/** What holding the surface offers, in menu order. */
export function holdActions(surface: HoldSurface): HoldAction[] {
  switch (surface) {
    case 'exerciseCard':
      return ['reorder'];
    case 'routineDie':
      return ['dieOptions'];
  }
}

/** The glyph that says "this answers a hold". */
export type HoldCue = 'grip' | 'options';

export function holdCue(surface: HoldSurface): HoldCue {
  switch (surface) {
    case 'exerciseCard':
      return 'grip';
    case 'routineDie':
      return 'options';
  }
}

/**
 * Whether the mark is a target. A grip is not: a reorder is a drag, and a tap
 * cannot start one.
 */
export function cueIsTappable(surface: HoldSurface): boolean {
  return holdCue(surface) !== 'grip';
}

/**
 * What tapping the mark offers — the hold's actions, every one of them, or
 * nothing for a mark that is not a target.
 */
export function cueActions(surface: HoldSurface): HoldAction[] {
  return cueIsTappable(surface) ? holdActions(surface) : [];
}

/* ------------------------------------------------------------------ */
/* The workout corner and its merged destination (U23)                */
/* ------------------------------------------------------------------ */

/** The workout corner, left to right, before the ⟲ (which is always last). */
export const WORKOUT_CORNER = ['ai', 'library'] as const;

/** The two halves of `Routines & exercises`. */
export type LibraryTab = 'routines' | 'exercises';

export const LIBRARY_TABS: readonly LibraryTab[] = ['routines', 'exercises'];

/** The pushed route each half is. The switch replaces one with the other. */
export function libraryTabRoute(tab: LibraryTab): 'routines' | 'library' {
  return tab === 'routines' ? 'routines' : 'library';
}
