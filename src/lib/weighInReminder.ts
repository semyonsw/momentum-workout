/**
 * The weigh-in reminder — what the phone should say, and when — computed, not
 * scheduled.
 *
 *   Wed · Sun   06:00   →  2 weekly alerts, "Time to weigh in"
 *   tap         →  the Bodyweight screen, the well ready, Skip / tomorrow at 06:00
 *
 * It replaced the workout reminder (4.0). A training day moves with the week; a
 * weigh-in does not — it is the same two mornings, before breakfast, every week,
 * which is exactly the shape of thing a phone is better at remembering than a
 * person is.
 *
 * ── WHY THE PLAN IS A PURE FUNCTION AND THE SCHEDULING IS NOT HERE ────────
 *
 * `lib/notify.ts` talks to Android: everything there can fail, none of it may
 * throw, and none of it can be tested without a phone. Which days, what time,
 * which words, when "tomorrow" is, and which notification a tap belongs to are
 * all arithmetic over settings the app already has — so they are here, where a
 * test can read them, and `notify.ts` does the dullest possible thing with the
 * result.
 *
 * ── WEEKLY TRIGGERS, BECAUSE IT HAS TO FIRE WITH THE APP CLOSED ───────────
 *
 * A weekly trigger is handed to Android once and then fires forever, app closed
 * or force-stopped. The old workout reminder made the same choice for the same
 * reason: a scheme that re-arms on launch goes quiet exactly when somebody has
 * stopped opening the app. The snooze is the one DATE trigger — it is a single
 * "ask me again tomorrow", and it is meant to fire once.
 *
 * ── THE IDS ARE STABLE, AND THEY ARE NAMESPACED ───────────────────────────
 *
 * `weighin:w<day>` for the weekly alerts and `weighin:snooze` for the one-off.
 * Stable, so a re-sync REPLACES rather than duplicates; namespaced, so the sync
 * that rewrites the weekly alerts never cancels a snooze somebody asked for, and
 * `cancelRetiredReminders` (which sweeps `workout:` and `task:`) never touches
 * either.
 */

import { parseClockTime, weekdayIndex, type Weekday } from './days';
import { t, type Language } from './i18n';

/** Prefix of every weekly weigh-in alert's identifier. */
export const WEIGH_IN_WEEKLY_PREFIX = 'weighin:w';
/** The one-off "Remind me tomorrow" alert. One at a time: a second snooze replaces it. */
export const WEIGH_IN_SNOOZE_ID = 'weighin:snooze';
/**
 * `data.screen` on a weigh-in alert — what a tap reads to know where to land.
 *
 * Beside `data.kind = 'reminder'` rather than instead of it: the kind is what
 * the foreground handler in `App.tsx` reads to let a reminder show, and this is a
 * reminder. The screen is a second, narrower fact.
 */
export const WEIGH_IN_SCREEN = 'weigh-in';

/** Wednesday and Sunday, Monday = 0 — two mornings, evenly enough spread. */
export const DEFAULT_WEIGH_IN_DAYS: readonly Weekday[] = [2, 6];
/** Before breakfast, which is the only weigh-in that compares with the last one. */
export const DEFAULT_WEIGH_IN_TIME = '06:00';

export interface WeighInReminderSettings {
  enabled: boolean;
  days: readonly Weekday[];
  /** `HH:MM`, 24-hour. */
  time: string;
}

export interface PlannedWeighIn {
  /** The notification's identifier — `weighin:w<day>`. */
  id: string;
  title: string;
  body: string;
  /** Monday = 0 … Sunday = 6, as the whole app counts. */
  weekday: Weekday;
  hour: number;
  minute: number;
}

/** The two strings every weigh-in alert carries, in the user's language. */
export function weighInCopy(lang: Language): { title: string; body: string } {
  return {
    title: t('Time to weigh in', lang),
    body: t('Step on the scale before breakfast and log it.', lang),
  };
}

/**
 * Every weekly alert Android should be holding.
 *
 * Deterministic and total: off, no days, or an unreadable time all produce an
 * empty plan rather than an alert that cannot fire.
 */
export function planWeighInReminders(
  settings: WeighInReminderSettings,
  lang: Language,
): PlannedWeighIn[] {
  if (!settings.enabled || settings.days.length === 0) return [];
  const at = parseClockTime(settings.time);
  if (!at) return [];
  const copy = weighInCopy(lang);
  return [...new Set(settings.days)]
    .sort((a, b) => a - b)
    .map((weekday) => ({
      id: `${WEIGH_IN_WEEKLY_PREFIX}${weekday}`,
      ...copy,
      weekday,
      hour: at.hour,
      minute: at.minute,
    }));
}

/** One string that changes exactly when the plan does — what the sync hook compares. */
export function weighInPlanKey(plan: readonly PlannedWeighIn[]): string {
  return JSON.stringify(plan.map((r) => [r.id, r.title, r.body, r.weekday, r.hour, r.minute]));
}

/**
 * When the next weekly alert will fire, after `now` — or null if none will.
 *
 * What the settings screen prints under the days, so the user reads "next:
 * Wednesday 06:00" rather than doing the arithmetic. A day whose time has
 * already passed this morning rolls to next week's, which is what Android will
 * do too. Built with `setDate` on a local `Date`, so a daylight-saving night
 * still lands on 06:00 on the wall clock.
 */
export function nextWeighInAt(now: Date, settings: WeighInReminderSettings): Date | null {
  if (!settings.enabled || settings.days.length === 0) return null;
  const at = parseClockTime(settings.time);
  if (!at || !Number.isFinite(now.getTime())) return null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    candidate.setHours(at.hour, at.minute, 0, 0);
    if (candidate.getTime() <= now.getTime()) continue;
    if (settings.days.includes(weekdayIndex(candidate) as Weekday)) return candidate;
  }
  return null;
}

/**
 * "Remind me tomorrow" — the next CALENDAR day, at the configured time.
 *
 * The calendar day, not now + 24 h: the button says "tomorrow at 6:00", and a
 * snooze pressed at 06:04 has to land at 06:00, not 06:04. An unreadable time
 * falls back to the default rather than refusing — the user asked to be asked
 * again, and silence is the one wrong answer.
 */
export function weighInSnoozeAt(now: Date, time: string): Date {
  const at = parseClockTime(time) ?? { hour: 6, minute: 0 };
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  next.setHours(at.hour, at.minute, 0, 0);
  return next;
}

/**
 * Is this notification's `data` a weigh-in — should a tap on it open the well?
 *
 * Total over whatever the bridge hands back: a map, a JSON string on some
 * Android versions, or nothing.
 */
export function isWeighInNotification(data: unknown): boolean {
  let value = data;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  if (typeof value !== 'object' || value === null) return false;
  return (value as { screen?: unknown }).screen === WEIGH_IN_SCREEN;
}
