import { describe, expect, it } from 'vitest';

import {
  LAUNCH_BRAND,
  LAUNCH_CEILING_MS,
  LAUNCH_FLOOR_MS,
  LAUNCH_STORES,
  launchReady,
  launchTicks,
} from './launchReady';

/**
 * The launch screen's two decisions: which chips are ticked, and whether it may
 * leave. A splash that leaves too early is a flash of a half-built screen; one
 * that never leaves is an app that does not open.
 */

const stores = LAUNCH_STORES;

describe('the stage', () => {
  it('counts the stores that are ready', () => {
    const state = launchReady({ stores, ready: { history: true }, elapsedMs: 100 });
    expect(state.stage).toBe(1);
    expect(state.fraction).toBe(1);
    expect(launchReady({ stores, ready: {}, elapsedMs: 100 }).fraction).toBe(0);
  });

  it('waits on the training log', () => {
    expect(LAUNCH_STORES).toEqual(['history']);
  });
});

describe('the floor', () => {
  it('does not leave before 2.3 s even when everything is ready', () => {
    expect(launchReady({ stores, ready: { history: true }, elapsedMs: 2299 }).exit).toBe(false);
  });

  it('leaves at 2.3 s once everything is ready', () => {
    expect(launchReady({ stores, ready: { history: true }, elapsedMs: LAUNCH_FLOOR_MS }).exit).toBe(
      true,
    );
  });

  it('waits past the floor for a store that is still loading', () => {
    expect(launchReady({ stores, ready: { history: false }, elapsedMs: 4000 }).exit).toBe(false);
  });
});

describe('the ceiling', () => {
  it('leaves at 6 s whatever the stores say', () => {
    expect(launchReady({ stores, ready: {}, elapsedMs: LAUNCH_CEILING_MS }).exit).toBe(true);
  });
});

describe('the ticks', () => {
  it('ticks nothing before a store is ready', () => {
    expect(launchTicks({ history: null }, 5000)).toEqual({ history: false });
  });

  it('paces a store that finishes at once into the first slot', () => {
    expect(launchTicks({ history: 5 }, 699)).toEqual({ history: false });
    expect(launchTicks({ history: 5 }, 700)).toEqual({ history: true });
  });

  it('ticks a late store the moment it finishes, not at its slot', () => {
    expect(launchTicks({ history: 3000 }, 2999).history).toBe(false);
    expect(launchTicks({ history: 3000 }, 3000).history).toBe(true);
  });
});

describe('the brand', () => {
  it('names the app as its launcher does', () => {
    expect(LAUNCH_BRAND.wordmark).toBe('Workout');
  });
});
