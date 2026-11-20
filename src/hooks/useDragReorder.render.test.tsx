import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { useRef } from 'react';
import { Text, View } from 'react-native';

import { type CardLayout, type DragReorder, useDragReorder } from './useDragReorder';

/**
 * The lifted row on the phone hung 5–10 cm off the finger: the screen moved the
 * LIST on the lift (a name field above it unmounted, a scroll was clamped) and the
 * hook only knew about the row's position inside it. `lib/reorder.ts` tests the
 * arithmetic; what only a renderer shows is that the hook really measures the list
 * at the lift — before the screen reacts — and again on the frames after, and draws
 * the row off those measurements. The list's window top is the stub below.
 */

type Measure = (cb: (x: number, y: number, w: number, h: number) => void) => void;

let listTop = 260;
let reorder: DragReorder;

const ids = ['a', 'b', 'c', 'd'];

function Harness({ anchored }: { anchored: boolean }) {
  const layouts = useRef<Record<string, CardLayout>>(
    Object.fromEntries(ids.map((id, i) => [id, { y: i * 64, height: 64 }])),
  );
  reorder = useDragReorder(ids, layouts, () => {});
  return (
    <View
      ref={(node) => {
        reorder.listRef.current = node;
        if (node && anchored) {
          (node as unknown as { measureInWindow: Measure }).measureInWindow = (cb) =>
            cb(0, listTop, 360, ids.length * 64);
        }
      }}
    >
      <Text>{reorder.lifted ?? 'none'}</Text>
    </View>
  );
}

const offset = () => (reorder.dragY as unknown as { __getValue: () => number }).__getValue();

beforeEach(() => {
  jest.useFakeTimers();
  listTop = 260;
});

afterEach(() => {
  act(() => reorder.drop());
  jest.useRealTimers();
});

it('keeps the lifted row where it was when the list moves up under it', () => {
  render(<Harness anchored />);
  act(() => reorder.lift('c'));
  // The screen hides 120 dp above the list in reaction to the lift.
  listTop = 140;
  act(() => jest.advanceTimersByTime(50));
  // Drawn 120 below its new slot: exactly where it was, under a still finger.
  expect(offset()).toBe(120);
  // And the drop target follows where it is drawn, not where it is laid out.
  expect(reorder.targetIndex).toBe(3);
});

it('keeps it there when a clamped scroll moves the list down', () => {
  render(<Harness anchored />);
  act(() => reorder.lift('b'));
  listTop = 660;
  act(() => jest.advanceTimersByTime(50));
  expect(offset()).toBe(-400);
});

it('falls back to the old prediction for a list that is not measured', () => {
  render(<Harness anchored={false} />);
  act(() => reorder.lift('c'));
  listTop = 140;
  act(() => jest.advanceTimersByTime(50));
  expect(offset()).toBe(0);
});
