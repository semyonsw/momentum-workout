import { describe, expect, it } from 'vitest';

import { pushRoute, reusesSession, startsAfterOpen } from './sessionRoute';

/**
 * A double-tap on Start pushed the logging screen twice (once from the handler,
 * once from the claim effect), and `Start an empty workout` built a second
 * session over the first.
 */
describe('pushRoute', () => {
  type R = { name: string };
  const home: R = { name: 'routineEditor' };
  const session: R = { name: 'session' };

  it('does not stack the logging screen on itself', () => {
    const once = pushRoute([home], session);
    const twice = pushRoute(once, session);
    expect(twice).toEqual([home, session]);
    expect(twice).toBe(once);
  });

  it('pushes everything else as before', () => {
    expect(pushRoute([home], session)).toEqual([home, session]);
    expect(pushRoute([session], home)).toEqual([session, home]);
    // Only the TOP is checked: a session under another screen is a different stack.
    expect(pushRoute([session, home], session)).toEqual([session, home, session]);
  });
});

describe('reusesSession', () => {
  it('builds a new session when there is none', () => {
    expect(reusesSession(null, 'r1')).toBe(false);
  });

  it('never rebuilds over a started session', () => {
    expect(reusesSession({ startedAt: '2026-11-03T10:00:00.000Z', routineId: 'r1' }, 'r2')).toBe(
      true,
    );
  });

  it('reuses an unstarted session for the same routine — the double-tap', () => {
    expect(reusesSession({ startedAt: null, routineId: 'r1' }, 'r1')).toBe(true);
    // The empty workout, whose routine id is ''.
    expect(reusesSession({ startedAt: null, routineId: '' }, '')).toBe(true);
  });

  it('replaces an unstarted preview of a different routine', () => {
    expect(reusesSession({ startedAt: null, routineId: 'r1' }, 'r2')).toBe(false);
    expect(reusesSession({ startedAt: null, routineId: 'r1' }, '')).toBe(false);
  });
});

describe('startsAfterOpen (4.0)', () => {
  it('starts the unstarted session it just opened for this routine', () => {
    expect(startsAfterOpen({ startedAt: null, routineId: 'push' }, 'push')).toBe(true);
  });

  it('never re-anchors a running workout, even of the same routine', () => {
    expect(startsAfterOpen({ startedAt: '2026-11-15T08:00:00Z', routineId: 'push' }, 'push')).toBe(
      false,
    );
    expect(startsAfterOpen({ startedAt: '2026-11-15T08:00:00Z', routineId: 'pull' }, 'push')).toBe(
      false,
    );
  });

  it('starts nothing when no session was built (an empty routine goes to its editor)', () => {
    expect(startsAfterOpen(null, 'push')).toBe(false);
    expect(startsAfterOpen({ startedAt: null, routineId: 'pull' }, 'push')).toBe(false);
  });
});
