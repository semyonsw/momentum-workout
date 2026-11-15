/**
 * App entry — providers, the boundary, the notification handler, and the shell.
 *
 * Everything about WHICH screen is showing lives in `src/navigation/AppShell`;
 * everything about WHAT the data is lives in the three stores under `src/state`
 * (the library and routines, the settings, the finished workouts).
 *
 * That paragraph used to end "swap those for SQLite queries and neither this file
 * nor any screen below it changes". As of 0.12.0 the finished workouts DID move to
 * SQLite (`src/state/historyDb.ts`) and the claim held: no screen changed, and the
 * only line this file gained is the one below that brings the old AsyncStorage log
 * across. The other two stores are a few dozen rows and stay where they are.
 *
 * The side effects set up here are all "make the phone able to reach the user" —
 * plus, now, one storage migration — and every one of them is allowed to fail:
 *
 *   • the notification handler, which decides what a timer alert does when it
 *     arrives with the app already on screen
 *   • the Android notification channels, without which a scheduled alert on
 *     Android 8+ has no sound, no vibration, and nothing the user can tune — and
 *     which is where the app's own two tones are attached, because on Android the
 *     sound belongs to the channel and not to the notification
 *   • the audio session, so the countdown's beeps play over their music and
 *     through a silent switch
 *   • the HISTORY RE-READ, which gives the log a second chance to load from a point
 *     where every native module is up — see the note on it below, and
 *     `workoutHistoryStore.loadWorkouts`
 *   • the HISTORY MIGRATION, which brings a log written by 0.10.0 or earlier out of
 *     AsyncStorage and into the database. It runs once, it never deletes the old
 *     key, and it stays quiet either way: a migration that could not run tries
 *     again next launch, and a dialog on launch about a storage system the user has
 *     never heard of is worse than a History tab that fills itself in tomorrow.
 *   • the RETIRED-REMINDER SWEEP, which cancels the weekly workout reminders an
 *     earlier version left in Android's queue (`cancelRetiredReminders`).
 *   • the AUTOMATIC BACKUP, which rewrites the day's backup file in the folder the
 *     user granted once, two seconds after any change to the data it carries (and
 *     at once when the app goes to the background with a write still waiting).
 *     Here because it must watch the stores whichever screen is open, and silent
 *     because a backup that cannot write must not become a modal in front of
 *     somebody who opened the app to train — the Settings hero reports the age of
 *     the last copy instead. `hooks/useAutoBackup.ts` has the rest.
 *
 * None of them are load-bearing: the on-screen pill derives from a stored
 * deadline and is correct whether or not any of this works, and the log already on
 * disk is read synchronously before the first render whatever the migration does.
 *
 * ── AND THE LAUNCH GATE ───────────────────────────────────────────────────
 *
 * Until the stores have loaded, the screen is the page colour and nothing else
 * (`Root`) — the native splash's own background, so the handover from Android's
 * splash reads as one held frame rather than a cut. No animation over the wait:
 * the wait is a few frames, and a splash with choreography has to be at least as
 * long as its choreography.
 */

import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';

import './global.css';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { AppShell } from './src/navigation/AppShell';
import { useSettingsHydrated } from './src/hooks/useHydrated';
import { reportRootHeight } from './src/hooks/useKeyboard';
import { prepareAudio } from './src/lib/beeper';
import {
  REMINDER_KIND,
  cancelRetiredReminders,
  dismissTimerAlerts,
  ensureTimerChannels,
  notificationKind,
  requestNotificationPermission,
} from './src/lib/notify';
import { migrateHistoryIfNeeded, useWorkoutHistory } from './src/state/workoutHistoryStore';
import { useAutoBackup } from './src/hooks/useAutoBackup';
import { syncWeighInFromSettings, useWeighInReminder } from './src/hooks/useWeighInReminder';
import { useAutoRounds } from './src/hooks/useAutoRounds';
import { useTimerAlerts } from './src/hooks/useTimerAlerts';
import { useSetTimerCommit } from './src/hooks/useSetTimerCommit';

/*
 * Timer alerts — rest ending, and the bell on a timed hold.
 *
 * The alert is a BACKUP for a phone that isn't being looked at, so it stays
 * silent while the app is in the foreground: the pill already counted the last
 * seconds out loud and buzzed at zero, and adding the notification's own sound on
 * top of that is the same event announced twice — which is heard as the countdown
 * beeping more times than it counted.
 *
 * Backgrounded, it is the only thing that can reach the user, so it gets the
 * banner, the sound, and a place in the shade (`shouldShowList` was false for
 * both states, which on a phone where the handler runs with the app in the
 * background left the alert as a banner that vanished — a rest-over nobody
 * could find once they looked down).
 *
 * A REMINDER IS NOT A TIMER. It used to go through the same rule, so a reminder
 * firing while the app happened to be open was swallowed whole — no banner, no
 * list entry, nothing. Nothing on screen said it either: the pill only counts
 * rests. So a reminder always shows, whatever is in front.
 *
 * Wrapped because this runs at module scope, before any boundary exists. A throw
 * here would be a crash on launch with no screen to report it on.
 */
try {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const kind = notificationKind(notification.request.content.data);
      const reminder = kind === REMINDER_KIND;
      const foreground = AppState.currentState === 'active';
      const show = reminder || !foreground;
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: show,
        shouldSetBadge: false,
      };
    },
  });
} catch {
  // Alerts will be silent-but-scheduled, or absent. The pill is unaffected.
}

export default function App() {
  /*
   * Mounted here, at the top, rather than inside a screen: it watches the stores
   * for the whole session, on the days the user never opens Settings, which is
   * all of them.
   */
  useAutoBackup();
  // The weigh-in alerts — on by default, armed only once notifications are allowed.
  useWeighInReminder();

  useEffect(() => {
    // Re-synced once the answer is in: the reminder is on by default, and the
    // first grant is the moment it can finally be armed.
    void requestNotificationPermission().then(() => syncWeighInFromSettings(true));
    void ensureTimerChannels();
    // Warmed here rather than on the first beep, so 0:05 of a plank isn't where
    // the audio session gets configured.
    void prepareAudio();
    /*
     * READ THE LOG AGAIN, now that React is running.
     *
     * The log is read once at module scope, during bundle evaluation, so that
     * History does not flicker from empty to full on every launch — see
     * `historyDb.ts`. The cost of reading it that early is that it is the one
     * moment a native module may not be ready: a release build resolves its
     * TurboModules lazily, nothing has mounted, and if the open throws there is
     * nobody to tell. The store caught that throw and started empty, which is
     * indistinguishable on screen from having never trained.
     *
     * This is the second attempt, from a point where that cannot happen — and
     * only when the first one failed. On a launch where it worked, re-reading
     * every row, re-parsing every workout and handing the store a new array that
     * equals the old one re-rendered every history subscriber and re-ran every
     * overload verdict in the middle of the launch, to learn nothing.
     */
    if (useWorkoutHistory.getState().loadFailed) {
      useWorkoutHistory.getState().reloadHistory();
    }
    /*
     * Once, on the first launch after upgrading. In an effect rather than at module
     * scope because it is async and it touches two storage systems, and a side
     * effect that size hiding inside an import is how a launch crash becomes hard
     * to place.
     */
    void migrateHistoryIfNeeded();
    void cancelRetiredReminders();

    /*
     * Back in front: the timer alerts in the shade are stale news — the session
     * on screen already says the rest is over. See `dismissTimerAlerts`.
     */
    void dismissTimerAlerts();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void dismissTimerAlerts();
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      {/*
        Inside the provider, outside the shell: a crash in any screen lands on a
        readable error with a way out, instead of taking the process down. The
        session is persisted, so without this a crash on the logging screen
        repeats on every launch — see `ErrorBoundary`.
      */}
      <View
        className="flex-1 bg-bg"
        onLayout={(event) => reportRootHeight(event.nativeEvent.layout.height)}
      >
        <ErrorBoundary>
          <Root />
        </ErrorBoundary>
      </View>
    </SafeAreaProvider>
  );
}

/**
 * The launch gate: the page colour until the stores have loaded, then the app.
 *
 * Its own component rather than a branch in `App`, because it has to re-render
 * when the stores report in — and `App` is where the launch effects live, which
 * must run once and not again.
 *
 *  - SETTINGS hydrate asynchronously (`useSettingsHydrated`), and for a frame or
 *    two the store holds its defaults — a shell drawn then would flash English at
 *    a Russian user, or the wrong rest.
 *  - HISTORY is read before the first frame, so it is normally ready already. It
 *    is not ready only when that early read threw; the re-read in `App`'s effect
 *    settles it either way (`reloadHistory` marks it ready even on a second
 *    failure, and History then says the log could not be read rather than
 *    showing an empty one), so the gate cannot hang on it.
 */
function Root() {
  const settingsReady = useSettingsHydrated();
  const historyReady = useWorkoutHistory((s) => s.ready);

  if (!settingsReady || !historyReady) return <View className="flex-1 bg-bg" />;
  return (
    <>
      <SessionClock />
      <AppShell />
    </>
  );
}

/**
 * The parts of a running workout that must not depend on which screen is up.
 *
 * The shell renders only the top of its stack, so anything mounted inside the
 * session screen stops the moment `Add an exercise` is pushed over it or the user
 * backs out to the section mid-rest. Two things cannot afford that: the pocket alarms
 * (`useTimerAlerts`), the boxing round chain (`useAutoRounds`) and the bell that
 * logs a countdown set (`useSetTimerCommit`) — all read the store and the clock
 * and nothing on screen. A sibling rendering nothing rather
 * than hooks inside `AppShell`, so a rest starting re-renders this and not the
 * whole app.
 */
function SessionClock() {
  useTimerAlerts();
  useAutoRounds();
  useSetTimerCommit();
  return null;
}
