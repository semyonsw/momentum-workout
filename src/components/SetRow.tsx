/**
 * SetRow — the most important 56 dp in the app.
 *
 *   ┌──── 80 ────┬─────────┬─────────┬ 48 ┐
 *   │      [W]   │  20 kg  │ 8 reps  │ (✓)│  ← a warm-up: no number
 *   │      [1]   │  80 kg  │ 8 reps  │ (✓)│  ← up next: the lit row, the solid ✓
 *   │      [2]   │  80 kg  │ 8 reps  │ (✓)│
 *   └────────────┴─────────┴─────────┴────┘
 *   edit mode:  ⋮⋮ [1] │ 80 kg │ 8 reps │ (−)
 *
 * The grid is `lib/setRowLayout.ts` (80 | 1fr | 1fr | 48, gap 6), and the 2.9
 * redesign (#1) is the reason for every part of it:
 *
 *   • A NUMBER THAT DOES SOMETHING LOOKS LIKE IT. The set number, the weight and
 *     the reps are all WELLS (`ValueWell`) — a 40 dp sunken field with a hairline
 *     — where they used to be bare text, two of which were secretly buttons.
 *   • TAPPING WEIGHT OR REPS ALWAYS OPENS THE INLINE EDITOR — on every row, the
 *     lit up-next one included. The up-next row used to open focus mode instead,
 *     and long-pressing it did too; the row you were about to lift was the one row
 *     whose numbers you could not nudge in place, and nothing on it said so.
 *     Focus mode keeps its two labelled doors (the dock's `Focus` and the card's
 *     `Focus` chip) and no hidden ones. `lib/inlineEditor.ts` holds the rule.
 *   • THE 30 dp LEAD SLOT IS A SPACER rather than nothing, so the weight well's
 *     left edge is the same on every row. Edit mode puts the ⋮⋮ grip in it.
 *   • ONE SOLID GREEN THING PER ROW, AT MOST: the up-next row's ✓. Its row is lit
 *     (`acc` at 7 % with an `acc` edge) so the set to do next is findable at arm's
 *     length; a logged ✓ goes soft (`acc` at 14 %) because the log is history and
 *     the lit row below is what the eye should land on next.
 *   • A WARM-UP READS ONE STEP SMALLER (17 against 19) — it is a set that does
 *     not count, out of the volume and the set count, and its numbers step back
 *     with it. Its well reads `W`, and the working sets number around it: W 1 2 3.
 *   • THE ✓ IS CAUGHT, AND THE ROW FLASHES — on the transition only, so opening a
 *     finished card is not a light show.
 *   • A TIMED SET grows a ▶ left of the ✓ and keeps the ✓: ▶ is "run the clock",
 *     ✓ is "I did this", and a hold done away from the phone still logs in one tap.
 */

import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';

import { commit, tap, undo } from '../lib/feedback';
import type { DraftSet } from '../lib/draft';
import type { Exercise, UnitSystem } from '../types/models';
import { maxLabel, showsMaxLabel } from '../lib/maxReps';
import { countUnitLabel, formatCount, formatWeight, unitLabel } from '../lib/units';
import { SET_ROW, UNIT_FONT_SIZE, valueFontSize } from '../lib/setRowLayout';
import { useLanguage, useT } from '../hooks/useT';

import { palette, tint } from '../theme/tokens';
import { Icon } from './Icon';
import { Flash, Pop } from './motion';
import { RemoveRowButton, ValueWell } from './primitives';

export type SetField = 'weight' | 'count';

interface SetRowProps {
  set: DraftSet;
  /**
   * The WORKING-set number (1-based), or null for a warm-up, which reads `W`.
   * Computed by the card (`workingSetLabels`): it depends on the rows above.
   */
  workingNumber: number | null;
  /**
   * The all-out test of a ladder waiting for its max (`isMaxTestSet`): its count
   * reads `MAX` until reps are entered, exactly like a `MAX` exercise's row.
   */
  maxTest?: boolean;
  exercise: Exercise;
  unitSystem: UnitSystem;
  /** THE next set of the whole session. Lights the row — see the file header. */
  isUpNext?: boolean;
  /** Which field (if any) is open in the inline editor: its well gets the outline. */
  focusedField: SetField | null;
  /** This exercise is clock-driven: render the ▶. */
  isTimed?: boolean;
  /** The clock is running for THIS set. */
  isTiming?: boolean;
  onFocusField: (field: SetField) => void;
  onToggleComplete: () => void;
  /** Start the clock, or — while it runs — stop it and log what it read. */
  onPressTimer?: () => void;
  /**
   * EDIT MODE. Present = the row is drawn as `⋮⋮ | set | weight | reps | −`: the
   * grip takes the lead slot, the `−` (`RemoveRowButton`) takes the ✓'s, and
   * the `−` removes THIS row. Absent everywhere outside edit mode.
   */
  onRemove?: () => void;
  /**
   * Edit mode's grip, when the card implements drag-to-reorder: a long press on
   * the ⋮⋮ calls this. Absent = the grip is drawn as a mark only. Ignored outside
   * edit mode.
   */
  onGripLongPress?: () => void;
  /**
   * Replaces the default ⋮⋮ entirely, for a card whose drag needs its own
   * responder on the handle (a PanResponder, a gesture-handler view). It is drawn
   * in the 30 dp slot as given. Ignored outside edit mode.
   */
  grip?: ReactNode;
}

function SetRowComponent({
  set,
  workingNumber,
  maxTest = false,
  exercise,
  unitSystem,
  isUpNext = false,
  focusedField,
  isTimed = false,
  isTiming = false,
  onFocusField,
  onToggleComplete,
  onPressTimer,
  onRemove,
  onGripLongPress,
  grip,
}: SetRowProps) {
  const t = useT();
  const lang = useLanguage();
  const done = set.isCompleted;
  const editing = onRemove != null;
  /*
   * THE MOMENT A SET IS LOGGED, as opposed to the fact that it is: the pop and the
   * flash are keyed on the transition, so a row that mounts logged renders at rest.
   */
  const wasDone = useRef(done);
  const [loggedAt, setLoggedAt] = useState<number | null>(null);
  useEffect(() => {
    if (done && !wasDone.current) setLoggedAt(Date.now());
    if (!done) setLoggedAt(null);
    wasDone.current = done;
  }, [done]);
  /* A logged set is not "up next" however the card labels it. */
  const lit = isUpNext && !done;
  const countsMax = showsMaxLabel(exercise, set, maxTest);
  /*
   * The states table: logged and lit read full ink at 700; an un-logged row reads
   * muted at 600 — except a value the user has already changed from the carried
   * one, which is a fact now and reads ink (still 600, still not logged).
   */
  const strong = done || lit;
  const valueColor = strong || !set.isPrefilled ? palette.ink : palette.inkMuted;
  const valueStyle = {
    fontSize: valueFontSize(set.isWarmup),
    fontWeight: strong ? ('700' as const) : ('600' as const),
    color: valueColor,
  };

  const handleComplete = () => {
    // Medium impact on completion, light on undo — the hand can tell them apart.
    if (done) undo();
    else commit();
    onToggleComplete();
  };

  const weightText = formatWeight(set.weightKg, unitSystem, exercise.loadMode);
  const weightUnit = unitLabel(unitSystem, lang);
  const countText = countsMax
    ? maxLabel(lang).toUpperCase()
    : formatCount(set.count, exercise.countUnit);
  const countUnit = countsMax ? '' : countUnitLabel(exercise.countUnit, lang);

  const rowStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: SET_ROW.height,
    gap: SET_ROW.gap,
    borderRadius: ROW_RADIUS,
    borderWidth: 1,
    borderColor: lit ? tint(0.45) : 'transparent',
    backgroundColor: lit ? tint(0.07) : 'transparent',
  };

  return (
    <View>
      <View style={rowStyle}>
        {/* The flash. First child so everything paints over it; it takes nothing. */}
        {loggedAt != null ? <Flash key={loggedAt} radius={ROW_RADIUS} /> : null}

        {/* THE LEAD COLUMN, 80 dp whatever is in it: grip / spacer, 6, set well. */}
        <View style={{ width: SET_ROW.toggle, alignItems: 'center' }}>
          {editing ? (grip ?? <Grip onLongPress={onGripLongPress} />) : null}
        </View>
        <SetWell warmup={set.isWarmup} workingNumber={workingNumber} lit={lit} />

        {exercise.requiresWeight ? (
          <ValueWell
            onPress={() => onFocusField('weight')}
            lit={focusedField === 'weight'}
            emphasis={lit}
            style={WELL_STYLE}
            accessibilityLabel={t('Weight {weight} {unit}', {
              weight: weightText,
              unit: weightUnit,
            })}
          >
            <WellValue value={weightText} style={valueStyle}>
              <Unit text={weightUnit} />
            </WellValue>
          </ValueWell>
        ) : null}

        {/* Reps / rounds / minutes / metres. With no weight it takes both columns. */}
        <ValueWell
          onPress={() => onFocusField('count')}
          lit={focusedField === 'count'}
          emphasis={lit}
          style={WELL_STYLE}
          // `countText`, not the raw count: a timed set's count is seconds, and
          // "90 min" read aloud for a 1:30 hold is a different set.
          accessibilityLabel={countsMax ? maxLabel(lang) : `${countText} ${countUnit}`}
        >
          <WellValue value={countText} style={valueStyle}>
            {countUnit ? <Unit text={countUnit} /> : null}
          </WellValue>
        </ValueWell>

        {/* Run the clock: timed work only, until logged, and not while editing. */}
        {isTimed && !done && !editing ? (
          <Pressable
            onPress={() => {
              tap();
              onPressTimer?.();
            }}
            accessibilityRole="button"
            accessibilityLabel={
              isTiming
                ? t('Stop the timer and log this set')
                : t('Start the {count} timer', {
                    count: formatCount(set.count, exercise.countUnit),
                  })
            }
            style={{
              width: SET_ROW.logCircle,
              height: SET_ROW.logCircle,
              borderRadius: 9999,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: isTiming ? 0 : 1,
              borderColor: palette.hairline,
              backgroundColor: isTiming ? palette.acc : 'transparent',
            }}
          >
            <Icon name="play" size={16} color={isTiming ? palette.onAcc : palette.acc} />
          </Pressable>
        ) : null}

        {/* THE LOG COLUMN, 48: the ✓, or edit mode's `−` in its place. */}
        <View style={{ width: SET_ROW.log, alignItems: 'center' }}>
          {editing ? (
            <RemoveRowButton onPress={onRemove} accessibilityLabel={t('Remove this set')} />
          ) : (
            <Pressable
              onPress={handleComplete}
              hitSlop={4}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: done }}
              accessibilityLabel={done ? t('Undo set') : t('Complete set')}
              style={{
                width: SET_ROW.logCircle,
                height: SET_ROW.logCircle,
                borderRadius: 9999,
                alignItems: 'center',
                justifyContent: 'center',
                // Un-logged: a hairline ring. Lit and logged are fills, no ring.
                borderWidth: lit || done ? 0 : 1,
                borderColor: palette.hairline,
                backgroundColor: lit ? palette.acc : 'transparent',
              }}
            >
              {done ? (
                /* The soft fill, caught: it pops in when THIS tap logged it. */
                loggedAt != null ? (
                  <Pop key={loggedAt} duration={360} style={DONE_FILL}>
                    <Icon name="check" size={20} color={palette.acc} />
                  </Pop>
                ) : (
                  <View style={DONE_FILL}>
                    <Icon name="check" size={20} color={palette.acc} />
                  </View>
                )
              ) : (
                <Icon name="check" size={20} color={lit ? palette.onAcc : palette.inkMuted} />
              )}
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

/**
 * The set well: 44 × 40, the working number, or `W` for a warm-up — muted, since
 * it is a set that does not count. A number is muted too, and ink on the lit row,
 * where it is the label of the numbers about to be lifted.
 */
function SetWell({
  warmup,
  workingNumber,
  lit,
}: {
  warmup: boolean;
  workingNumber: number | null;
  lit: boolean;
}) {
  const t = useT();
  const label = warmup || workingNumber == null ? t('Warm-up') : t('Set {n}', { n: workingNumber });
  return (
    <ValueWell
      width={SET_ROW.setWell}
      emphasis={lit}
      style={{ paddingHorizontal: 4 }}
      accessibilityLabel={label}
    >
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        className="tabular-nums"
        style={{ fontSize: 17, fontWeight: '700', color: lit ? palette.ink : palette.inkMuted }}
      >
        {warmup || workingNumber == null ? 'W' : String(workingNumber)}
      </Text>
    </ValueWell>
  );
}

/**
 * Edit mode's ⋮⋮ — the visible twin of the drag (redesign §1). A mark only unless
 * the card wires `onGripLongPress`; 44 tall so it is a real target when it is one.
 */
function Grip({ onLongPress }: { onLongPress?: () => void }) {
  const t = useT();
  const glyph = <Icon name="grip" size={18} color={palette.inkMuted} />;
  if (!onLongPress) {
    return (
      <View
        accessible
        accessibilityLabel={t('Reorder this set')}
        style={{ height: 44, justifyContent: 'center' }}
      >
        {glyph}
      </View>
    );
  }
  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={200}
      hitSlop={{ left: 7, right: 7 }}
      accessibilityRole="button"
      accessibilityLabel={t('Reorder this set')}
      style={{ height: 44, justifyContent: 'center' }}
    >
      {glyph}
    </Pressable>
  );
}

/**
 * A value and the unit that rides beside it. The numeral
 * shrinks to fit before anything is cropped — the last resort under the width
 * budget `lib/setRowLayout.ts` tests at 360 dp.
 */
function WellValue({
  value,
  style,
  children,
}: {
  value: string;
  style: { fontSize: number; fontWeight: '600' | '700'; color: string };
  children?: ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        className="tabular-nums"
        style={[style, { flexShrink: 1 }]}
      >
        {value}
      </Text>
      {children ? <View style={{ marginLeft: SET_ROW.unitGap }}>{children}</View> : null}
    </View>
  );
}

function Unit({ text }: { text: string }) {
  return (
    <Text
      maxFontSizeMultiplier={1.2}
      numberOfLines={1}
      style={{ fontSize: UNIT_FONT_SIZE, fontWeight: '600', color: palette.inkMuted }}
    >
      {text}
    </Text>
  );
}

/** A set row's corner — the design's 14 for the lit row. */
const ROW_RADIUS = 14;

/** The value wells' tighter padding — see `SET_ROW.wellPadding`. */
const WELL_STYLE = { paddingHorizontal: SET_ROW.wellPadding };

/** The logged mark: the whole circle, `acc`-soft. */
const DONE_FILL: ViewStyle = {
  width: SET_ROW.logCircle,
  height: SET_ROW.logCircle,
  borderRadius: 9999,
  backgroundColor: tint(0.14),
  alignItems: 'center',
  justifyContent: 'center',
};

/**
 * Memoized: an 18-set session renders ~35 rows, and every tick of the rest timer
 * re-renders the screen. Rows must not repaint for someone else's state.
 */
export const SetRow = memo(SetRowComponent);
