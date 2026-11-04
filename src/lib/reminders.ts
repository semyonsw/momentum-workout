/**
 * What the phone should say, and when — computed, not scheduled.
 *
 *   the workout   Mon · Wed · Fri   18:00   →  3 weekly alerts
 *
 * ── WHY THE PLAN IS A PURE FUNCTION AND THE SCHEDULING IS NOT HERE ────────
 *
 * `lib/notify.ts` talks to Android. Everything it does can fail, none of it may
 * throw, and none of it can be tested without a phone — which is exactly the
 * wrong place for the decisions. Which days get an alert, at what time, in
 * which language, and which settings produce silence: all of that is arithmetic
 * over data the app already has, and it is all here, where a test can read it.
 *
 * The result is a list of `PlannedReminder`s with stable ids. `syncReminders`
 * then does the dullest possible thing with it — cancel what this app scheduled,
 * schedule the plan — and because the plan is deterministic, two syncs in a row
 * with nothing changed produce the same alerts at the same instants.
 *
 * ── REPEATING, BECAUSE IT HAS TO FIRE WITH THE APP CLOSED ─────────────────
 *
 * A weekly trigger is handed to Android ONCE and then fires forever, with the
 * app closed, force-stopped, or never opened again. That is the only behaviour
 * a training reminder can have: a scheme that re-arms the next fortnight every
 * time the app launches is a scheme that goes quiet exactly when somebody has
 * stopped opening the app, which is the week the reminder was for.
 *
 * The days are a weekday list rather than the training sequence's cursor
 * (`Settings.workoutReminderDays` says why). Android holds ~500 alarms per app,
 * shared with the rest timer; this plan is at most seven.
 */

import { parseClockTime, type Weekday } from './days';
import { t, type Language } from './i18n';

/** When an alert fires: a weekday and a time, repeating. */
export type ReminderTrigger =
  /** Monday = 0 … Sunday = 6, as the whole app counts. */
  { kind: 'weekly'; weekday: Weekday; hour: number; minute: number };

export interface PlannedReminder {
  /**
   * Stable across syncs for the same day of the week.
   *
   * It is the notification's identifier, which is what makes a re-sync a
   * REPLACEMENT rather than a duplicate: scheduling `workout:w2` again overwrites
   * the one already sitting in Android's queue instead of adding a second alert
   * at the same minute.
   */
  id: string;
  title: string;
  body: string;
  trigger: ReminderTrigger;
}

export interface ReminderInputs {
  workout: {
    enabled: boolean;
    days: readonly Weekday[];
    /** `HH:MM`, 24-hour. */
    time: string;
  };
  lang: Language;
}

/**
 * The whole plan: every alert this app wants Android to be holding.
 *
 * Deterministic and total — an unreadable time or an empty day list falls out
 * quietly rather than producing an alert that cannot fire.
 */
export function planReminders(input: ReminderInputs): PlannedReminder[] {
  const { enabled, days, time } = input.workout;
  if (!enabled || days.length === 0) return [];
  const at = parseClockTime(time);
  if (!at) return [];
  return [...days]
    .sort((a, b) => a - b)
    .map((weekday) => ({
      id: `workout:w${weekday}`,
      title: t('Time to train', input.lang),
      body: t('Workout reminder', input.lang),
      trigger: { kind: 'weekly', weekday, hour: at.hour, minute: at.minute },
    }));
}

/**
 * One string that changes exactly when the plan does — what `useReminders`
 * compares to skip a sync that would re-arm the same queue.
 */
export function planKey(plan: readonly PlannedReminder[]): string {
  return JSON.stringify(plan.map((r) => [r.id, r.title, r.body, r.trigger]));
}
