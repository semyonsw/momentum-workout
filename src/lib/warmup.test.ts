/**
 * The warm-up toggle's arithmetic — the weight it picks, and which way the toggle
 * goes. The store-level promise (logging one leaves the working sets alone) is in
 * `state/warmupAndMaxTest.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import type { DraftSet } from './draft';
import { toggleWarmupSets, warmupToggleState, warmupWeight } from './warmup';

function row(localId: string, extra: Partial<DraftSet> = {}): DraftSet {
  return {
    localId,
    weightKg: 80,
    count: 8,
    isWarmup: false,
    isCompleted: false,
    completedAt: null,
    isPrefilled: true,
    ...extra,
  };
}

const external = { requiresWeight: true, loadMode: 'external' } as const;
let n = 0;
const makeId = () => `w${(n += 1)}`;

describe('warmupWeight', () => {
  it('is half the working weight, rounded to 2.5 kg', () => {
    expect(warmupWeight(external, 80)).toBe(40);
    expect(warmupWeight(external, 85)).toBe(42.5);
    expect(warmupWeight(external, 47.5)).toBe(25); // 23.75 → 25
    expect(warmupWeight(external, 2.5)).toBe(2.5);
  });

  it('keeps an assisted machine’s help as it is — halving help is harder', () => {
    expect(warmupWeight({ requiresWeight: true, loadMode: 'assisted' }, 30)).toBe(30);
  });

  it('halves a belt, down to bodyweight alone', () => {
    expect(warmupWeight({ requiresWeight: true, loadMode: 'added_bodyweight' }, 20)).toBe(10);
    expect(warmupWeight({ requiresWeight: true, loadMode: 'added_bodyweight' }, 0)).toBe(0);
  });

  it('has no number for an unweighted movement, and keeps a blank blank', () => {
    expect(warmupWeight({ requiresWeight: false, loadMode: 'none' }, 80)).toBeNull();
    expect(warmupWeight(external, null)).toBeNull();
  });
});

describe('warmupToggleState', () => {
  it('offers to add while nothing is warmed up and set 1 is not done', () => {
    expect(warmupToggleState([row('a'), row('b')])).toBe('add');
  });

  it('offers to remove an unlogged warm-up on top', () => {
    expect(warmupToggleState([row('w', { isWarmup: true }), row('a')])).toBe('remove');
  });

  it('offers nothing once the warm-up or set 1 is logged, or for no rows', () => {
    expect(warmupToggleState([row('w', { isWarmup: true, isCompleted: true }), row('a')])).toBe(
      null,
    );
    expect(warmupToggleState([row('a', { isCompleted: true }), row('b')])).toBe(null);
    expect(warmupToggleState([])).toBe(null);
  });

  it('offers nothing when a warm-up was moved below set 1 by hand', () => {
    expect(warmupToggleState([row('a'), row('w', { isWarmup: true })])).toBe(null);
  });
});

describe('toggleWarmupSets', () => {
  it('splices one warm-up on top with set 1’s reps and leaves every working row as it was', () => {
    const sets = [row('a', { count: 6 }), row('b'), row('c'), row('d')];
    const next = toggleWarmupSets(sets, external, makeId);
    expect(next).toHaveLength(5);
    expect(next[0]).toMatchObject({ isWarmup: true, weightKg: 40, count: 6, isPrefilled: true });
    for (let i = 0; i < sets.length; i += 1) expect(next[i + 1]).toBe(sets[i]);
  });

  it('removes every unlogged warm-up on top', () => {
    const sets = [row('w1', { isWarmup: true }), row('w2', { isWarmup: true }), row('a')];
    expect(toggleWarmupSets(sets, external, makeId)).toEqual([sets[2]]);
  });

  it('returns the same array when there is nothing to do', () => {
    const sets = [row('a', { isCompleted: true })];
    expect(toggleWarmupSets(sets, external, makeId)).toBe(sets);
  });

  it('never removes the last row — a card with no sets is not a card', () => {
    const sets = [row('w', { isWarmup: true })];
    expect(warmupToggleState(sets)).toBe(null);
    expect(toggleWarmupSets(sets, external, makeId)).toBe(sets);
  });
});
