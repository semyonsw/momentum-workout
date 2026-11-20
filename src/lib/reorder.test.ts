import { describe, expect, it } from 'vitest';

import {
  AUTO_SCROLL_EDGE,
  AUTO_SCROLL_MAX_SPEED,
  MEASURE_SETTLE_MS,
  anchoredDragDy,
  autoScrollVelocity,
  clampScrollOffset,
  dropIndex,
  effectiveDragDy,
  listTopNow,
  measurementTrusted,
  nextScrollOffset,
  liftIndex,
  liftedSlotHeight,
  moveToIndex,
  rowOffsetMode,
  rowShift,
  type CardLayout,
} from './reorder';

/**
 * The trickiest arithmetic in the app, finally somewhere it can be asked
 * questions.
 *
 * It lived inside `ActiveWorkoutScreen` — whose own header calls the reorder the
 * genuinely awkward part — and none of these four cases can be reached from a test
 * that has to render a screen. The one that matters most is the FIRST: an expanded
 * card is four times the height of a collapsed one, so anything dividing a
 * travelled distance by a constant row height lands on the wrong exercise, and
 * lands further wrong the further you drag.
 */

/** Cards stacked from y = 0, each as tall as the height given. */
function stack(heights: number[]): {
  ids: string[];
  layouts: Record<string, CardLayout>;
} {
  const ids: string[] = [];
  const layouts: Record<string, CardLayout> = {};
  let y = 0;
  heights.forEach((height, i) => {
    const id = `e${i}`;
    ids.push(id);
    layouts[id] = { y, height };
    y += height;
  });
  return { ids, layouts };
}

/** Five collapsed cards, 80 tall: midpoints at 40, 120, 200, 280, 360. */
const collapsed = stack([80, 80, 80, 80, 80]);

const at = (
  fixture: { ids: string[]; layouts: Record<string, CardLayout> },
  liftedId: string,
  dy: number,
) =>
  dropIndex({
    ids: fixture.ids,
    liftedId,
    layouts: fixture.layouts,
    dy,
    fallbackIndex: fixture.ids.indexOf(liftedId),
  });

/* ------------------------------------------------------------------ */

describe('dropIndex', () => {
  it('is a no-op when the card has not moved', () => {
    // Its own index, in the list without it — which is why there is no off-by-one
    // correction anywhere and dropping a card back is free.
    expect(at(collapsed, 'e0', 0)).toBe(0);
    expect(at(collapsed, 'e2', 0)).toBe(2);
    expect(at(collapsed, 'e4', 0)).toBe(4);
  });

  it('counts a card passed once the midpoints cross', () => {
    // e0's centre is 40. e1's is 120, so it takes +81 to pass it.
    expect(at(collapsed, 'e0', 79)).toBe(0);
    expect(at(collapsed, 'e0', 81)).toBe(1);
    expect(at(collapsed, 'e0', 161)).toBe(2);
  });

  it('counts backwards the same way', () => {
    // e4's centre is 360; e3's is 280.
    expect(at(collapsed, 'e4', -79)).toBe(4);
    expect(at(collapsed, 'e4', -81)).toBe(3);
    expect(at(collapsed, 'e4', -400)).toBe(0);
  });

  it('THE EXPANDED CARD CASE: midpoints, not a row height', () => {
    /*
     * One expanded card among four collapsed ones — a header, a nudge, eighteen set
     * rows and a footer against one name and one line of shorthand. Heights
     * 80, 80, 320, 80, 80, so the midpoints are 40, 120, 320, 520, 600.
     *
     * Dragging the FIRST card down by 200 puts its centre at 240: past e1 (120),
     * not past e2 (320), so it lands at index 1. That is the assertion the whole
     * function exists for — 200 dp is two and a half COLLAPSED cards, so any
     * reading that divides the distance by a row height drops it at 2, past the
     * exercise the user was looking at.
     */
    const mixed = stack([80, 80, 320, 80, 80]);
    expect(at(mixed, 'e0', 200)).toBe(1);
    // Two and a half rows of travel, and the answer is still one card.
    expect(Math.round(200 / 80)).toBe(3);

    // Far enough to clear the tall one: centre 40 + 300 = 340 > 320.
    expect(at(mixed, 'e0', 280)).toBe(1);
    expect(at(mixed, 'e0', 300)).toBe(2);

    // Dragging the TALL card up: its centre is 320, e1's is 120, e0's is 40.
    expect(at(mixed, 'e2', -220)).toBe(1);
    expect(at(mixed, 'e2', -300)).toBe(0);
  });

  it('reaches the first position', () => {
    expect(at(collapsed, 'e3', -1000)).toBe(0);
  });

  it('reaches the last position, and does not overshoot it', () => {
    // Four cards without the lifted one, so 4 is the last insert position.
    expect(at(collapsed, 'e1', 1000)).toBe(4);
    expect(at(collapsed, 'e0', 100_000)).toBe(4);
  });

  it('leaves the card alone when its OWN layout has not been measured', () => {
    // No centre to compare with, so no answer that cannot be wrong. The fallback is
    // the index it was lifted from, which makes the drag a no-op rather than a jump.
    const { ids, layouts } = collapsed;
    expect(
      dropIndex({
        ids,
        liftedId: 'e_never_rendered',
        layouts,
        dy: 500,
        fallbackIndex: 2,
      }),
    ).toBe(2);
  });

  it('SKIPS an unmeasured neighbour rather than reading it as y = 0', () => {
    /*
     * `onLayout` has not run for a card that has never been on screen. Treating a
     * missing layout as `y = 0` would put it at the top of the list and drag every
     * drop target up with it — so a drag downwards would report a SMALLER index
     * than the truth.
     */
    const layouts: Record<string, CardLayout | undefined> = { ...collapsed.layouts };
    delete layouts.e1;

    // e0's centre is 40; with e1 gone from the count, only e2 (200) and beyond can
    // be passed. +200 puts the centre at 240, past e2 alone — and NOT at 2, which
    // is what reading the missing layout as y = 0 would have produced.
    expect(
      dropIndex({ ids: collapsed.ids, liftedId: 'e0', layouts, dy: 200, fallbackIndex: 0 }),
    ).toBe(1);
  });

  it('is 0 for a single-card list, whatever the finger does', () => {
    const one = stack([80]);
    expect(at(one, 'e0', 0)).toBe(0);
    expect(at(one, 'e0', 500)).toBe(0);
    expect(at(one, 'e0', -500)).toBe(0);
  });

  it('is 0 for an empty list', () => {
    expect(dropIndex({ ids: [], liftedId: 'e0', layouts: {}, dy: 100, fallbackIndex: 0 })).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

describe('moveToIndex', () => {
  const list = ['a', 'b', 'c', 'd'];
  const move = (id: string, to: number) => moveToIndex(list, (x) => x === id, to);

  it('moves an item to a position in the list WITHOUT it', () => {
    expect(move('a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(move('d', 0)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('is a no-op when the item goes back where it came from', () => {
    // The reason there is no off-by-one correction in either caller.
    expect(move('b', 1)).toEqual(list);
    expect(move('a', 0)).toEqual(list);
    expect(move('d', 3)).toEqual(list);
  });

  it('clamps a drag that ran off either end', () => {
    // Past the last card means the last position, which is what the finger said.
    expect(move('a', 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(move('d', -99)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('returns a copy when the item is not in the list', () => {
    const result = moveToIndex(list, (x) => x === 'z', 1);
    expect(result).toEqual(list);
    expect(result).not.toBe(list);
  });

  it('never mutates the input', () => {
    const original = [...list];
    move('a', 3);
    expect(list).toEqual(original);
  });

  it('handles a one-item and an empty list', () => {
    expect(moveToIndex(['a'], (x) => x === 'a', 0)).toEqual(['a']);
    expect(moveToIndex(['a'], (x) => x === 'a', 5)).toEqual(['a']);
    expect(moveToIndex([], () => true, 0)).toEqual([]);
  });
});

describe('liftIndex', () => {
  it('is where the card sits now', () => {
    expect(liftIndex(['a', 'b', 'c'], 'b')).toBe(1);
  });

  it('is 0 rather than −1 for a card that is not in the list', () => {
    // −1 is an insert position no splice can honour.
    expect(liftIndex(['a', 'b'], 'z')).toBe(0);
    expect(liftIndex([], 'a')).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

/**
 * THE GAP. Which rows move out of the way, and how far.
 *
 * The drag used to move exactly one thing — the card under the finger — and the
 * list rearranged itself on release, so the only way to learn which two exercises
 * you were dropping between was to drop and look. These two functions are what
 * opens the gap while the finger is still over it; the spring that carries a row
 * there is `components/ReorderRow.tsx` and has nothing to decide.
 *
 * The direction is ±1 and the distance is the lifted row's own slot, because every
 * row the lifted one passes moves by exactly the space it vacated — whatever that
 * row's own height is. That is the same reason `dropIndex` compares midpoints.
 */
describe('rowShift', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('is zero for every row while the card is over its own place', () => {
    // `b` lifted from index 1, pointing at index 1: nothing has to move.
    for (const id of ids) expect(rowShift({ ids, liftedId: 'b', targetIndex: 1, id })).toBe(0);
  });

  it('moves the rows it passes UP when the card is dragged down', () => {
    // `b` (index 1) heading for index 3 — past `c` and `d`.
    expect(rowShift({ ids, liftedId: 'b', targetIndex: 3, id: 'c' })).toBe(-1);
    expect(rowShift({ ids, liftedId: 'b', targetIndex: 3, id: 'd' })).toBe(-1);
    // `a` is above the lift and above the target: it never moves.
    expect(rowShift({ ids, liftedId: 'b', targetIndex: 3, id: 'a' })).toBe(0);
  });

  it('moves the rows it passes DOWN when the card is dragged up', () => {
    // `d` (index 3) heading for the top.
    expect(rowShift({ ids, liftedId: 'd', targetIndex: 0, id: 'a' })).toBe(1);
    expect(rowShift({ ids, liftedId: 'd', targetIndex: 0, id: 'b' })).toBe(1);
    expect(rowShift({ ids, liftedId: 'd', targetIndex: 0, id: 'c' })).toBe(1);
  });

  it('moves only the rows between the lift and the target', () => {
    // `a` (index 0) heading for index 2: `b` and `c` step up, `d` is untouched.
    expect(rowShift({ ids, liftedId: 'a', targetIndex: 2, id: 'b' })).toBe(-1);
    expect(rowShift({ ids, liftedId: 'a', targetIndex: 2, id: 'c' })).toBe(-1);
    expect(rowShift({ ids, liftedId: 'a', targetIndex: 2, id: 'd' })).toBe(0);
  });

  it('never moves the lifted row itself — that one follows the finger', () => {
    expect(rowShift({ ids, liftedId: 'b', targetIndex: 3, id: 'b' })).toBe(0);
  });

  it('is zero for rows and lifts that are not in the list', () => {
    expect(rowShift({ ids, liftedId: 'z', targetIndex: 0, id: 'a' })).toBe(0);
    expect(rowShift({ ids, liftedId: 'a', targetIndex: 3, id: 'z' })).toBe(0);
  });
});

describe('liftedSlotHeight', () => {
  it('is the distance to the next row, so the gap matches the space vacated', () => {
    // 80-tall rows with a 4px gap between them: the slot is 84, not 80.
    const ids = ['a', 'b', 'c'];
    const layouts: Record<string, CardLayout> = {
      a: { y: 0, height: 80 },
      b: { y: 84, height: 80 },
      c: { y: 168, height: 80 },
    };
    expect(liftedSlotHeight(ids, 'a', layouts)).toBe(84);
    expect(liftedSlotHeight(ids, 'b', layouts)).toBe(84);
  });

  it('measures upwards for the last row, which has nothing below it', () => {
    const ids = ['a', 'b'];
    const layouts: Record<string, CardLayout> = {
      a: { y: 0, height: 80 },
      b: { y: 84, height: 200 },
    };
    // Its own slot, read from where it starts relative to the row above.
    expect(liftedSlotHeight(ids, 'b', layouts)).toBe(84);
  });

  it("falls back to the row's own height when it has no measured neighbour", () => {
    expect(liftedSlotHeight(['a'], 'a', { a: { y: 0, height: 80 } })).toBe(80);
  });

  it('is zero for an unmeasured row, so nothing moves on a guess', () => {
    expect(liftedSlotHeight(['a', 'b'], 'a', { b: { y: 84, height: 80 } })).toBe(0);
  });
});

/**
 * ── AND EVERY ROW GOES BACK WHERE THE LAYOUT PUTS IT ───────────────────────
 *
 * The gap is supposed to exist only while a finger is holding a row in the air.
 * One that outlived the drop is the bug the routine editor and the session both
 * had: a hole between two exercises, and the last row drawn over the footer.
 */
describe('a row after the drop', () => {
  it('carries no offset at all once nothing is lifted', () => {
    expect(rowOffsetMode(false, false)).toBe('none');
  });

  it('follows the finger while it is the row in the air', () => {
    expect(rowOffsetMode(true, true)).toBe('finger');
  });

  it('moves by a slot while some other row is up', () => {
    expect(rowOffsetMode(false, true)).toBe('slot');
  });
});

/* ------------------------------------------------------------------ */
/* Dragging past the edge                                              */
/* ------------------------------------------------------------------ */

describe('auto-scroll while a card is in the air', () => {
  const viewport = { top: 100, height: 600 }; // 100..700

  it('is still in the calm middle', () => {
    expect(autoScrollVelocity(400, viewport)).toBe(0);
    expect(autoScrollVelocity(100 + AUTO_SCROLL_EDGE, viewport)).toBe(0);
  });

  it('scrolls up near the top and down near the bottom, faster deeper in', () => {
    const shallow = autoScrollVelocity(100 + AUTO_SCROLL_EDGE - 10, viewport);
    const deep = autoScrollVelocity(105, viewport);
    expect(shallow).toBeLessThan(0);
    expect(deep).toBeLessThan(shallow);
    expect(autoScrollVelocity(690, viewport)).toBeGreaterThan(0);
  });

  it('runs at full speed past the edge, never faster', () => {
    expect(autoScrollVelocity(20, viewport)).toBe(-AUTO_SCROLL_MAX_SPEED);
    expect(autoScrollVelocity(900, viewport)).toBe(AUTO_SCROLL_MAX_SPEED);
  });

  it('keeps a calm middle on a short viewport, and does nothing unmeasured', () => {
    expect(autoScrollVelocity(150, { top: 100, height: 150 })).toBe(0);
    expect(autoScrollVelocity(110, { top: 100, height: 0 })).toBe(0);
    expect(autoScrollVelocity(Number.NaN, viewport)).toBe(0);
  });

  it('clamps the next offset to the content it has', () => {
    const base = { contentHeight: 2000, viewportHeight: 600, dtMs: 16 };
    expect(nextScrollOffset({ ...base, offset: 0, velocity: -900 })).toBe(0);
    expect(nextScrollOffset({ ...base, offset: 1400, velocity: 900 })).toBe(1400);
    expect(nextScrollOffset({ ...base, offset: 500, velocity: 1000 })).toBeCloseTo(516);
    // A long-stalled frame does not fling the list.
    expect(nextScrollOffset({ ...base, offset: 500, velocity: 1000, dtMs: 5000 })).toBeCloseTo(564);
    // Content shorter than the viewport cannot scroll at all.
    expect(nextScrollOffset({ ...base, contentHeight: 300, offset: 0, velocity: 900 })).toBe(0);
  });

  it('adds the scroll and the layout shift to the finger, so the drop index follows them', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const layouts: Record<string, CardLayout> = Object.fromEntries(
      ids.map((id, i) => [id, { y: i * 80, height: 72 }]),
    );
    // 'e' held still at the top edge while the list scrolled up 400: it is now above 'a'.
    const dy = effectiveDragDy({ gestureDy: -40, scrollDelta: -400, liftY: 320, currentY: 320 });
    expect(dropIndex({ ids, liftedId: 'e', layouts, dy, fallbackIndex: 4 })).toBe(0);
    // A card that jumped up 300 when the open card above it collapsed is put back
    // under the finger, not a card's height away from it.
    expect(effectiveDragDy({ gestureDy: 0, scrollDelta: 0, liftY: 620, currentY: 320 })).toBe(300);
    expect(effectiveDragDy({ gestureDy: 12, scrollDelta: 0, liftY: null, currentY: 320 })).toBe(12);
  });
});

/* ------------------------------------------------------------------ */
/* Anchored on the finger                                              */
/* ------------------------------------------------------------------ */

/*
 * The phone bug: lift a row and it hangs 5–10 cm off the finger for the whole
 * drag. Every case below is a way the screen moved the LIST on the lift that the
 * old three-term prediction could not see. Window coordinates throughout: the
 * viewport starts at 100, rows are 64 tall and stacked from the list's top.
 */
describe('the lifted row stays under the finger', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const stacked = (): Record<string, CardLayout> =>
    Object.fromEntries(ids.map((id, i) => [id, { y: i * 64, height: 64 }]));

  /** Where the row is DRAWN in the window: its layout top plus the offset. */
  const drawnTop = (listTop: number, rowY: number, dy: number) => listTop + rowY + dy;

  it('does not move when the content ABOVE the list hides on lift', () => {
    // Routine editor: the list starts at 260 with the name field above it; the
    // lift hides the field and a margin, and the list jumps up to 140.
    const layouts = stacked();
    const liftTop = 260 + layouts.d.y;
    const dy = anchoredDragDy({ liftTop, gestureDy: 0, listTop: 140, rowY: layouts.d.y });
    expect(drawnTop(140, layouts.d.y, dy)).toBe(liftTop);
    // The old prediction saw no layout shift (the row's y within the list is
    // unchanged) and left the row 120 dp off — the reported bug.
    const old = effectiveDragDy({ gestureDy: 0, scrollDelta: 0, liftY: 192, currentY: 192 });
    expect(drawnTop(140, layouts.d.y, old)).toBe(liftTop - 120);
    // And the drop index, handed the same number, says where the row is DRAWN:
    // the list slid 120 up under a still finger, so the row is now over 'e'.
    expect(dy).toBe(120);
    expect(dropIndex({ ids, liftedId: 'd', layouts, dy, fallbackIndex: 3 })).toBe(4);
  });

  it('does not move when shrinking content clamps the scroll', () => {
    // Scrolled 600 down; the lift hides 400 dp of buttons below the list, the
    // platform pulls the scroll back to 200 — and nobody called scrollTo, so no
    // offset tracker knows. The list moved DOWN 400 in the window.
    const rowY = 5 * 64;
    const liftTop = 100 - 600 + 80 + rowY;
    const listTop = 100 - 200 + 80;
    const dy = anchoredDragDy({ liftTop, gestureDy: 0, listTop, rowY });
    expect(dy).toBe(-400);
    expect(drawnTop(listTop, rowY, dy)).toBe(liftTop);
  });

  it('follows the finger exactly, through a collapse above the row', () => {
    // The session: an open card above collapses on lift, the row jumps up 900
    // within the list AND the scroll clamps by 700. Only the sum is measured.
    const liftTop = 100 - 1500 + 1800;
    const listTop = 100 - 800;
    const rowY = 900;
    for (const gestureDy of [-150, 0, 37, 220]) {
      const dy = anchoredDragDy({ liftTop, gestureDy, listTop, rowY });
      expect(drawnTop(listTop, rowY, dy)).toBe(liftTop + gestureDy);
    }
  });

  it('keeps the row under a still finger while the hook scrolls the list', () => {
    // Measured at rest: list top 40, offset 300. The hook then scrolls up 250.
    const measured = { measuredTop: 40, offsetAtMeasure: 300 };
    const listTop = listTopNow({ ...measured, offsetNow: 50 });
    expect(listTop).toBe(290); // content came down 250
    const layouts = stacked();
    const liftTop = 40 + layouts.f.y; // lifted at rest, finger never moved
    const dy = anchoredDragDy({ liftTop, gestureDy: 0, listTop, rowY: layouts.f.y });
    expect(drawnTop(listTop, layouts.f.y, dy)).toBe(liftTop);
    // 250 dp of content passed under it: the centre of 'f' (352) is now at 102,
    // past only 'a' and 'b' (midpoints 32 and 96) — it lands at index 2.
    expect(dropIndex({ ids, liftedId: 'f', layouts, dy, fallbackIndex: 5 })).toBe(2);
  });

  it('believes a measurement only once the hook has stopped scrolling', () => {
    expect(measurementTrusted(1000, null)).toBe(true);
    expect(measurementTrusted(1000, 1000 - MEASURE_SETTLE_MS + 1)).toBe(false);
    expect(measurementTrusted(1000, 1000 - MEASURE_SETTLE_MS)).toBe(true);
  });

  it('clamps a stale tracked offset to the content that is left', () => {
    // 1500 tracked, content collapsed to 800 in a 700 viewport: the platform is at 100.
    expect(clampScrollOffset(1500, 800, 700)).toBe(100);
    expect(clampScrollOffset(50, 800, 700)).toBe(50);
    expect(clampScrollOffset(-20, 800, 700)).toBe(0);
    // Shorter than the viewport: nothing to scroll.
    expect(clampScrollOffset(300, 500, 700)).toBe(0);
    // Unmeasured: trust the tracker rather than zeroing it.
    expect(clampScrollOffset(300, 0, 700)).toBe(300);
  });
});
