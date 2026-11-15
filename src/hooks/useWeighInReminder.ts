/**
 * Keep Android's queue holding the weigh-in alerts the settings describe.
 *
 * Mounted once, at the top of the app beside `useAutoBackup`: launch is the only
 * moment a sideloaded app can reliably run anything, and the alerts have to be
 * right on the days the user never opens Settings, which is all of them.
 *
 * ── IT SCHEDULES NOTHING BEHIND A DENIED PERMISSION ──────────────────────
 *
 * The reminder is ON by default, and the owner's rule is that it only actually
 * schedules once notifications are granted. So every pass asks first, and a
 * denied permission syncs an EMPTY plan — which also takes back anything an
 * earlier grant armed. The settings row says the same thing in words.
 *
 * ── WHAT IT WATCHES ──────────────────────────────────────────────────────
 *
 * The switch, the days, the time and the language — all of them, because each
 * changes what the phone says or when. And the foreground: a permission granted
 * in the phone's Settings, or a reboot that cleared the queue, is noticed when
 * the app comes back. Debounced, because rolling the wheel lands one state
 * change per detent.
 */

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { notificationsGranted, syncWeighInReminders } from '../lib/notify';
import { planWeighInReminders, weighInPlanKey } from '../lib/weighInReminder';
import { useSettings } from '../state/settingsStore';

/** Long enough to swallow a burst of edits, short enough to feel immediate. */
const DEBOUNCE_MS = 500;

/** What Android was last handed — so an unchanged plan is not re-armed. */
let lastKey: string | null = null;

/**
 * One pass, read from the stores rather than from a closure, so it is right
 * whenever it runs. `force` skips the unchanged-plan check — the foreground and
 * a fresh grant use it, since the queue may have been cleared under us.
 */
export async function syncWeighInFromSettings(force = false): Promise<void> {
  const s = useSettings.getState();
  const granted = await notificationsGranted();
  const plan = granted
    ? planWeighInReminders(
        {
          enabled: s.weighInReminderEnabled,
          days: s.weighInReminderDays,
          time: s.weighInReminderTime,
        },
        s.language,
      )
    : [];
  const key = `${s.language}|${weighInPlanKey(plan)}`;
  if (!force && key === lastKey) return;
  lastKey = key;
  await syncWeighInReminders(plan, s.language);
}

export function useWeighInReminder(): void {
  const language = useSettings((s) => s.language);
  const enabled = useSettings((s) => s.weighInReminderEnabled);
  const days = useSettings((s) => s.weighInReminderDays);
  const time = useSettings((s) => s.weighInReminderTime);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void syncWeighInFromSettings(), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [language, enabled, days, time]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void syncWeighInFromSettings(true);
    });
    return () => sub.remove();
  }, []);
}
