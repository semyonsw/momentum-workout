import { describe, expect, it } from 'vitest';

import { planKey, planReminders, type ReminderInputs } from './reminders';

/**
 * The reminder plan.
 *
 * What these pin is the set of cases where the app must say NOTHING, because
 * every one of them is a phone buzzing about something that is not true: a
 * reminder switched off, one with no days, one with a time nobody can read. A
 * notification the user cannot account for is the thing that gets the whole
 * channel silenced, and after that none of the reminders they did want arrive
 * either.
 */

function plan(workout: ReminderInputs['workout'], lang: ReminderInputs['lang'] = 'en') {
  return planReminders({ workout, lang });
}

describe('the workout schedule', () => {
  it('is silent while it is off', () => {
    expect(plan({ enabled: false, days: [0, 2, 4], time: '18:00' })).toEqual([]);
  });

  it('is silent with no days, however it was switched on', () => {
    expect(plan({ enabled: true, days: [], time: '18:00' })).toEqual([]);
  });

  it('is silent on an unreadable time rather than firing at a guess', () => {
    expect(plan({ enabled: true, days: [0], time: 'half six' })).toEqual([]);
  });

  it('gives one weekly alert per day it was told, in week order', () => {
    const alerts = plan({ enabled: true, days: [4, 0, 2], time: '18:30' });
    expect(alerts.map((a) => a.id)).toEqual(['workout:w0', 'workout:w2', 'workout:w4']);
    expect(alerts[2].trigger).toEqual({ kind: 'weekly', weekday: 4, hour: 18, minute: 30 });
  });

  /*
   * The id IS the notification identifier, so a collision does not add a second
   * alert — it silently REPLACES the first.
   */
  it('gives every alert an id of its own', () => {
    const ids = plan({ enabled: true, days: [0, 1, 2, 3, 4, 5, 6], time: '07:00' }).map(
      (a) => a.id,
    );
    expect(new Set(ids).size).toBe(7);
  });
});

describe('what the language changes', () => {
  it('translates the words', () => {
    const [en] = plan({ enabled: true, days: [0], time: '18:00' });
    const [ru] = plan({ enabled: true, days: [0], time: '18:00' }, 'ru');
    expect(en.title).toBe('Time to train');
    expect(ru.title).not.toBe(en.title);
  });
});

describe('planKey', () => {
  it('changes exactly when the plan does', () => {
    const a = plan({ enabled: true, days: [0], time: '18:00' });
    const b = plan({ enabled: true, days: [0], time: '18:00' });
    const c = plan({ enabled: true, days: [0], time: '18:05' });
    expect(planKey(a)).toBe(planKey(b));
    expect(planKey(a)).not.toBe(planKey(c));
  });
});
