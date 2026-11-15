import { describe, expect, it } from 'vitest';

import { addSpare, dropGone, initialBuilds, nextSpare, reconcileBuilds } from './stageBuilds';

/**
 * The pre-built root, as bookkeeping. The rule worth pinning is the one that
 * keeps a spare invisible as an optimisation: a root you LEFT is never reused,
 * so coming back always finds a build that has never been shown.
 */
describe('reconcileBuilds', () => {
  it('keeps a spare’s id when it goes live, so the early mount is the one shown', () => {
    const stage = addSpare(initialBuilds('Workout'), 'Settings');
    const settingsId = stage.builds.Settings?.id;
    const sliding = reconcileBuilds(stage, ['Workout', 'Settings']);
    expect(sliding.builds.Settings).toEqual({ id: settingsId, seen: true });
    expect(sliding.builds.Workout).toEqual({ id: 0, seen: true });
  });

  it('keeps a left root mounted until the stage is idle, then drops it', () => {
    const sliding = reconcileBuilds(initialBuilds('Workout'), ['Workout', 'Settings']);
    const settled = reconcileBuilds(sliding, ['Settings']);
    expect(settled.builds.Workout).toBeUndefined();
    expect(settled.gone).toEqual([{ route: 'Workout', id: 0 }]);
    /* Coming straight back gets a new build beside the old one, never the old one. */
    const back = reconcileBuilds(settled, ['Settings', 'Workout']);
    expect(back.builds.Workout?.id).not.toBe(0);
    expect(back.gone).toEqual([{ route: 'Workout', id: 0 }]);
    const dropped = dropGone(back);
    expect(dropped.gone).toEqual([]);
    expect(dropGone(dropped)).toBe(dropped);
  });

  it('builds a live root that has no spare', () => {
    const opened = reconcileBuilds(initialBuilds('Settings'), ['Settings', 'Workout']);
    expect(opened.builds.Workout?.seen).toBe(true);
  });

  it('returns the same object when nothing changed, leaving an unseen spare alone', () => {
    const stage = addSpare(initialBuilds('Workout'), 'Settings');
    expect(reconcileBuilds(stage, ['Workout'])).toBe(stage);
  });

  it('never hands two builds the same id', () => {
    let stage = initialBuilds('Workout');
    stage = addSpare(stage, 'Settings');
    stage = reconcileBuilds(stage, ['Settings']);
    stage = reconcileBuilds(stage, ['Settings', 'Workout']);
    const ids = [...Object.values(stage.builds).map((b) => b?.id), ...stage.gone.map((g) => g.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('nextSpare', () => {
  it('builds the nearest missing root first, then the next, then stops', () => {
    let stage = initialBuilds('Workout');
    expect(nextSpare(stage, 'Workout')).toBe('Routines');
    stage = addSpare(stage, 'Routines');
    expect(nextSpare(stage, 'Workout')).toBe('History');
    stage = addSpare(stage, 'History');
    expect(nextSpare(stage, 'Workout')).toBe('Settings');
    stage = addSpare(stage, 'Settings');
    expect(nextSpare(stage, 'Workout')).toBeNull();
    expect(nextSpare(initialBuilds('Settings'), 'Settings')).toBe('History');
  });

  it('builds only along the bar it is given', () => {
    const two = ['Workout', 'Settings'] as const;
    const stage = initialBuilds('Workout');
    expect(nextSpare(stage, 'Workout', two)).toBe('Settings');
    expect(nextSpare(addSpare(stage, 'Settings'), 'Workout', two)).toBeNull();
  });

  it('does not rebuild a root that is already mounted', () => {
    const stage = addSpare(initialBuilds('Workout'), 'Settings');
    expect(addSpare(stage, 'Settings')).toBe(stage);
  });
});
