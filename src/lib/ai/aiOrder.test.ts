import { describe, expect, it } from 'vitest';

import {
  isPermutationOf,
  moveKey,
  orderRoutineItems,
  orderTokens,
  orderedRows,
  resolveOrder,
  sanitizeOrderChange,
  sequenceSwaps,
  type OrderRow,
} from './aiOrder';
import type { RoutineItem } from '../../types/models';

/**
 * A whole new order, from what a model writes to the moves the stores make.
 * The rules worth pinning are the ones a model trips: a subset, a repeat, a
 * name instead of an id, an order that changes nothing — and, on the way out,
 * that the loop's cursor stays on its step through the swaps.
 */

const ROUTINE: OrderRow[] = [
  { key: 'i_bench', ref: 'ex_bench', name: 'Bench press' },
  { key: 'i_row', ref: 'ex_row', name: 'Cable row' },
  { key: 'i_dips', ref: 'ex_dips', name: 'Dips' },
  { key: 'i_squat', ref: 'ex_squat', name: 'Squat' },
];

/** Push, Pull, Legs, Push — the loop holds Push twice. */
const LOOP: OrderRow[] = [
  { key: '0', ref: 'r_push', name: 'Push' },
  { key: '1', ref: 'r_pull', name: 'Pull' },
  { key: '2', ref: 'r_legs', name: 'Legs' },
  { key: '3', ref: 'r_push', name: 'Push' },
];

describe('reading the order a model wrote', () => {
  it('takes a whole permutation of ids as it is', () => {
    expect(resolveOrder(ROUTINE, ['ex_squat', 'ex_bench', 'ex_row', 'ex_dips'])).toEqual([
      'i_squat',
      'i_bench',
      'i_row',
      'i_dips',
    ]);
  });

  it('puts what it named first and the rest after, in their current order', () => {
    // "Put squats first" — the subset a model writes when it forgets the rest.
    expect(resolveOrder(ROUTINE, ['ex_squat'])).toEqual(['i_squat', 'i_bench', 'i_row', 'i_dips']);
    expect(resolveOrder(ROUTINE, ['ex_dips', 'ex_row'])).toEqual([
      'i_dips',
      'i_row',
      'i_bench',
      'i_squat',
    ]);
  });

  it('reads a name, in any case, when the model wrote one instead of an id', () => {
    expect(resolveOrder(ROUTINE, ['squat', 'BENCH PRESS', ' cable  row '])).toEqual([
      'i_squat',
      'i_bench',
      'i_row',
      'i_dips',
    ]);
  });

  it('reads a 1-based place in the current list', () => {
    expect(resolveOrder(ROUTINE, [4, '3', 1, 2])).toEqual([
      'i_squat',
      'i_dips',
      'i_bench',
      'i_row',
    ]);
    expect(resolveOrder(ROUTINE, [0, 9, 4])).toEqual(['i_squat', 'i_bench', 'i_row', 'i_dips']);
  });

  it('skips an unknown name or a repeat, and keeps the order it could read', () => {
    expect(resolveOrder(ROUTINE, ['ex_ghost', 'ex_squat', 'ex_squat', null, 7.5, ''])).toEqual([
      'i_squat',
      'i_bench',
      'i_row',
      'i_dips',
    ]);
  });

  it('is no change when nothing was named, or the order is the saved one', () => {
    expect(resolveOrder(ROUTINE, ['ex_ghost', 'nobody'])).toBeNull();
    expect(resolveOrder(ROUTINE, [])).toBeNull();
    expect(resolveOrder(ROUTINE, ['ex_bench', 'ex_row', 'ex_dips', 'ex_squat'])).toBeNull();
    // A subset that already leads is the saved order too.
    expect(resolveOrder(ROUTINE, ['ex_bench'])).toBeNull();
  });

  it('matches a repeated routine to its steps in their current order', () => {
    // Legs first, then both Pushes, then Pull: the first Push named is step 1.
    expect(resolveOrder(LOOP, ['r_legs', 'r_push', 'r_push', 'r_pull'])).toEqual([
      '2',
      '0',
      '3',
      '1',
    ]);
    // Push named once: the other Push is a step left out, so it goes after.
    expect(resolveOrder(LOOP, ['r_pull', 'r_push'])).toEqual(['1', '0', '2', '3']);
    // Named three times: the third has no step left and is skipped.
    expect(resolveOrder(LOOP, ['r_push', 'r_push', 'r_push', 'r_legs', 'r_pull'])).toEqual([
      '0',
      '3',
      '2',
      '1',
    ]);
  });

  it('takes the list under any key a model uses, or a comma string', () => {
    expect(orderTokens({ order: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(orderTokens({ exerciseIds: ['a'] })).toEqual(['a']);
    expect(orderTokens({ routineIds: ['r'] })).toEqual(['r']);
    expect(orderTokens({ text: 'Squat, Bench press → Row' })).toEqual([
      'Squat',
      'Bench press',
      'Row',
    ]);
    expect(orderTokens({})).toEqual([]);
  });
});

describe('a stored order', () => {
  it('is every key once and nothing else', () => {
    const keys = ['a', 'b', 'c'];
    expect(isPermutationOf(keys, ['c', 'a', 'b'])).toBe(true);
    expect(isPermutationOf(keys, ['a', 'b'])).toBe(false);
    expect(isPermutationOf(keys, ['a', 'a', 'b'])).toBe(false);
    expect(isPermutationOf(keys, ['a', 'b', 'x'])).toBe(false);
    expect(isPermutationOf(keys, ['a', 'b', 3])).toBe(false);
  });

  it('is drawn in the pending order, skipping keys the rows do not know', () => {
    expect(
      orderedRows({ rows: ROUTINE, order: ['i_dips', 'i_ghost', 'i_bench'] }).map((r) => r.name),
    ).toEqual(['Dips', 'Bench press']);
  });

  it('comes back from storage only as a permutation of its own rows', () => {
    const good = {
      target: 'order',
      field: 'reorder',
      list: 'sequence',
      id: '',
      name: '',
      rows: LOOP,
      order: ['3', '2', '1', '0'],
    };
    expect(sanitizeOrderChange(good)).toEqual(good);
    expect(sanitizeOrderChange({ ...good, order: ['3', '2', '1'] })).toBeNull();
    expect(sanitizeOrderChange({ ...good, list: 'tasks' })).toBeNull();
    expect(sanitizeOrderChange({ ...good, rows: [...LOOP, LOOP[0]] })).toBeNull();
    expect(sanitizeOrderChange({ ...good, rows: [{ key: '0' }] })).toBeNull();
  });
});

describe('the drag on the card', () => {
  it('moves a key to an index of the list without it', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(moveKey(order, 'a', 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveKey(order, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveKey(order, 'b', 1)).toEqual(order);
    expect(moveKey(order, 'c', 99)).toEqual(['a', 'b', 'd', 'c']);
    expect(moveKey(order, 'zz', 0)).toEqual(order);
  });
});

describe('applying', () => {
  const item = (id: string, order: number): RoutineItem => ({
    id,
    exerciseId: `ex_${id}`,
    order,
    targetSets: 3,
  });

  it('a routine: the named rows in order, then any the card never saw, renumbered', () => {
    const items = [item('a', 0), item('b', 1), item('c', 2), item('new', 3)];
    const next = orderRoutineItems(items, ['c', 'gone', 'a', 'b']);
    expect(next.map((i) => `${i.order}:${i.id}`)).toEqual(['0:c', '1:a', '2:b', '3:new']);
  });

  /** `moveSequenceStep`, as the store does it — the cursor follows its step. */
  function play(steps: string[], cursor: number, swaps: { index: number; direction: -1 | 1 }[]) {
    const ids = [...steps];
    let at = cursor;
    for (const { index, direction } of swaps) {
      const target = index + direction;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      at = at === index ? target : at === target ? index : at;
    }
    return { ids, cursor: at };
  }

  it('the loop: swaps that land every step, the cursor riding along', () => {
    const steps = ['push', 'pull', 'legs', 'push2'];
    const order = ['2', '0', '3', '1'];
    const swaps = sequenceSwaps(4, order)!;
    // Cursor on Pull (step 1): Pull ends last, and stays next.
    expect(play(steps, 1, swaps)).toEqual({ ids: ['legs', 'push', 'push2', 'pull'], cursor: 3 });
    expect(sequenceSwaps(4, ['0', '1', '2', '3'])).toEqual([]);
  });

  it('the loop: nothing, when it no longer has the steps the card counted', () => {
    expect(sequenceSwaps(3, ['2', '0', '3', '1'])).toBeNull();
    expect(sequenceSwaps(4, ['2', '0', '0', '1'])).toBeNull();
  });

  it('the loop: every permutation of four comes out right', () => {
    const perms = (xs: string[]): string[][] =>
      xs.length <= 1
        ? [xs]
        : xs.flatMap((x) => perms(xs.filter((y) => y !== x)).map((p) => [x, ...p]));
    const steps = ['a', 'b', 'c', 'd'];
    for (const order of perms(['0', '1', '2', '3'])) {
      const { ids } = play(steps, 0, sequenceSwaps(4, order)!);
      expect(ids).toEqual(order.map((k) => steps[Number(k)]));
    }
  });
});
