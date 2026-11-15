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
import { translatedKeys } from './i18n';

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

  it('arms the exit on the training, never on another root', () => {
    expect(backAction({ ...base, route: SHELL_ROOT, root: SHELL_ROOT })).toBe('armExit');
    for (const route of SECTIONS.filter((s) => s !== SHELL_ROOT))
      expect(backAction({ ...base, route, root: SHELL_ROOT })).toBe('root');
  });

  it('goes straight to the training from any root, never to the tab before', () => {
    expect(backAction({ ...base, route: 'History', exitArmedAt: 9_500 })).toBe('root');
    expect(backAction({ ...base, route: 'Routines' })).toBe('root');
  });

  it('pops a screen pushed over Routines or History before leaving the root', () => {
    expect(backAction({ ...base, route: 'Routines', stackDepth: 1 })).toBe('pop');
    expect(backAction({ ...base, route: 'History', stackDepth: 2 })).toBe('pop');
  });
});

describe('the four roots', () => {
  it('are Workout, Routines, History and Settings, in that order, opening on Workout', () => {
    expect(SECTIONS).toEqual(['Workout', 'Routines', 'History', 'Settings']);
    expect(SHELL_ROOT).toBe('Workout');
  });
});

describe('navSlots', () => {
  it('centres each of the four in its own quarter, with no gap left for a Home button', () => {
    expect(navSlots(SECTIONS)).toEqual({
      Workout: 0.125,
      Routines: 0.375,
      History: 0.625,
      Settings: 0.875,
    });
  });

  it('still puts a two-item bar at the quarters', () => {
    expect(navSlots(['Workout', 'Settings'])).toEqual({ Workout: 0.25, Settings: 0.75 });
  });
});

describe('slideDir', () => {
  it('slides the way the blob goes on the bar', () => {
    expect(slideDir(SECTIONS, 'Workout', 'Settings')).toBe(1);
    expect(slideDir(SECTIONS, 'Settings', 'Workout')).toBe(-1);
    expect(slideDir(SECTIONS, 'History', 'Routines')).toBe(-1);
    expect(slideDir(SECTIONS, 'Routines', 'History')).toBe(1);
  });
});

describe('the 4.0 labels', () => {
  it('names every tab, and the new Settings headings, in Russian', () => {
    const keys = translatedKeys();
    for (const key of [...SECTIONS, 'Start', 'Start {name}', 'Timers & sound', 'Data & backup'])
      expect(keys).toContain(key);
  });

  it('drops the labels of the doors the tabs replaced', () => {
    const keys = translatedKeys();
    for (const key of ['Routines & exercises', 'Workout settings', 'Open {name} as a workout'])
      expect(keys).not.toContain(key);
  });
});
