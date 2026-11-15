import { describe, expect, it } from 'vitest';

import {
  HOLD_SURFACES,
  LIBRARY_TABS,
  WORKOUT_CORNER,
  cueActions,
  cueIsTappable,
  exerciseRowControls,
  holdActions,
  holdCue,
} from './discoverability';

/**
 * The picker's rows, the marks on long-press surfaces and the workout corner. The two that matter: the picker never
 * draws a delete outside edit mode, and no hold offers something its mark does
 * not.
 */

describe('the add-exercise picker (U15)', () => {
  it('hides delete outside edit mode', () => {
    expect(exerciseRowControls(false)).toEqual({ pick: true, remove: false });
  });

  it('shows delete only in edit mode, and a row then picks nothing', () => {
    expect(exerciseRowControls(true)).toEqual({ pick: false, remove: true });
  });

  it('never offers a pick and a delete on the same row', () => {
    for (const editing of [false, true]) {
      const row = exerciseRowControls(editing);
      expect(row.pick && row.remove).toBe(false);
      expect(row.pick || row.remove).toBe(true);
    }
  });
});

describe('long-press surfaces (U11)', () => {
  it('every surface that answers a hold carries a visible mark', () => {
    for (const surface of HOLD_SURFACES) {
      expect(holdActions(surface).length).toBeGreaterThan(0);
      expect(holdCue(surface)).toBeTruthy();
    }
  });

  it('a tappable mark opens every action the hold offers, and only those', () => {
    for (const surface of HOLD_SURFACES.filter(cueIsTappable)) {
      expect(cueActions(surface)).toEqual(holdActions(surface));
    }
  });

  it('the die has an options mark that opens its sheet', () => {
    expect(holdCue('routineDie')).toBe('options');
    expect(cueActions('routineDie')).toEqual(['dieOptions']);
  });

  it('the grip is a mark only — a reorder is a drag, not a tap', () => {
    expect(holdCue('exerciseCard')).toBe('grip');
    expect(cueIsTappable('exerciseCard')).toBe(false);
    expect(cueActions('exerciseCard')).toEqual([]);
    expect(holdActions('exerciseCard')).toEqual(['reorder']);
  });
});

describe('the workout corner and the Routines tab (U23, 4.0)', () => {
  it('holds only the assistant — routines and history are tabs now', () => {
    expect(WORKOUT_CORNER).toEqual(['ai']);
  });

  it('the Routines tab switches between its two halves, routines first', () => {
    expect(LIBRARY_TABS).toEqual(['routines', 'exercises']);
  });
});
