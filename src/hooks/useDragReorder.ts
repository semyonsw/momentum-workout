/**
 * Long-press-then-slide reordering, in `PanResponder` and one `Animated.Value`.
 *
 * ── WHY IT IS BUILT THIS WAY ────────────────────────────────────────────────
 *
 * `react-native-gesture-handler` is not a dependency and this is not worth adding
 * one for, so the reorder is plain `PanResponder`, arranged around the one thing
 * that is genuinely awkward without a gesture library: a long press and the slide
 * that follows it are ONE touch, and the press is owned by the row while the slide
 * has to be owned by the list.
 *
 *   1. The long press sets `lifted`. That is a MODE, not a gesture in flight — so
 *      releasing the finger without moving leaves the row in the air rather than
 *      dropping it somewhere the user never chose, and `Drop` in the header is
 *      always a way out.
 *   2. One `PanResponder` wraps the whole list and claims the touch on MOVE, but
 *      only while something is lifted. Before that it claims nothing, so every ✓,
 *      every value cell and the scroll itself behave exactly as they always did.
 *   3. While lifted the caller stops the rows accepting touches (`pointerEvents`)
 *      and stops the ScrollView scrolling, so the two gestures can't fight.
 *   4. The lifted row follows the finger through an `Animated.Value` driven
 *      natively — a `useState` per touch-move would re-render the whole list at
 *      60 Hz to move one row.
 *
 * The drop index is computed from the ROW MIDPOINTS captured on layout, not from a
 * row height: an expanded card is several times the height of a collapsed one, so
 * anything that divides a distance by a constant lands on the wrong row. That
 * arithmetic is `lib/reorder.ts` and not this file — it is the one genuinely tricky
 * calculation in the reorder, it has four edge cases, and none of them can be
 * reached from a test that has to render a screen. What stays here is the gesture.
 *
 * ── PAST THE EDGE OF THE SCREEN ─────────────────────────────────────────────
 *
 * The user still cannot scroll by hand while a row is in the air (point 3), so a
 * caller that passes `autoScroll` gets the list scrolled FOR it: holding the row in
 * the band at the top or bottom of the viewport scrolls continuously, on a
 * `requestAnimationFrame` loop that runs only while something is lifted. The
 * arithmetic — the velocity for a finger position, the clamped next offset, and
 * the one offset that keeps the row under the finger AND the drop index honest
 * while the content moves beneath both — is `lib/reorder.ts`, tested. Without
 * `autoScroll` (the routine editor) a slide still reaches only as far as the
 * finger does, and `Drop` in the header is the way out.
 *
 * The same frame loop also follows the lifted row's own LAYOUT: the session
 * collapses every card on lift, which moves the row the frame after, and the
 * offset it is drawn at is corrected for that rather than leaving it a card's
 * height away from the finger.
 *
 * ── WHY IT IS A HOOK AND NOT A SCREEN'S PRIVATE BUSINESS ────────────────────
 *
 * Both reorderable lists in the app use it: the session's exercise cards and the
 * routine editor's rows. They were two different interactions for two releases — a
 * drag here, lift-then-TAP-a-row there — which meant the same job had two muscle
 * memories depending on which screen you were on. It is one gesture now, and one
 * implementation, because the second copy is how the two drift apart again.
 *
 * The refs are not an optimisation: `PanResponder.create` is called once (its
 * handlers close over whatever was in scope then), so every handler reads the
 * CURRENT lift, target and geometry out of a ref rather than a captured value.
 * Rebuilding the responder on each state change instead would drop the gesture
 * mid-drag, because the responder that was granted the touch is the one that no
 * longer exists.
 *
 * `targetIndex` is state as well as a ref because the header reads it. It only
 * changes when the finger crosses a row's midpoint — a handful of renders per drag
 * rather than one per pixel.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder } from 'react-native';

import { commit, undo } from '../lib/feedback';
import {
  autoScrollVelocity,
  dropIndex,
  effectiveDragDy,
  liftIndex,
  liftedSlotHeight,
  nextScrollOffset,
  rowShift,
  type CardLayout,
  type ScrollViewport,
} from '../lib/reorder';

export type { CardLayout, ScrollViewport };

/**
 * What the hook needs from the caller's ScrollView to scroll it during a drag.
 * Every read is a function because every one of them changes mid-drag.
 */
export interface DragAutoScroll {
  /** The viewport in window coordinates — the finger's `moveY` space. Measured at lift. */
  measureViewport: (done: (viewport: ScrollViewport) => void) => void;
  /** The current scroll offset. Must reflect a `scrollTo` immediately. */
  getOffset: () => number;
  getContentHeight: () => number;
  /** Scroll, unanimated — the frame loop is the animation. */
  scrollTo: (y: number) => void;
}

export interface DragReorder {
  /** The row in the air, or null. */
  lifted: string | null;
  /** Native-driven offset for the lifted row. */
  dragY: Animated.Value;
  /** Where it would land, as an index into the list without it. */
  targetIndex: number;
  panHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
  lift: (id: string) => void;
  drop: () => void;
  /**
   * How far a row that is NOT in the air has to move, in pixels, so the gap the
   * finger is over is actually open. Zero for every row while nothing is lifted.
   *
   * A number rather than an `Animated.Value` per row: the value changes a handful
   * of times per drag (only when the finger crosses a midpoint), and the spring
   * that carries a row there belongs to the row — see `components/ReorderRow.tsx`.
   */
  shiftFor: (id: string) => number;
}

/**
 * @param ids       every row, in list order.
 * @param layouts   a ref the caller fills from each row's `onLayout`, keyed by id.
 *                  Offsets only ever get compared to each other, so any consistent
 *                  origin works — the list wrapper is the natural one.
 * @param move      commit: put `id` at `toIndex`, an index into the list WITHOUT it.
 */
export function useDragReorder(
  ids: readonly string[],
  layouts: React.MutableRefObject<Record<string, CardLayout>>,
  move: (id: string, toIndex: number) => void,
  autoScroll?: DragAutoScroll,
): DragReorder {
  const [lifted, setLifted] = useState<string | null>(null);
  const [targetIndex, setTargetIndex] = useState(0);

  const liftedRef = useRef<string | null>(null);
  const targetRef = useRef(0);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const moveRef = useRef(move);
  moveRef.current = move;

  const autoScrollRef = useRef(autoScroll);
  autoScrollRef.current = autoScroll;

  const dragY = useRef(new Animated.Value(0)).current;

  /*
   * The drag's frame of reference, captured at the lift: where the finger is
   * (null until it first moves), how far it has travelled, the scroll offset and
   * the row's own layout `y` at the lift, and the viewport. See `effectiveDragDy`.
   */
  const gestureDyRef = useRef(0);
  const fingerYRef = useRef<number | null>(null);
  const liftOffsetRef = useRef(0);
  const liftYRef = useRef<number | null>(null);
  const viewportRef = useRef<ScrollViewport | null>(null);
  const frameRef = useRef<number | null>(null);

  const stopFrames = useCallback(() => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  /**
   * Which gap the lifted row is over. The maths is `lib/reorder.ts`.
   *
   * All this does is hand it the four things only a component knows — the current
   * ids, the layouts captured on layout, which row is in the air, and where it came
   * from — and it reads them out of refs so the `PanResponder` built once at mount
   * never sees a stale copy.
   */
  const targetFor = useCallback(
    (dy: number): number => {
      const id = liftedRef.current;
      if (!id) return 0;
      return dropIndex({
        ids: idsRef.current,
        liftedId: id,
        layouts: layouts.current,
        dy,
        fallbackIndex: targetRef.current,
      });
    },
    [layouts],
  );

  /** Re-draw the lifted row and re-aim the gap off the current three terms. */
  const follow = useCallback(() => {
    const id = liftedRef.current;
    if (!id) return;
    const scroll = autoScrollRef.current;
    const dy = effectiveDragDy({
      gestureDy: gestureDyRef.current,
      scrollDelta: scroll ? scroll.getOffset() - liftOffsetRef.current : 0,
      liftY: liftYRef.current,
      currentY: layouts.current[id]?.y ?? null,
    });
    dragY.setValue(dy);
    const next = targetFor(dy);
    if (next !== targetRef.current) {
      targetRef.current = next;
      setTargetIndex(next);
    }
  }, [dragY, layouts, targetFor]);

  /** The frame loop: auto-scroll when the finger is in an edge band, then follow. */
  const startFrames = useCallback(() => {
    stopFrames();
    let last: number | null = null;
    const tick = (now: number) => {
      if (!liftedRef.current) {
        frameRef.current = null;
        return;
      }
      const dt = last == null ? 16 : now - last;
      last = now;
      const scroll = autoScrollRef.current;
      const viewport = viewportRef.current;
      const fingerY = fingerYRef.current;
      if (scroll && viewport && fingerY != null) {
        const velocity = autoScrollVelocity(fingerY, viewport);
        if (velocity !== 0) {
          const offset = scroll.getOffset();
          const next = nextScrollOffset({
            offset,
            velocity,
            dtMs: dt,
            contentHeight: scroll.getContentHeight(),
            viewportHeight: viewport.height,
          });
          if (next !== offset) scroll.scrollTo(next);
        }
      }
      follow();
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [follow, stopFrames]);

  const lift = useCallback(
    (id: string) => {
      commit();
      const index = liftIndex(idsRef.current, id);
      liftedRef.current = id;
      // The row starts where it already is, so its own index is the first target.
      targetRef.current = index;
      gestureDyRef.current = 0;
      fingerYRef.current = null;
      liftYRef.current = layouts.current[id]?.y ?? null;
      const scroll = autoScrollRef.current;
      liftOffsetRef.current = scroll ? scroll.getOffset() : 0;
      viewportRef.current = null;
      scroll?.measureViewport((viewport) => {
        if (liftedRef.current === id) viewportRef.current = viewport;
      });
      setTargetIndex(index);
      setLifted(id);
      dragY.setValue(0);
      startFrames();
    },
    [dragY, layouts, startFrames],
  );

  const drop = useCallback(() => {
    const id = liftedRef.current;
    liftedRef.current = null;
    stopFrames();
    dragY.setValue(0);
    setLifted(null);
    if (!id) return;
    undo();
    moveRef.current(id, targetRef.current);
  }, [dragY, stopFrames]);

  useEffect(() => stopFrames, [stopFrames]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Nothing is claimed until a row is lifted: taps, scrolls and the ✓ all
        // behave exactly as they do when this hook isn't doing anything.
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: () => liftedRef.current != null,
        // Capture, so the list wins the slide even though the row under the finger
        // is what the touch started on.
        onMoveShouldSetPanResponderCapture: () => liftedRef.current != null,
        onPanResponderMove: (_event, gesture) => {
          if (!liftedRef.current) return;
          gestureDyRef.current = gesture.dy;
          fingerYRef.current = gesture.moveY;
          follow();
        },
        onPanResponderRelease: () => drop(),
        // A drag cut short by the OS (a call, a notification shade) still has to put
        // the row down somewhere, and where the finger left it is the only honest
        // answer.
        onPanResponderTerminate: () => drop(),
        onPanResponderTerminationRequest: () => false,
      }),
    [drop, follow],
  );

  /* A row that left the list (removed, or the screen reset) is not liftable. */
  useEffect(() => {
    if (lifted && !ids.includes(lifted)) {
      liftedRef.current = null;
      stopFrames();
      dragY.setValue(0);
      setLifted(null);
    }
  }, [dragY, ids, lifted, stopFrames]);

  /**
   * THE GAP. `rowShift` says which way a row goes and `liftedSlotHeight` says how
   * far; multiplying them here keeps both facts in `lib/reorder.ts` where they are
   * tested, and hands the screen one number it can animate.
   */
  const shiftFor = useCallback(
    (id: string): number => {
      if (!lifted) return 0;
      const direction = rowShift({ ids, liftedId: lifted, targetIndex, id });
      if (direction === 0) return 0;
      return direction * liftedSlotHeight(ids, lifted, layouts.current);
    },
    [ids, layouts, lifted, targetIndex],
  );

  return {
    lifted,
    dragY,
    targetIndex,
    panHandlers: responder.panHandlers,
    lift,
    drop,
    shiftFor,
  };
}
