/**
 * The ScrollView half of a drag-reorder: what `useDragReorder` needs to scroll a
 * list FOR the user while a row is in the air.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 *
 * A lifted row turns the ScrollView's own scrolling off (the two gestures would
 * fight), so a list taller than the screen can only be reordered as far as the
 * finger reaches — unless the list scrolls itself. The session had that; the
 * routine editor and the training sequence did not, and on the phone that read as
 * "dragging up, the finger hits the top of the screen with the row still
 * mid-list". The wiring was one screen's private code (an offset ref, a content
 * height ref, a viewport box, a `scrollTo`), and a second and third copy is how
 * they drift apart, so it is one hook every drag list uses.
 *
 * The offset is tracked here and set the instant the hook scrolls — not when the
 * scroll event comes back — because the drag is only right if it knows how far
 * the content under the finger has moved THIS frame.
 *
 * Usage: wrap the ScrollView in `<View ref={viewportRef} collapsable={false}
 * style={{ flex: 1 }}>`, give the ScrollView `ref={scrollRef}`, `onScroll`,
 * `scrollEventThrottle={16}` and `onContentSizeChange`, and hand `autoScroll` to
 * `useDragReorder`. A screen that already owns a ScrollView ref passes it in.
 */

import { useCallback, useMemo, useRef, type RefObject } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView, View } from 'react-native';

import type { DragAutoScroll } from './useDragReorder';

export interface DragAutoScrollWiring {
  scrollRef: RefObject<ScrollView | null>;
  /** The box the ScrollView fills — measured as the viewport. */
  viewportRef: RefObject<View | null>;
  autoScroll: DragAutoScroll;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onContentSizeChange: (width: number, height: number) => void;
}

export function useDragAutoScroll(scrollRef?: RefObject<ScrollView | null>): DragAutoScrollWiring {
  const ownRef = useRef<ScrollView>(null);
  const ref = scrollRef ?? ownRef;
  const viewportRef = useRef<View>(null);
  const offset = useRef(0);
  const contentHeight = useRef(0);

  const autoScroll = useMemo<DragAutoScroll>(
    () => ({
      measureViewport: (done) =>
        viewportRef.current?.measureInWindow((_x, y, _w, height) => done({ top: y, height })),
      getOffset: () => offset.current,
      getContentHeight: () => contentHeight.current,
      scrollTo: (y) => {
        offset.current = y;
        ref.current?.scrollTo({ y, animated: false });
      },
    }),
    [ref],
  );

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
  }, []);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    contentHeight.current = height;
  }, []);

  return { scrollRef: ref, viewportRef, autoScroll, onScroll, onContentSizeChange };
}
