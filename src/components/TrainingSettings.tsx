/**
 * TrainingSettings — the training's half of the one Settings page.
 *
 * Until 4.0 this was `WorkoutSettingsScreen`, pushed from a single row on
 * Settings: everything a workout reads behind one door, and the app-wide
 * things (backup, AI, language) on the page in front of it. Two pages for one
 * question — "where is that setting" — meant guessing which page first. They
 * are one scrolling page now (`screens/SettingsHomeScreen.tsx`), and this file
 * holds the three sections a workout reads, in the order the owner chose:
 *
 *   WORKOUT          rest, auto-start, ± step, get ready, rep ladder,
 *                    weekly sets, units
 *   TIMERS & SOUND   count-in beeps, sound, vibration, screen on, timer
 *                    notification, test beep
 *   BODYWEIGHT       the number, the log, the weigh-in reminder
 *
 * Components rather than one screen so the page composes them under its own
 * headings, and each still reads and writes `settingsStore` itself.
 *
 * WHY ± CHIPS AND NOT A KEYPAD. The same decision `QuickAdjust` makes on a set
 * row, for the same reason: nobody types "135" seconds. Rest is nudged in
 * fifteens from a number that was already close, and the two chips are the same
 * 44 dp targets the rest of the app uses. They do not repeat when held: the
 * ranges are small enough that a tap count is honest and a repeat would
 * overshoot.
 *
 * WHY `TEST THE BEEP` IS A ROW. The whole point of the count-in is that it
 * reaches someone who isn't looking at the phone, which means the failure mode is
 * silent: a muted media stream, a denied audio focus, a switch left off. Finding
 * that out at 0:05 of a two-minute plank is finding it out too late. One tap here
 * proves the thing works before it matters.
 *
 * Every number is clamped by `settingsStore`, so a row cannot hand a `NaN` to a
 * deadline; these sections only ever ask for a nudge.
 */

import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { BodyDoor } from './BodyDoor';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { pressedStyle } from './motion';
import {
  Kicker,
  ListCard,
  Segmented,
  SelectChip,
  Separator,
  StepperRow,
  SwitchRow,
  TextButton,
} from './primitives';
import { TimeWheel } from './TimeWheel';
import { useLanguage, useT, type Translate } from '../hooks/useT';
import { syncWeighInFromSettings } from '../hooks/useWeighInReminder';
import {
  formatClockTime,
  parseClockTime,
  weekdayIndex,
  weekdayLabels,
  weekdayNames,
  type Weekday,
} from '../lib/days';
import { countFinal, countTick, tap } from '../lib/feedback';
import { CLUSTERS, clusterLabel } from '../lib/muscles';
import {
  ensureNotificationPermission,
  notificationsGranted,
  openNotificationSettings,
} from '../lib/notify';
import { LADDER_SETS, describeLadder, ladderForMax } from '../lib/repLadder';
import { formatClock, formatWeight, kgToLb, lbToKg, unitLabel, weightSteps } from '../lib/units';
import { nextWeighInAt } from '../lib/weighInReminder';
import { useLibrary } from '../state/libraryStore';
import { bumpRestBetweenSets } from '../state/restSync';
import { SETTING_LIMITS, useSettings, type NumericSetting } from '../state/settingsStore';
import { palette } from '../theme/tokens';
import type { UnitSystem } from '../types/models';

/**
 * Where the bodyweight row starts from when it has never been set.
 *
 * A visible starting point for the ± chips, not a default: it is stored only once
 * the user taps the row, and what they see immediately is the number they are
 * adjusting. `sanitizeSettings` still has no fallback — an unset bodyweight stays
 * unset everywhere else in the app.
 */
const BODYWEIGHT_START_KG = 70;

/**
 * The clusters, in the order the library files them.
 *
 * `CLUSTERS` from `lib/muscles.ts` rather than a literal here, so a cluster added
 * to the type appears in this list without anybody remembering to add it.
 */
const CLUSTER_ROWS = CLUSTERS;

/**
 * The two unit systems, named in the user's language.
 *
 * A function rather than a constant because the labels are translated, and a
 * module-level array would be frozen in whichever language the app started in.
 */
function unitOptions(t: Translate): readonly { value: UnitSystem; label: string }[] {
  return [
    { value: 'metric', label: t('Kilograms') },
    { value: 'imperial', label: t('Pounds') },
  ];
}

/**
 * A duration as the user thinks about it.
 *
 * Clock form once it passes a minute, because "2:30" is how anyone says a rest,
 * and plain seconds below that, because "0:45" is a stopwatch reading rather than
 * a length. Zero is a word: `0 s` for a setting that is switched off reads like a
 * value that failed to load.
 */
function formatSeconds(seconds: number, t: Translate, zeroLabel = 'Off'): string {
  if (seconds <= 0) return t(zeroLabel);
  if (seconds < 60) return t('{seconds} s', { seconds });
  return formatClock(seconds);
}

/**
 * WORKOUT — the rests, the get-ready, the ladder switch, the weekly targets and
 * the units: what shapes the sets themselves.
 */
export function WorkoutSettingsSection() {
  const t = useT();
  const lang = useLanguage();
  const settings = useSettings();
  /**
   * The bulk half of `Make every exercise a rep ladder`. The flag lives in
   * Settings, the ladders live on the exercises, and this row is the one place
   * that keeps the two in step — see `libraryStore.setLadderOnAllExercises` for
   * what it will and will not touch.
   */
  const setLadderOnAllExercises = useLibrary((s) => s.setLadderOnAllExercises);
  const bump = useBump();

  /*
   * The between-sets rest does NOT go through `bump`. It is the one setting that
   * has to reach outside this store to be true — every exercise carrying a rest of
   * its own goes back to following it, in the library and in a workout already
   * running. `state/restSync.ts` owns that.
   */
  const bumpBetweenSets = (direction: 1 | -1) => {
    tap();
    bumpRestBetweenSets(SETTING_LIMITS.restSecondsBetweenSets.step * direction);
  };

  return (
    <>
      <Kicker className="mx-lg mb-sm">{t('Rest')}</Kicker>
      <ListCard className="mx-lg">
        <StepperRow
          label={t('Between sets')}
          value={formatSeconds(settings.restSecondsBetweenSets, t, 'No rest')}
          hint={t(
            'Every set of every exercise. Setting it clears any exercise you have given a rest of its own.',
          )}
          onDecrease={() => bumpBetweenSets(-1)}
          onIncrease={() => bumpBetweenSets(1)}
        />
        <Separator />
        <StepperRow
          label={t('Between exercises')}
          value={formatSeconds(settings.restSecondsBetweenExercises, t, 'No rest')}
          onDecrease={() => bump('restSecondsBetweenExercises', -1)}
          onIncrease={() => bump('restSecondsBetweenExercises', 1)}
        />
        <Separator />
        <SwitchRow
          label={t('Start rest automatically')}
          hint={t('Off: rest only runs when you start it')}
          value={settings.autoStartRest}
          onChange={(v) => settings.setFlag('autoStartRest', v)}
        />
        <Separator />
        <StepperRow
          label={t('Timer ± step')}
          hint={t('The +15 on the rest and set-timer pills')}
          value={formatSeconds(settings.adjustStepSeconds, t)}
          onDecrease={() => bump('adjustStepSeconds', -1)}
          onIncrease={() => bump('adjustStepSeconds', 1)}
        />
      </ListCard>

      {/* ---------------------------------------------------------- */}
      <Kicker className="mx-lg mb-sm mt-xxl">{t('Timed sets')}</Kicker>
      <ListCard className="mx-lg">
        <StepperRow
          label={t('Get ready')}
          hint={t('Counted in before a plank or a hang starts')}
          value={formatSeconds(settings.prepareSeconds, t, 'Straight to work')}
          onDecrease={() => bump('prepareSeconds', -1)}
          onIncrease={() => bump('prepareSeconds', 1)}
        />
      </ListCard>

      {/* ----------------------------------------------------------
          REP LADDER — one switch, and it edits the LIBRARY.

          Everything else on this screen is a number the app reads later. This
          one reaches out and changes every rep-counted exercise you have, which
          is exactly what makes it worth having: the ladder is per-exercise
          because a max is per-movement, and turning it on thirty times through
          thirty create screens is how a good scheme goes unused.

          It is reversible, and the line under it says what "off" gives back:
          the ladders this switch added and nothing else. A max you set yourself
          and a ladder that has earned a rep are facts, and a setting does not
          get to delete a fact. */}
      <Kicker className="mx-lg mb-sm mt-xxl">{t('Rep ladder')}</Kicker>
      <ListCard className="mx-lg">
        <SwitchRow
          label={t('Make every exercise a rep ladder')}
          hint={t('One max, {sets} sets — {ladder} at a max of 12', {
            sets: LADDER_SETS,
            ladder: describeLadder(ladderForMax(12, LADDER_SETS)),
          })}
          value={settings.ladderAllExercises}
          onChange={(v) => {
            settings.setFlag('ladderAllExercises', v);
            setLadderOnAllExercises(v);
          }}
        />
      </ListCard>
      <Text className="mx-lg mt-sm text-label text-ink-faint">
        {settings.ladderAllExercises
          ? t(
              'Every rep-counted exercise runs a ladder, and new ones start with it on. Switching this off takes back only the ladders it added — a max you set yourself, and any ladder that has earned a rep, stay exactly as they are.',
            )
          : t(
              'Switches the ladder on for every rep-counted exercise at once, seeded from each one’s target reps. Holds, rounds and distances are left alone — a ladder is a rep prescription.',
            )}
      </Text>

      {/* ----------------------------------------------------------
          WEEKLY SETS PER MUSCLE GROUP — targets, and every one optional.

          `lib/balance.ts` counts sets per cluster and refuses to score them:
          "a count, not a score". That refusal is right about somebody else's
          model of your recovery, and it is the reason there is no MEV/MRV
          band imported from a textbook here. It is not right about a number
          YOU chose — a target you typed is a fact about your plan, and
          comparing this week against it is arithmetic you would otherwise do
          in your head.

          So: nothing is set by default, `—` means no opinion, and where a
          target exists the training history's row reads `14 / 16` and its bar
          measures against it instead of against the busiest cluster. Nothing
          turns red, nothing warns, and going over is not an error. */}
      <Kicker className="mx-lg mb-sm mt-xxl">{t('Weekly sets')}</Kicker>
      <ListCard className="mx-lg">
        {CLUSTER_ROWS.map((cluster, index) => {
          const target = settings.weeklySetTargets[cluster];
          return (
            <View key={cluster}>
              {index > 0 ? <Separator /> : null}
              <StepperRow
                label={clusterLabel(cluster, lang)}
                value={target == null ? '—' : t('{count} sets', { count: target })}
                onDecrease={() => {
                  tap();
                  /*
                   * Stepping below zero CLEARS the target rather than pinning
                   * it at 0, which is how the control is switched off without a
                   * second affordance. Zero itself is a real answer — "I am not
                   * training legs this block" — so it is one step above off.
                   */
                  if (target == null) return;
                  settings.setWeeklyTarget(cluster, target <= 0 ? undefined : target - 1);
                }}
                onIncrease={() => {
                  tap();
                  // The first tap on `+` starts at a number rather than at 1:
                  // nobody's weekly target for a muscle group is one set, and
                  // ten taps to reach a plausible one is a control nobody uses.
                  settings.setWeeklyTarget(cluster, target == null ? 12 : target + 1);
                }}
              />
            </View>
          );
        })}
      </ListCard>
      <Text className="mx-lg mt-sm text-label text-ink-faint">
        {t(
          'Optional. Set one and the training history compares this window against it; leave it at “—” and the counts stay counts.',
        )}
      </Text>

      {/* ---------------------------------------------------------- */}
      <Kicker className="mx-lg mb-sm mt-xxl">{t('Units')}</Kicker>
      <View className="mx-lg">
        <Segmented
          options={unitOptions(t)}
          value={settings.unitSystem}
          onChange={settings.setUnitSystem}
          accessibilityLabel={t('Weight units')}
        />
        <Text className="mt-sm text-label text-ink-faint">
          {t(
            'Display only. Every set is stored in kilograms, so switching can never change what your history says you lifted.',
          )}
        </Text>
      </View>
    </>
  );
}

/** ± on a numeric setting, by its own step, with the tap's tick. */
function useBump() {
  const bumpNumber = useSettings((s) => s.bumpNumber);
  return (key: NumericSetting, direction: 1 | -1) => {
    tap();
    bumpNumber(key, SETTING_LIMITS[key].step * direction);
  };
}

/**
 * TIMERS & SOUND — how a countdown reaches somebody who is not looking at the
 * phone. They sound device-wide, but every one of them is about a countdown,
 * and the countdown only runs in a session.
 */
export function TimersSoundSection() {
  const t = useT();
  const settings = useSettings();
  const bump = useBump();
  return (
    <ListCard className="mx-lg">
      <StepperRow
        label={t('Beep the last')}
        hint={t('Every countdown: rest, get ready, and a prescribed hold')}
        value={formatSeconds(settings.beepSeconds, t, 'Silent')}
        onDecrease={() => bump('beepSeconds', -1)}
        onIncrease={() => bump('beepSeconds', 1)}
      />
      <Separator />
      <SwitchRow
        label={t('Sound')}
        value={settings.soundEnabled}
        onChange={(v) => settings.setFlag('soundEnabled', v)}
      />
      <Separator />
      <SwitchRow
        label={t('Vibration')}
        value={settings.hapticsEnabled}
        onChange={(v) => settings.setFlag('hapticsEnabled', v)}
      />
      <Separator />
      <SwitchRow
        label={t('Keep the screen on')}
        hint={t('While a timer is running')}
        value={settings.keepAwakeEnabled}
        onChange={(v) => settings.setFlag('keepAwakeEnabled', v)}
      />
      <Separator />
      <SwitchRow
        label={t('Notify when a timer ends')}
        hint={t("How the beep reaches you when the app isn't open — a tick 5 s out, then the tone")}
        value={settings.notifyOnTimerEnd}
        onChange={(v) => {
          settings.setFlag('notifyOnTimerEnd', v);
          if (v) void ensureNotificationPermission();
        }}
      />
      <Separator />
      <TestBeepRow />
    </ListCard>
  );
}

/**
 * BODYWEIGHT — one number, the log behind it, and the reminder to weigh in.
 *
 * The number is what makes bodyweight and assisted work COUNTABLE: a +40 kg dip
 * moves a body plus forty, a push-up moves a body, and without it the app
 * leaves them out of session volume rather than printing one that undercounts.
 * Nudged by the app's coarse weight step (2 kg / 5 lb) because the nearest
 * couple of kilos is all volume needs.
 */
export function BodyweightSection({ onOpenBody }: { onOpenBody: () => void }) {
  const t = useT();
  const lang = useLanguage();
  const settings = useSettings();

  /**
   * ± on the bodyweight, in the user's own units. THE FIRST TAP SEEDS, it does
   * not nudge: starting from zero would walk up from 20 kg, while
   * `BODYWEIGHT_START_KG` puts a number on screen in one tap where it can be
   * read and corrected. Nothing is stored until this row is touched.
   */
  const bumpBodyweight = (direction: 1 | -1) => {
    tap();
    if (settings.bodyweightKg == null) {
      settings.setBodyweightKg(BODYWEIGHT_START_KG);
      return;
    }
    const { coarse } = weightSteps(settings.unitSystem);
    const display =
      settings.unitSystem === 'imperial' ? kgToLb(settings.bodyweightKg) : settings.bodyweightKg;
    const next = Number((display + coarse * direction).toFixed(2));
    settings.setBodyweightKg(settings.unitSystem === 'imperial' ? lbToKg(next) : next);
  };

  return (
    <>
      <ListCard className="mx-lg">
        <StepperRow
          label={t('Bodyweight')}
          hint={t('What makes push-ups, dips and assisted work countable')}
          value={
            settings.bodyweightKg == null
              ? t('Not set')
              : `${formatWeight(settings.bodyweightKg, settings.unitSystem)} ${unitLabel(settings.unitSystem, lang)}`
          }
          onDecrease={() => bumpBodyweight(-1)}
          onIncrease={() => bumpBodyweight(1)}
        />
        {settings.bodyweightKg != null ? (
          <>
            <Separator />
            <TextButton
              label={t('Clear my bodyweight')}
              onPress={() => {
                tap();
                settings.setBodyweightKg(undefined);
              }}
            />
          </>
        ) : null}
      </ListCard>
      <Text className="mx-lg mt-sm text-label text-ink-faint">
        {settings.bodyweightKg == null
          ? t(
              'Until this is set, a session of push-ups or dips reports no volume — the app will not guess what your body weighs. Nothing else reads it.',
            )
          : t(
              'Read only when working out session volume. It is not logged, charted or compared to anything.',
            )}
      </Text>
      {/* The log behind the number — the door to the Bodyweight screen. */}
      <View className="mx-lg mt-md">
        <BodyDoor onPress={onOpenBody} />
      </View>
      {/* 4.0: the weigh-in reminder lives with the bodyweight it asks for. */}
      <WeighInReminder />
    </>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Plays the two tones a real countdown uses — three ticks, then the long one — so
 * what you hear here is exactly what you'll hear at 0:03 of a rest.
 *
 * Driven by timeouts rather than by the real hook because there is no countdown
 * to attach to; this is the one place in the app where a cue is faked, and it is
 * faked from the same two sounds so it cannot mislead.
 */
function TestBeepRow() {
  const t = useT();
  const [playing, setPlaying] = useState(false);
  /*
   * The three pending tones, so leaving Settings mid-sequence takes them with it.
   * They used to be collected into a `const timers` that was immediately thrown
   * away with `void timers` under a comment saying there was nothing to clean up
   * — which left the last one to fire `countFinal()` and set state on a screen
   * the user had already walked away from, two seconds after they left.
   */
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );

  const play = () => {
    if (playing) return;
    setPlaying(true);
    countTick();
    timers.current = [
      setTimeout(() => countTick(), 700),
      setTimeout(() => countTick(), 1400),
      setTimeout(() => {
        countFinal();
        setPlaying(false);
      }, 2100),
    ];
  };

  return (
    <Pressable
      onPress={play}
      accessibilityRole="button"
      accessibilityLabel={t('Test the countdown beep')}
      style={pressedStyle}
      className="h-row flex-row items-center px-lg"
    >
      <Text className="flex-1 text-body font-medium text-ink">{t('Test the beep')}</Text>
      <Text className="mr-md text-label text-ink-faint">
        {playing ? t('counting…') : t('3 · 2 · 1 · go')}
      </Text>
      <Icon name="play" size={16} color={palette.greenBright} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */

/**
 * "Remind me to weigh in" — a switch, the days, the wheel, and when it fires next.
 *
 * Its own component rather than another block in this screen, because it owns
 * three things nothing else here does: a permission it has to ask about, a set of
 * days, and a picker that is 220px tall when it is open. Adapted from the
 * workout reminder it replaced (removed in 4.0); the decisions are
 * `lib/weighInReminder.ts`, and `hooks/useWeighInReminder.ts` arms them.
 *
 * ── IT STATES WHEN NOTHING WILL COME OF IT ────────────────────────────────
 *
 * This one is ON by default, so the "everything looks right and nothing
 * arrives" state is the default state on a phone that refused notifications at
 * install. The hook schedules nothing then, and this says so where the switch
 * is, with the one button that can fix it. Checked when the section mounts:
 * a permission changes in the phone's Settings, and coming back here re-mounts.
 *
 * ── THE WHEEL IS FOLDED AWAY ──────────────────────────────────────────────
 *
 * Under the switch, and only while it is on: a picker open under an off switch
 * is 220px of a control that does nothing.
 */
function WeighInReminder() {
  const t = useT();
  const lang = useLanguage();
  const enabled = useSettings((s) => s.weighInReminderEnabled);
  const days = useSettings((s) => s.weighInReminderDays);
  const time = useSettings((s) => s.weighInReminderTime);
  const setEnabled = useSettings((s) => s.setWeighInReminderEnabled);
  const toggleDay = useSettings((s) => s.toggleWeighInReminderDay);
  const setTime = useSettings((s) => s.setWeighInReminderTime);

  /** Null while it is still being asked. Nothing is said until there is an answer. */
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void notificationsGranted().then((ok) => {
      if (alive) setGranted(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  /** A fresh grant arms the alerts now, rather than at the next foreground. */
  const allowed = (state: 'granted' | 'denied' | 'blocked') => {
    setGranted(state === 'granted');
    if (state === 'granted') void syncWeighInFromSettings(true);
    return state;
  };

  const at = parseClockTime(time) ?? { hour: 6, minute: 0 };
  const next = granted ? nextWeighInAt(new Date(), { enabled, days, time }) : null;

  return (
    <>
      <Kicker className="mx-lg mb-sm mt-xxl">{t('Weigh-in reminder')}</Kicker>
      <ListCard className="mx-lg">
        <SwitchRow
          label={t('Remind me to weigh in')}
          hint={t('A notification at the time you set, on the days you picked.')}
          value={enabled}
          onChange={(on) => {
            setEnabled(on);
            // Asked HERE, at the switch — the one moment the user knows why.
            if (on) void ensureNotificationPermission().then(allowed);
          }}
        />
      </ListCard>

      {enabled ? (
        <>
          <Kicker className="mx-lg mb-sm mt-lg">{t('On which days')}</Kicker>
          <View className="mx-lg flex-row flex-wrap">
            {weekdayLabels(lang).map((label, index) => {
              const weekday = index as Weekday;
              return (
                <SelectChip
                  key={label + index}
                  label={label}
                  selected={days.includes(weekday)}
                  onPress={() => {
                    tap();
                    toggleDay(weekday);
                  }}
                />
              );
            })}
          </View>

          <Kicker className="mx-lg mb-sm mt-lg">{t('At what time')}</Kicker>
          <View className="mx-lg">
            <TimeWheel hour={at.hour} minute={at.minute} onChange={setTime} />
          </View>
          {next ? (
            <Text className="mx-lg mt-sm text-label text-ink-faint">
              {t('Next: {day} at {time}', {
                // Mid-sentence, so lower case in Russian ("среда"); English keeps its capital.
                day:
                  lang === 'ru'
                    ? weekdayNames(lang)[weekdayIndex(next)].toLowerCase()
                    : weekdayNames(lang)[weekdayIndex(next)],
                time: formatClockTime(next.getHours(), next.getMinutes()),
              })}
            </Text>
          ) : null}
        </>
      ) : null}

      {enabled && granted === false ? (
        <>
          <Text className="mx-lg mt-md text-label text-ink-faint">
            {t('Notifications are switched off for this app, so nothing will arrive.')}
          </Text>
          <View className="mx-lg">
            <TextButton
              label={t('Allow notifications')}
              tone="green"
              onPress={() => {
                void ensureNotificationPermission()
                  .then(allowed)
                  .then((state) => {
                    if (state !== 'granted') void openNotificationSettings();
                  });
              }}
            />
          </View>
        </>
      ) : null}
    </>
  );
}
