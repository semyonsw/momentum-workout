import { describe, expect, it } from 'vitest';

import {
  EXIT_WINDOW_MS,
  SECTIONS,
  SHELL_ROOT,
  backAction,
  edgeBackCommits,
  navSlots,
  slideDir,
} from './sectionNav';

describe('edgeBackCommits', () => {
  it('pops past 120 dp or on a flick', () => {
    expect(edgeBackCommits(130, 0)).toBe(true);
    expect(edgeBackCommits(40, 0.9)).toBe(true);
    expect(edgeBackCommits(100, 0.3)).toBe(false);
  });
});

describe('backAction', () => {
  const base = {
    sheetOpen: false,
    stackDepth: 0,
    route: 'Workout' as const,
    root: 'Workout' as const,
    exitArmedAt: null,
    now: 10_000,
  };

  it('closes a sheet before anything else', () => {
    expect(backAction({ ...base, sheetOpen: true, stackDepth: 2 })).toBe('closeSheet');
  });

  it('pops a pushed screen, then goes back to the app’s own section from Settings', () => {
    expect(backAction({ ...base, route: 'Settings', stackDepth: 1 })).toBe('pop');
    expect(backAction({ ...base, route: 'Settings' })).toBe('root');
  });

  it('arms the exit on the root, and exits on a second press inside two seconds', () => {
    expect(backAction(base)).toBe('armExit');
    expect(backAction({ ...base, exitArmedAt: 9_000 })).toBe('exit');
    expect(backAction({ ...base, exitArmedAt: 10_000 - EXIT_WINDOW_MS - 1 })).toBe('armExit');
  });

  it('arms the exit on the training, never on Settings', () => {
    expect(backAction({ ...base, route: SHELL_ROOT, root: SHELL_ROOT })).toBe('armExit');
    expect(backAction({ ...base, route: 'Settings', root: SHELL_ROOT })).toBe('root');
  });
});

describe('navSlots', () => {
  it('puts the two-item bar at the quarters, with no gap left for a Home button', () => {
    expect(navSlots(SECTIONS)).toEqual({ Workout: 0.25, Settings: 0.75 });
  });
});

describe('slideDir', () => {
  it('slides the way the blob goes on the bar', () => {
    expect(slideDir(SECTIONS, 'Workout', 'Settings')).toBe(1);
    expect(slideDir(SECTIONS, 'Settings', 'Workout')).toBe(-1);
  });
});
