import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WEIGH_IN_DAYS,
  DEFAULT_WEIGH_IN_TIME,
  WEIGH_IN_SCREEN,
  WEIGH_IN_SNOOZE_ID,
  isWeighInNotification,
  nextWeighInAt,
  planWeighInReminders,
  weighInPlanKey,
  weighInSnoozeAt,
} from './weighInReminder';

/**
 * The weigh-in reminder (4.0): which weekly alerts exist, when the next one
 * fires, when "tomorrow" is, and which notification a tap belongs to. All local
 * time — the dates below are built with the local `Date` constructor, so the
 * suite means the same thing in any timezone.
 */

const DEFAULTS = { enabled: true, days: DEFAULT_WEIGH_IN_DAYS, time: DEFAULT_WEIGH_IN_TIME };

/** Local wall-clock instant. Month is 1-based here for readability. */
function local(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

describe('the plan', () => {
  it('is Wednesday and Sunday at 06:00 out of the box', () => {
    const plan = planWeighInReminders(DEFAULTS, 'en');
    expect(plan.map((r) => [r.id, r.weekday, r.hour, r.minute])).toEqual([
      ['weighin:w2', 2, 6, 0],
      ['weighin:w6', 6, 6, 0],
    ]);
    expect(plan[0].title).toBe('Time to weigh in');
  });

  it('speaks Russian on a Russian phone', () => {
    const [first] = planWeighInReminders(DEFAULTS, 'ru');
    expect(first.title).not.toBe('Time to weigh in');
    expect(first.title.length).toBeGreaterThan(0);
  });

  it('is empty when off, with no days, or with an unreadable time', () => {
    expect(planWeighInReminders({ ...DEFAULTS, enabled: false }, 'en')).toEqual([]);
    expect(planWeighInReminders({ ...DEFAULTS, days: [] }, 'en')).toEqual([]);
    expect(planWeighInReminders({ ...DEFAULTS, time: '25:00' }, 'en')).toEqual([]);
  });

  it('sorts and de-duplicates the days, so ids never collide', () => {
    const plan = planWeighInReminders({ ...DEFAULTS, days: [6, 0, 6] }, 'en');
    expect(plan.map((r) => r.id)).toEqual(['weighin:w0', 'weighin:w6']);
  });

  it('never uses the snooze id, so a re-sync cannot cancel a snooze', () => {
    const plan = planWeighInReminders({ ...DEFAULTS, days: [0, 1, 2, 3, 4, 5, 6] }, 'en');
    expect(plan.some((r) => r.id === WEIGH_IN_SNOOZE_ID)).toBe(false);
  });

  it('keys change with the time and the language, and not otherwise', () => {
    const a = weighInPlanKey(planWeighInReminders(DEFAULTS, 'en'));
    expect(weighInPlanKey(planWeighInReminders(DEFAULTS, 'en'))).toBe(a);
    expect(weighInPlanKey(planWeighInReminders({ ...DEFAULTS, time: '06:30' }, 'en'))).not.toBe(a);
    expect(weighInPlanKey(planWeighInReminders(DEFAULTS, 'ru'))).not.toBe(a);
  });
});

describe('the next alert', () => {
  it('is this Wednesday from a Monday', () => {
    expect(nextWeighInAt(local(2026, 11, 16, 12), DEFAULTS)).toEqual(local(2026, 11, 18, 6));
  });

  it('is still today when today is a weigh-in day and 06:00 has not come', () => {
    expect(nextWeighInAt(local(2026, 11, 15, 5, 59), DEFAULTS)).toEqual(local(2026, 11, 15, 6));
  });

  it('rolls on once this morning’s has passed', () => {
    expect(nextWeighInAt(local(2026, 11, 15, 6, 0), DEFAULTS)).toEqual(local(2026, 11, 18, 6));
  });

  it('is a week out when the only day is today and it has passed', () => {
    const sundays = { ...DEFAULTS, days: [6] as const };
    expect(nextWeighInAt(local(2026, 11, 15, 7), sundays)).toEqual(local(2026, 11, 22, 6));
  });

  it('crosses a year end', () => {
    expect(nextWeighInAt(local(2026, 12, 31, 7), DEFAULTS)).toEqual(local(2027, 1, 3, 6));
  });

  it('is null when nothing will fire', () => {
    expect(nextWeighInAt(local(2026, 11, 16), { ...DEFAULTS, enabled: false })).toBeNull();
    expect(nextWeighInAt(local(2026, 11, 16), { ...DEFAULTS, days: [] })).toBeNull();
    expect(nextWeighInAt(local(2026, 11, 16), { ...DEFAULTS, time: 'soon' })).toBeNull();
  });
});

describe('remind me tomorrow', () => {
  it('lands on the next calendar day at the configured time, not 24 h later', () => {
    expect(weighInSnoozeAt(local(2026, 11, 18, 6, 4), '06:00')).toEqual(local(2026, 11, 19, 6));
    expect(weighInSnoozeAt(local(2026, 11, 18, 23, 50), '07:15')).toEqual(
      local(2026, 11, 19, 7, 15),
    );
  });

  it('crosses a month and a year end', () => {
    expect(weighInSnoozeAt(local(2026, 11, 30, 6), '06:00')).toEqual(local(2026, 12, 1, 6));
    expect(weighInSnoozeAt(local(2026, 12, 31, 6), '06:00')).toEqual(local(2027, 1, 1, 6));
  });

  it('falls back to 06:00 rather than refusing an unreadable time', () => {
    expect(weighInSnoozeAt(local(2026, 11, 18, 6), 'garbage')).toEqual(local(2026, 11, 19, 6));
  });

  it('is always in the future', () => {
    const now = local(2026, 11, 18, 23, 59);
    expect(weighInSnoozeAt(now, '00:00').getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('which notification a tap belongs to', () => {
  it('reads the screen from a map or a JSON string', () => {
    expect(isWeighInNotification({ kind: 'reminder', screen: WEIGH_IN_SCREEN })).toBe(true);
    expect(isWeighInNotification(JSON.stringify({ screen: WEIGH_IN_SCREEN }))).toBe(true);
  });

  it('is false for a timer, an old reminder, or junk', () => {
    expect(isWeighInNotification({ kind: 'timer' })).toBe(false);
    expect(isWeighInNotification({ kind: 'reminder' })).toBe(false);
    expect(isWeighInNotification('not json')).toBe(false);
    expect(isWeighInNotification(null)).toBe(false);
    expect(isWeighInNotification(undefined)).toBe(false);
  });
});
