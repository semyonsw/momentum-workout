/**
 * BodyScreen — the bodyweight log (design 16).
 *
 *   ‹ BODYWEIGHT
 *   ┌──────────────────────────────────────────────┐
 *   │ Weight                  ╲_╱╲_                │
 *   │ −7.3 kg since 12 January 2025                │
 *   │ ( − )  ╭      77.2 kg  ✎      ╮  ( + )       │   ← the well: tap to type
 *   │ ╭──────────── Log weight ─────────────╮      │
 *   └──────────────────────────────────────────────┘
 *
 * The value is a large well (with a small pencil) that opens the keypad, `±`
 * nudge it by the fine step, and `Log weight` records it. Every write is
 * `setBodyweightKg`, the same one the settings row uses, which updates the number
 * volume reads AND the dated log together — so it is one value with one history.
 * The decisions (where it starts, the step, the clamp) are `lib/weighIn.ts`.
 *
 * Rejected: a full chart with a range switch — the Graphs view already charts
 * bodyweight, and this screen is where a reading goes in, not where it is studied.
 *
 * ── OPENED FROM THE WEIGH-IN REMINDER (4.0) ──────────────────────────────
 *
 *   TIME TO WEIGH IN
 *   [ the card above, the well on the last reading ]
 *   ╭──────── Remind me tomorrow at 06:00 ────────╮
 *                       Skip
 *
 * A tap on "Time to weigh in" lands here (`AppShell`, `fromReminder`), and the
 * screen becomes a question with three answers, every one of which LEAVES: log
 * a weight, skip this one, or ask again tomorrow at the reminder's own time.
 * Staying on a log screen after answering is a screen the user then has to
 * dismiss by hand, at six in the morning. The keypad is NOT opened for them —
 * it would cover the other two answers — but the well already holds the last
 * reading, so a scale that agrees is one tap on `Log weight`. When "tomorrow"
 * is, is `lib/weighInReminder.ts`.
 */

import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { Icon } from '../components/Icon';
import { ScreenHeader } from '../components/ScreenHeader';
import { Sparkline } from '../components/Sparkline';
import { BubblePressable } from '../components/bubbles';
import { pressedStyle } from '../components/motion';
import { NumberSheet } from '../components/NumberSheet';
import { PrimaryButton, TextButton, ValueWell } from '../components/primitives';
import { useLanguage, useT } from '../hooks/useT';
import { dayKey, formatLongDay, formatShortDay } from '../lib/days';
import { dismissWeighInAlerts, scheduleWeighInSnooze } from '../lib/notify';
import { weighInCopy, weighInSnoozeAt } from '../lib/weighInReminder';
import { tap } from '../lib/feedback';
import { formatWeight, kgToLb, unitLabel } from '../lib/units';
import type { BodyweightEntry } from '../lib/bodyweightLog';
import { useSettings } from '../state/settingsStore';
import { nudgeWeighIn, weighInDisplay, weighInFromDisplay, weighInStart } from '../lib/weighIn';
import type { UnitSystem } from '../types/models';
import { glass, palette, radius } from '../theme/tokens';

export function BodyScreen({
  onBack,
  fromReminder = false,
  onDone,
}: {
  onBack: () => void;
  /** Opened by a tap on the weigh-in reminder — see the header. */
  fromReminder?: boolean;
  /** Leave after the reminder was answered, with what to say on the way out. */
  onDone?: (toast?: string) => void;
}) {
  const t = useT();
  const lang = useLanguage();
  const reminderTime = useSettings((s) => s.weighInReminderTime);
  const unitSystem = useSettings((s) => s.unitSystem);
  const bodyweightLog = useSettings((s) => s.bodyweightLog);
  const bodyweightKg = useSettings((s) => s.bodyweightKg);
  const setBodyweightKg = useSettings((s) => s.setBodyweightKg);
  /** The weight well's value — a draft until `Log weight`. See `WeightCard`. */
  const [weightDraft, setWeightDraft] = useState(() => weighInStart(bodyweightLog, bodyweightKg));
  const [typingWeight, setTypingWeight] = useState(false);
  const logWeight = (kg: number) => {
    tap();
    setWeightDraft(kg);
    setBodyweightKg(kg);
    if (fromReminder) answer();
  };
  /** The reminder has its answer: clear it from the shade and go. */
  const answer = (toast?: string) => {
    void dismissWeighInAlerts();
    (onDone ?? onBack)(toast);
  };
  const skip = () => {
    tap();
    answer();
  };
  const snooze = () => {
    tap();
    void scheduleWeighInSnooze(weighInSnoozeAt(new Date(), reminderTime), lang);
    answer(t('I’ll remind you tomorrow at {time}', { time: reminderTime }));
  };

  return (
    <View className="flex-1 bg-bg">
      <StatusBar style="light" />
      <ScreenHeader kicker={t('Bodyweight')} onBack={fromReminder ? skip : onBack} />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {fromReminder ? (
          <View className="mx-lg mt-md">
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 22, lineHeight: 28 }}
              className="font-semibold text-ink"
            >
              {weighInCopy(lang).title}
            </Text>
            <Text className="mt-xs text-label text-ink-muted">{weighInCopy(lang).body}</Text>
          </View>
        ) : null}
        <View className="mx-lg mt-md">
          <WeightCard
            log={bodyweightLog}
            unitSystem={unitSystem}
            draft={weightDraft}
            onDraft={setWeightDraft}
            onType={() => setTypingWeight(true)}
            onLog={logWeight}
          />
        </View>
        {fromReminder ? (
          <View className="mx-lg mt-lg">
            <PrimaryButton
              variant="ghost"
              label={t('Remind me tomorrow at {time}', { time: reminderTime })}
              onPress={snooze}
            />
            <TextButton label={t('Skip')} onPress={skip} />
          </View>
        ) : null}
      </ScrollView>

      {typingWeight ? (
        <NumberSheet
          title={t('Weight')}
          initial={weighInDisplay(weightDraft, unitSystem)}
          decimal
          confirmLabel={t('Log weight')}
          onConfirm={(value) => {
            setTypingWeight(false);
            logWeight(weighInFromDisplay(value, unitSystem));
          }}
          onCancel={() => setTypingWeight(false)}
        />
      ) : null}
    </View>
  );
}

/**
 * The bodyweight: its line and change, the value as a well, `±`, `Log weight`.
 *
 * The well holds a DRAFT until `Log weight` — nudging past 81.5 on the way to
 * 80.5 should not record 81 and 81.5 as weigh-ins. The keypad is the exception:
 * a typed number is a reading somebody just read off a scale, so its sheet's
 * button is `Log weight` itself rather than a Save that then needs a second tap.
 */
function WeightCard({
  log: bodyweightLog,
  unitSystem,
  draft,
  onDraft,
  onType,
  onLog,
}: {
  log: readonly BodyweightEntry[];
  unitSystem: UnitSystem;
  draft: number;
  onDraft: (update: (kg: number) => number) => void;
  /** The well: open the keypad (the sheet is the screen's, drawn over everything). */
  onType: () => void;
  onLog: (kg: number) => void;
}) {
  const t = useT();
  const lang = useLanguage();

  const toUnit = (kg: number) => (unitSystem === 'imperial' ? kgToLb(kg) : kg);
  const weightUnit = unitLabel(unitSystem, lang);
  const latest = bodyweightLog[0];
  const first = bodyweightLog[bodyweightLog.length - 1];
  let change = t('Nothing logged yet');
  if (latest && first) {
    const delta = Math.round((toUnit(latest.kg) - toUnit(first.kg)) * 10) / 10;
    const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
    const firstDay = dayKey(first.at);
    change =
      bodyweightLog.length < 2
        ? t('One reading')
        : t('{change} since {date}', {
            change: `${sign}${Math.abs(delta).toFixed(1)} ${weightUnit}`,
            date:
              firstDay.slice(0, 4) === dayKey(latest.at).slice(0, 4)
                ? formatShortDay(firstDay, lang)
                : formatLongDay(firstDay, lang),
          });
  }
  const values = [...bodyweightLog.slice(0, 12)].reverse().map((entry) => toUnit(entry.kg));
  const lo = Math.min(...values);
  const hi = Math.max(...values);

  return (
    <View
      style={{
        padding: 14,
        borderRadius: radius.row,
        borderWidth: 1,
        borderColor: glass.raisedEdge,
        backgroundColor: glass.raised,
      }}
    >
      <View className="flex-row items-center">
        <View className="flex-1 pr-sm" style={{ minWidth: 0 }}>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 16.5, lineHeight: 22 }}
            className="text-ink"
          >
            {t('Weight')}
          </Text>
          <Text maxFontSizeMultiplier={1.3} className="text-label tabular-nums text-ink-muted">
            {change}
          </Text>
        </View>
        {values.length > 1 ? (
          <View style={{ width: 72 }}>
            <Sparkline
              values={values}
              height={26}
              min={Math.floor(lo - 0.5)}
              max={Math.ceil(hi + 0.5)}
            />
          </View>
        ) : null}
      </View>

      <View className="mt-md flex-row items-center" style={{ gap: 8 }}>
        <NudgeButton
          icon="minus"
          label={t('Decrease {label}', { label: t('Weight') })}
          onPress={() => onDraft((kg) => nudgeWeighIn(kg, -1, unitSystem))}
        />
        <ValueWell
          onPress={onType}
          accessibilityLabel={`${t('Weight')}, ${formatWeight(draft, unitSystem)} ${weightUnit}`}
          accessibilityHint={t('Opens the keypad')}
          style={{ height: 56 }}
        >
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 24 }}
            className="font-semibold tabular-nums text-ink"
          >
            {formatWeight(draft, unitSystem)}
          </Text>
          <Text maxFontSizeMultiplier={1.3} className="ml-[3px] text-label text-ink-muted">
            {weightUnit}
          </Text>
          <View style={{ marginLeft: 8 }}>
            <Icon name="edit" size={14} color={palette.inkFaint} />
          </View>
        </ValueWell>
        <NudgeButton
          icon="plus"
          label={t('Increase {label}', { label: t('Weight') })}
          onPress={() => onDraft((kg) => nudgeWeighIn(kg, 1, unitSystem))}
        />
      </View>

      <View className="mt-md">
        <PrimaryButton label={t('Log weight')} onPress={() => onLog(draft)} />
      </View>
    </View>
  );
}

/** A 44 dp `−` / `+` beside the weight well, for nudges. */
function NudgeButton({
  icon,
  label,
  onPress,
}: {
  icon: 'plus' | 'minus';
  label: string;
  onPress: () => void;
}) {
  return (
    <BubblePressable
      onPress={() => {
        tap();
        onPress();
      }}
      radius="pill"
      accessibilityRole="button"
      accessibilityLabel={label}
      style={pressedStyle}
      className="h-hit w-[44px] items-center justify-center rounded-pill border border-hairline bg-surface-alt"
    >
      <Icon name={icon} size={16} color={palette.ink} />
    </BubblePressable>
  );
}
