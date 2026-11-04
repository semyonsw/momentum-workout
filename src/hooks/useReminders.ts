/**
 * Keep Android's notification queue matching the workout schedule.
 *
 * Mounted once, at the top of the app, beside `useAutoBackup`: launch is the only
 * moment a sideloaded app can reliably run anything, so the work that has to
 * happen whether or not the user opens a particular screen happens here.
 *
 * ── WHAT IT WATCHES, AND WHY IT IS EVERY INPUT ───────────────────────────
 *
 * The plan is a function of the schedule and the language (`lib/reminders.ts`),
 * so all of them are subscribed: turning the reminder off has to cancel it, and
 * switching to English has to change what the phone says tomorrow evening.
 * Either being missed leaves the user looking at a setting that says one thing
 * while the phone does another — which is the failure that makes people turn
 * notifications off at the OS level and never turn them back on.
 *
 * ── AND WHY IT ALSO WATCHES THE FOREGROUND ───────────────────────────────
 *
 * A reboot can clear the queue, and coming back to the app is when that gets
 * noticed. It costs a handful of scheduling calls on a queue that is usually
 * unchanged.
 *
 * ── IT IS DEBOUNCED ──────────────────────────────────────────────────────
 *
 * Rolling the time wheel or tapping through the day chips lands one state change
 * at a time. Syncing on each would be a cancel-and-reschedule pass across the
 * bridge per tap; half a second of quiet is the signal that the edit is over.
 */

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { planKey, planReminders } from '../lib/reminders';
import { syncReminders } from '../lib/notify';
import { useSettings } from '../state/settingsStore';

/** Long enough to swallow a burst of edits, short enough to feel immediate. */
const DEBOUNCE_MS = 500;

export function useReminders(): void {
  const language = useSettings((s) => s.language);
  const workoutReminderEnabled = useSettings((s) => s.workoutReminderEnabled);
  const workoutReminderDays = useSettings((s) => s.workoutReminderDays);
  const workoutReminderTime = useSettings((s) => s.workoutReminderTime);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
   * What Android was last handed, so a write that changes nothing in the plan
   * does not cancel and re-arm the whole queue across the bridge.
   */
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const plan = planReminders({
        workout: {
          enabled: workoutReminderEnabled,
          days: workoutReminderDays,
          time: workoutReminderTime,
        },
        lang: language,
      });
      const key = `${language}|${planKey(plan)}`;
      if (key === lastKey.current) return;
      lastKey.current = key;
      void syncReminders(plan, language);
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [language, workoutReminderEnabled, workoutReminderDays, workoutReminderTime]);

  /*
   * Read from the stores rather than from the closure above: this fires whenever
   * the app comes back, which can be days later, and the values captured when
   * the subscription was set up are not the ones that should be scheduled.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      const settings = useSettings.getState();
      const plan = planReminders({
        workout: {
          enabled: settings.workoutReminderEnabled,
          days: settings.workoutReminderDays,
          time: settings.workoutReminderTime,
        },
        lang: settings.language,
      });
      // Always synced, whatever the key says: this is the pass that re-arms
      // after a reboot cleared the queue.
      lastKey.current = `${settings.language}|${planKey(plan)}`;
      void syncReminders(plan, settings.language);
    });
    return () => sub.remove();
  }, []);
}
