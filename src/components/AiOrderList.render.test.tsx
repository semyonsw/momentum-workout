import { beforeEach, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';

import type { OrderRow } from '../lib/ai/aiOrder';
import { useSettings } from '../state/settingsStore';
import { AiOrderList } from './AiOrderList';

/**
 * The reorder card's list, as drawn. Where a drop lands is `lib/reorder.ts`'s
 * arithmetic and is tested there; what only a renderer shows is that the rows
 * come out in the PENDING order, that a long press lifts one and tells the chat
 * to stop scrolling, that `Drop` puts it down and tells it again, and that a
 * decided card draws no handle to drag.
 */

const ROWS: OrderRow[] = [
  { key: 'a', ref: 'ex_bench', name: 'Bench press' },
  { key: 'b', ref: 'ex_row', name: 'Cable row' },
  { key: 'c', ref: 'ex_dips', name: 'Dips' },
];

beforeEach(() => {
  useSettings.setState({ language: 'en' });
});

it('draws the rows in the pending order, numbered', () => {
  const view = render(
    <AiOrderList rows={ROWS} order={['c', 'a', 'b']} editable onReorder={jest.fn()} />,
  );
  expect(view.getByLabelText('1. Dips')).toBeTruthy();
  expect(view.getByLabelText('2. Bench press')).toBeTruthy();
  expect(view.getByLabelText('3. Cable row')).toBeTruthy();
  expect(view.getByText('Hold a row, then slide it to change the order.')).toBeTruthy();
});

it('a long press lifts a row and stops the chat scrolling; Drop puts it down', () => {
  const onReorder = jest.fn();
  const onDragging = jest.fn();
  const view = render(
    <AiOrderList
      rows={ROWS}
      order={['a', 'b', 'c']}
      editable
      onReorder={onReorder}
      onDragging={onDragging}
    />,
  );
  act(() => {
    fireEvent(view.getByLabelText('2. Cable row'), 'longPress');
  });
  expect(onDragging).toHaveBeenLastCalledWith(true);
  expect(view.getByText('Moving · Cable row')).toBeTruthy();

  act(() => {
    fireEvent.press(view.getByLabelText('Drop'));
  });
  expect(onDragging).toHaveBeenLastCalledWith(false);
  // Put down where it was lifted: the same order, nothing moved.
  expect(onReorder).toHaveBeenLastCalledWith(['a', 'b', 'c']);
  expect(view.queryByLabelText('Drop')).toBeNull();
});

it('moves one place by the screen reader’s actions', () => {
  const onReorder = jest.fn();
  const view = render(
    <AiOrderList rows={ROWS} order={['a', 'b', 'c']} editable onReorder={onReorder} />,
  );
  fireEvent(view.getByLabelText('1. Bench press'), 'accessibilityAction', {
    nativeEvent: { actionName: 'moveDown' },
  });
  expect(onReorder).toHaveBeenLastCalledWith(['b', 'a', 'c']);
});

it('a decided card is drawn still: no lift, no hint', () => {
  const onDragging = jest.fn();
  const view = render(
    <AiOrderList
      rows={ROWS}
      order={['a', 'b', 'c']}
      editable={false}
      onReorder={jest.fn()}
      onDragging={onDragging}
    />,
  );
  act(() => {
    fireEvent(view.getByLabelText('1. Bench press'), 'longPress');
  });
  expect(view.queryByLabelText('Drop')).toBeNull();
  expect(onDragging).not.toHaveBeenCalledWith(true);
  expect(view.queryByText('Hold a row, then slide it to change the order.')).toBeNull();
});
