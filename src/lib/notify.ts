/**
 * Timer notifications — the cue for a phone that is not in the user's hand.
 *
 *   rest 2:00 ───────────────────────────► 0:05 ────────► 0:00
 *   in the app:                            tick tick …    long tone
 *   in a pocket:                           "Get set" ⏰    "Next set" ⏰
 *
 * ── WHY THIS IS THE MECHANISM WHEN THE APP IS NOT IN FRONT ─────────────────
 *
 * The in-app count-in is a JS `setInterval` playing a WAV. That is fine while the
 * app is on screen and unreliable the moment it isn't: Android throttles timers in
 * the background, Doze suspends them, "Restricted" battery usage and Samsung's
 * "Sleeping apps" list stop them outright, and a swipe-away kills the process
 * entirely. No amount of audio-session configuration fixes a beep that is never
 * reached. So the out-of-app cue is a SCHEDULED NOTIFICATION, which is the one
 * thing Android guarantees to deliver at a wall-clock instant — the alarm path,
 * not the app's.
 *
 * Two of them per timer, because "it's time" a beat too late is not a cue:
 *
 *   • `getset`  — a few seconds before the deadline, carrying the TICK tone.
 *   • `go`      — at the deadline, carrying the LONG tone.
 *
 * ── AND WHY THE CHANNELS CARRY THE APP'S OWN TONES ─────────────────────────
 *
 * On Android 8+ the SOUND BELONGS TO THE CHANNEL, not to the notification: a
 * per-notification sound is ignored. So there is one channel per tone, and each is
 * created with the same WAV the in-app cue plays (shipped into `res/raw` by the
 * `expo-notifications` config plugin — see `sounds` in `app.json`). The result is
 * that "rest is over" sounds identical whether the app is open or in a pocket.
 *
 * A channel's sound and importance are FROZEN once Android has seen it: updating a
 * channel silently keeps the old settings. That is why these ids are versioned —
 * changing a tone means a new id, and the old channel is deleted so it does not
 * linger in the system UI.
 *
 * Everything here can fail and none of it may throw:
 *  • SCHEDULING CAN THROW SYNCHRONOUSLY. `scheduleNotificationAsync` validates its
 *    trigger before returning a promise, so `.catch()` alone does not cover a bad
 *    date — the throw escapes the promise chain. Everything is inside `try`.
 *  • EXACT ALARMS ARE A PERMISSION. `USE_EXACT_ALARM` (declared in `app.json`) is
 *    granted at install on Android 13+ and cannot be revoked, which is what makes
 *    these land on time; on older phones `SCHEDULE_EXACT_ALARM` can be refused and
 *    a `SecurityException` comes back through the bridge. Swallowed: the on-screen
 *    countdown remains the source of truth.
 */

import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { t, type Language } from './i18n';
import {
  WEIGH_IN_SCREEN,
  WEIGH_IN_SNOOZE_ID,
  WEIGH_IN_WEEKLY_PREFIX,
  isWeighInNotification,
  weighInCopy,
  type PlannedWeighIn,
} from './weighInReminder';

/**
 * Bumped when a channel's SOUND or IMPORTANCE changes — Android freezes both.
 *
 * 3 — renamed so the Russian names reached existing installs. (The name turned
 * out NOT to be frozen — Android updates a channel's name and description in
 * place — which is why `ensureTimerChannels` now rewrites them whenever the
 * language changes. The bump stays: it is harmless, and the old ids are in
 * `RETIRED_CHANNELS` so the settings screen does not list both.)
 */
const CHANNEL_VERSION = 3;

/** The long tone: rest is over, the bell rang, go. */
const CHANNEL_GO = `timer-go-v${CHANNEL_VERSION}`;
/** The tick: the last seconds before a deadline. */
const CHANNEL_GETSET = `timer-getset-v${CHANNEL_VERSION}`;

/**
 * REMINDERS — anything the app schedules for later in the day or week.
 *
 * Its own channel and not the timer's, which is the whole point of channels: the
 * two are different events with different urgencies and the user has to be able
 * to tune them apart. A rest timer ending is a thing you need THIS SECOND and it
 * gets `MAX` with the app's loud tone; "time to weigh in" at 06:00 is a thing
 * you need this morning, and a reminder that sounds like a set ending is a reminder
 * that gets the whole app silenced.
 *
 * So this one is `DEFAULT` importance and carries NO custom sound: it uses
 * whatever the phone's own notification tone is, which is what somebody's
 * muscle memory already reads as "something wants me later".
 */
const CHANNEL_REMINDER = `reminders-v${CHANNEL_VERSION}`;

/** Channels from earlier versions, deleted so the system UI stays honest. */
const RETIRED_CHANNELS = [
  'timers',
  'timer-go-v1',
  'timer-getset-v1',
  'timer-go-v2',
  'timer-getset-v2',
  'reminders-v2',
];

/**
 * How many seconds before a deadline the "get set" alert fires.
 *
 * Not the user's `beepSeconds`: that number is how long the in-app count-in TICKS,
 * and it can be 20. One advance notification is a warning, twenty would be a
 * denial-of-service on their own notification shade — so the alert is a single
 * beat, five seconds out, which is one deep breath and a re-grip.
 */
const GETSET_LEAD_SECONDS = 5;

/** `data.kind` on every rest / set-timer alert — see `notificationKind`. */
const TIMER_KIND = 'timer';

/**
 * The channels as they were last written, and the language they were written in.
 *
 * A PROMISE rather than a flag, because the flag this replaced was set before the
 * three `setNotificationChannelAsync` calls had finished: launch fires
 * `ensureTimerChannels()` and a rest starting a moment later calls it again,
 * sees `true`, and schedules straight onto a channel Android has not created yet — and a notification posted to a channel that does not exist is DROPPED on
 * Android 8+, silently. Every caller now awaits the same write.
 *
 * Keyed by language because a channel's NAME and DESCRIPTION can be updated in
 * place (only its sound and importance are frozen), so switching the app to
 * Russian rewrites what the phone's notification settings call them.
 */
let channels: { lang: Language; ready: Promise<boolean> } | null = null;

async function writeChannels(lang: Language): Promise<boolean> {
  try {
    for (const id of RETIRED_CHANNELS) {
      await Notifications.deleteNotificationChannelAsync(id).catch(() => {});
    }

    await Notifications.setNotificationChannelAsync(CHANNEL_GO, {
      name: t('Timer finished', lang),
      description: t('Rest is over, or a timed set rang its bell.', lang),
      importance: Notifications.AndroidImportance.MAX,
      sound: 'beep_final.wav',
      vibrationPattern: [0, 220, 120, 220],
      enableVibrate: true,
      bypassDnd: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });

    await Notifications.setNotificationChannelAsync(CHANNEL_GETSET, {
      name: t('Get set', lang),
      description: t('A tick {seconds} seconds before a timer ends.', lang, {
        seconds: GETSET_LEAD_SECONDS,
      }),
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'beep_tick.wav',
      vibrationPattern: [0, 120],
      enableVibrate: true,
      bypassDnd: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });

    await Notifications.setNotificationChannelAsync(CHANNEL_REMINDER, {
      name: t('Reminders', lang),
      description: t('A weigh-in, at the time you asked to be reminded.', lang),
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 200],
      enableVibrate: true,
      bypassDnd: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the app's three Android channels, and clear out retired ones.
 *
 * No-op elsewhere, and never throws. Safe to call on every launch and from every
 * scheduling path: concurrent callers share one write, and a failed write is
 * retried by the next caller rather than remembered as done.
 *
 * Without a language it keeps whatever the channels were last written in — the
 * launch call does not know the language yet, and must not rename them to English
 * on a Russian phone.
 */
export async function ensureTimerChannels(lang?: Language): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (channels && (lang === undefined || lang === channels.lang)) {
    if (await channels.ready) return;
  }
  const target = lang ?? channels?.lang ?? 'en';
  const ready = writeChannels(target);
  channels = { lang: target, ready };
  if (!(await ready) && channels?.ready === ready) channels = null; // let a later call try again
}

/**
 * Has the user actually granted notifications?
 *
 * Asked by the settings screens so a switch that is on can say when nothing will
 * come of it — an armed reminder behind a denied permission is the single most
 * confusing state this feature has, because everything in the app looks right.
 */
export async function notificationsGranted(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    return current.granted === true;
  } catch {
    return false;
  }
}

/** Ask for permission. Silent on refusal — the app works fine without it. */
export async function requestNotificationPermission(): Promise<void> {
  await ensureNotificationPermission();
}

/**
 * Where the permission stands after asking for it, if it could still be asked.
 *
 *   granted  alerts will arrive
 *   denied   refused this time; the system may ask again later
 *   blocked  refused for good — only the phone's Settings can turn it back on,
 *            which is what `openNotificationSettings` is for
 *
 * Asked at the moment an alert is switched ON, not only at launch: a switch that
 * arms something behind a permission nobody was ever asked for is the
 * "everything looks right and nothing arrives" state, and the switch is the one
 * moment the user knows why we are asking.
 */
export async function ensureNotificationPermission(): Promise<'granted' | 'denied' | 'blocked'> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted';
    if (current.canAskAgain === false) return 'blocked';
    const asked = await Notifications.requestPermissionsAsync();
    if (asked.granted) return 'granted';
    return asked.canAskAgain === false ? 'blocked' : 'denied';
  } catch {
    return 'denied';
  }
}

/** The app's own page in the phone's Settings, where a blocked permission lives. */
export async function openNotificationSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    // No settings app to open. Nothing else can grant it.
  }
}

export interface TimerAlert {
  title: string;
  body: string;
  /** Epoch ms the alert should fire. */
  at: number;
  /** Which tone. `go` is the long one; `getset` is the tick. */
  kind?: 'go' | 'getset';
  /** The language the Android channel names are created in, first time round. */
  lang?: Language;
  /** A fixed id: scheduling it again REPLACES the alarm rather than adding one. */
  identifier?: string;
}

/** Which clock a pair of alerts belongs to — one pair of each can ever exist. */
export type TimerSlot = 'rest' | 'set';

/**
 * The fixed ids of one clock's pair.
 *
 * Fixed rather than generated because the ids used to live only in a hook's
 * ref: an app killed mid-rest forgot them, the relaunch scheduled a SECOND pair
 * off the persisted deadline, and a skip afterwards cancelled only the new one —
 * so "Rest over" rang twice, or for a rest that no longer existed. A fixed id is
 * known to every process, and re-scheduling it replaces what is there.
 */
export function timerSlotIds(slot: TimerSlot): string[] {
  return [`timer-${slot}-getset`, `timer-${slot}-go`];
}

/**
 * Schedule one alert, returning its id or null.
 *
 * Anything under a second away is refused: the notification would land after the
 * user had already watched the pill hit zero, and a duplicate alert for an event
 * they just saw reads as a bug.
 */
async function scheduleTimerAlert(alert: TimerAlert): Promise<string | null> {
  if (!Number.isFinite(alert.at) || alert.at - Date.now() < 1000) return null;

  const channelId = alert.kind === 'getset' ? CHANNEL_GETSET : CHANNEL_GO;

  try {
    await ensureTimerChannels(alert.lang);
    return await Notifications.scheduleNotificationAsync({
      ...(alert.identifier ? { identifier: alert.identifier } : {}),
      content: {
        title: alert.title,
        body: alert.body,
        // Android ignores this in favour of the channel's sound; iOS uses it.
        sound: alert.kind === 'getset' ? 'beep_tick.wav' : 'beep_final.wav',
        // Read back by the foreground handler and by `dismissTimerAlerts`.
        data: { kind: TIMER_KIND },
        interruptionLevel: 'timeSensitive', // iOS: pierces Focus modes
        ...(Platform.OS === 'android' ? { channelId } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(alert.at),
        ...(Platform.OS === 'android' ? { channelId } : {}),
      },
    });
  } catch {
    return null;
  }
}

/**
 * Schedule the pair for one deadline: the tick a few seconds out, then the tone.
 *
 * Returns every id that was actually scheduled, for the caller to cancel later.
 * The "get set" alert is skipped when the timer is already inside its lead — a
 * `+15` pressed at 0:02, or a rest shorter than the lead itself.
 */
export async function scheduleTimerAlertPair(params: {
  at: number;
  /** "Rest over" / "Time" — the headline at the deadline. */
  goTitle: string;
  goBody: string;
  /** "Get set" — the headline for the advance tick. */
  getSetTitle: string;
  getSetBody: string;
  lang?: Language;
  /** Gives the pair its fixed ids — see `timerSlotIds`. */
  slot?: TimerSlot;
}): Promise<string[]> {
  const ids: string[] = [];
  const [getSetIdentifier, goIdentifier] = params.slot ? timerSlotIds(params.slot) : [];

  const getSetId = await scheduleTimerAlert({
    title: params.getSetTitle,
    body: params.getSetBody,
    at: params.at - GETSET_LEAD_SECONDS * 1000,
    kind: 'getset',
    lang: params.lang,
    identifier: getSetIdentifier,
  });
  if (getSetId) ids.push(getSetId);

  const goId = await scheduleTimerAlert({
    title: params.goTitle,
    body: params.goBody,
    at: params.at,
    kind: 'go',
    lang: params.lang,
    identifier: goIdentifier,
  });
  if (goId) ids.push(goId);

  return ids;
}

/**
 * Clear the timer alerts still sitting in the shade.
 *
 * Called when the app comes back to the front: a "Rest over" from four minutes
 * ago is not news to somebody who is looking at the session, and a shade that
 * piles up one per set is the other reason people switch alerts off. Reminders
 * are left where they are — "time to train" is still true until it is done.
 */
export async function dismissTimerAlerts(): Promise<void> {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    for (const entry of shown) {
      if (notificationKind(entry.request.content.data) !== TIMER_KIND) continue;
      await Notifications.dismissNotificationAsync(entry.request.identifier).catch(() => {});
    }
  } catch {
    // Nothing presented, or the module is unavailable.
  }
}

/** Cancel scheduled alerts. Safe with stale ids, nulls, or no permission. */
export async function cancelTimerAlerts(ids: readonly (string | null)[]): Promise<void> {
  for (const id of ids) {
    if (!id) continue;
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // Already fired, already cancelled, or the module is unavailable.
    }
  }
}

/* ------------------------------------------------------------------ */
/* Reminders                                                           */
/* ------------------------------------------------------------------ */

/**
 * The marker that separates THIS app's reminders from its timer alerts.
 *
 * A reminder carries `data.kind = 'reminder'`, which is how the foreground
 * handler in `App.tsx` tells it from a timer alert and lets it show. The queue is
 * this app's alone — Android keeps each package's scheduled notifications apart —
 * and the marker is what separates the two kinds WITHIN this app. That matters:
 * the obvious way to clear reminders is `cancelAllScheduledNotificationsAsync`,
 * and it would silently cancel the rest-timer alert of a running workout — a rest
 * that then ends in complete silence with the phone in a pocket.
 */
export const REMINDER_KIND = 'reminder';

/**
 * Which of this app's two kinds a notification is, from its `data`.
 *
 * Total over whatever the bridge hands back — Android returns `data` as a map, a
 * JSON string on some versions, or nothing for a notification scheduled before
 * the marker existed.
 */
export function notificationKind(data: unknown): string | null {
  let value = data;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null) return null;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === 'string' ? kind : null;
}

/**
 * Cancel the workout reminders an earlier version armed.
 *
 * The workout reminder is gone (4.0), but the weekly alerts it scheduled live in
 * Android's queue, not in the app, so deleting the code that armed them would
 * leave "Time to train" firing every week with no setting left to turn it off.
 * Run on every launch: it costs one read of a short queue, and it is the only way
 * to reach a phone that skips an upgrade or two.
 *
 * Matched by IDENTIFIER, not by `REMINDER_KIND`, so a future reminder carrying the
 * same kind survives it: the old plan named every alert `workout:w<day>`, and
 * `task:` is Momentum 2.x's daily tasks, armed from this same package.
 */
export async function cancelRetiredReminders(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const entry of scheduled) {
      const retired =
        entry.identifier.startsWith('workout:') || entry.identifier.startsWith('task:');
      if (!retired) continue;
      await Notifications.cancelScheduledNotificationAsync(entry.identifier).catch(() => {});
    }
  } catch {
    // Nothing scheduled, or the module is unavailable. Either way, nothing to do.
  }
}

/* ------------------------------------------------------------------ */
/* The weigh-in reminder — see `lib/weighInReminder.ts`                */
/* ------------------------------------------------------------------ */

/** Android's weekday for a Monday-first one: expo counts Sunday = 1 … Saturday = 7. */
function expoWeekday(weekday: number): number {
  return ((weekday + 1) % 7) + 1;
}

/** What every weigh-in alert carries: the reminder kind, and where a tap lands. */
const WEIGH_IN_DATA = { kind: REMINDER_KIND, screen: WEIGH_IN_SCREEN };

let weighInQueue: Promise<unknown> = Promise.resolve();

/**
 * Make Android hold exactly `plan`'s weekly weigh-in alerts.
 *
 * Cancels every `weighin:w*` and schedules the plan — and leaves the snooze and
 * the timer alerts alone, which is why it matches by prefix rather than by kind.
 * An empty plan (off, or no permission) is how the alerts are taken away.
 *
 * ONE AT A TIME, chained: launch, the foreground pass and a settings edit can
 * all land within a second, and two interleaved cancel-then-schedule passes can
 * have the second one's cancel land between the first one's schedules. Chained,
 * the last plan asked for is the one Android ends up holding.
 */
export function syncWeighInReminders(
  plan: readonly PlannedWeighIn[],
  lang: Language = 'en',
): Promise<number> {
  const run = weighInQueue.then(() => syncWeighInNow(plan, lang));
  weighInQueue = run.catch(() => 0);
  return run;
}

async function syncWeighInNow(plan: readonly PlannedWeighIn[], lang: Language): Promise<number> {
  try {
    await ensureTimerChannels(lang);
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const entry of scheduled) {
      if (!entry.identifier.startsWith(WEIGH_IN_WEEKLY_PREFIX)) continue;
      await Notifications.cancelScheduledNotificationAsync(entry.identifier).catch(() => {});
    }

    let armed = 0;
    for (const reminder of plan) {
      try {
        await Notifications.scheduleNotificationAsync({
          identifier: reminder.id,
          content: {
            title: reminder.title,
            body: reminder.body,
            data: WEIGH_IN_DATA,
            ...(Platform.OS === 'android' ? { channelId: CHANNEL_REMINDER } : {}),
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday: expoWeekday(reminder.weekday),
            hour: reminder.hour,
            minute: reminder.minute,
            ...(Platform.OS === 'android' ? { channelId: CHANNEL_REMINDER } : {}),
          },
        });
        armed += 1;
      } catch {
        // One bad alert must not take the other day down with it.
      }
    }
    return armed;
  } catch {
    return 0;
  }
}

/**
 * "Remind me tomorrow" — one alert, at `at`, under the fixed snooze id.
 *
 * Fixed so a second snooze replaces the first rather than stacking two alerts
 * for the same morning. Returns whether it was armed; the screen leaves either
 * way, because the user's answer was "not now", and a refusal here (no
 * permission, an exact-alarm `SecurityException`) is not theirs to fix.
 */
export async function scheduleWeighInSnooze(at: Date, lang: Language): Promise<boolean> {
  if (!Number.isFinite(at.getTime()) || at.getTime() - Date.now() < 1000) return false;
  try {
    await ensureTimerChannels(lang);
    await Notifications.scheduleNotificationAsync({
      identifier: WEIGH_IN_SNOOZE_ID,
      content: {
        ...weighInCopy(lang),
        data: WEIGH_IN_DATA,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_REMINDER } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_REMINDER } : {}),
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear weigh-in alerts still in the shade — the question has been answered.
 *
 * Called when a weight is logged, skipped or snoozed: a "Time to weigh in" left
 * in the shade after somebody weighed in is a reminder for a thing already done.
 */
export async function dismissWeighInAlerts(): Promise<void> {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    for (const entry of shown) {
      if (!isWeighInNotification(entry.request.content.data)) continue;
      await Notifications.dismissNotificationAsync(entry.request.identifier).catch(() => {});
    }
  } catch {
    // Nothing presented, or the module is unavailable.
  }
}
