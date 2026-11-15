/**
 * ExerciseCard — one exercise inside the active session.
 *
 * Collapsed (not the current exercise):
 *   ┌────────────────────────────────────────────┐
 *   │ Wide pull-ups machine               0/4    │
 *   │ 80 kg · 8 6 5 5                            │
 *   └────────────────────────────────────────────┘
 *
 * Expanded: ONE glass card (Momentum v3) holding the header, the `+ Warm-up`
 * toggle, the set rows as pills 6 apart, and a `Rest` footer.
 *
 * At most one card is expanded at a time, and NONE is a legal answer — tapping the
 * open card's header shuts it. That is the whole navigation model of the logging
 * screen: no tabs, no per-exercise route, no back button. The user moves down the
 * list as they move through the gym, and can shut the list down to eight names when
 * what they want is the shape of the session rather than the numbers in it.
 *
 * ── OPEN IS NOT THE SAME AS UP NEXT ─────────────────────────────────────────
 *
 * `isExpanded` is "this card is showing its sets". `upNextSetId` is "the one set
 * of the whole session that should happen next is this one, and it is in here" —
 * a fact about the LOG, computed by `lib/upNext.ts` and handed down. They usually
 * agree, and the two moments they do not are exactly the two moments the
 * distinction earns itself: the user has shut the card they are on, and the user
 * is reading a card further down the list. Opening a card to read it does not move
 * the mark; only a ✓ does.
 *
 * THE CARD HOLDING THE NEXT SET IS MARKED IN THE ACCENT, in both states:
 *
 *   • Shut — the name goes `acc` and the card moves onto the `lit` glass tier. With
 *     everything closed this is the only thing on screen saying where you are.
 *   • Open — the ring is not repeated (the open card is obviously the subject);
 *     the mark moves INSIDE, onto the one set row that should happen next. See
 *     `SetRow`'s `isUpNext`.
 *
 * ── THE PLAN IS BEHIND `Edit` ───────────────────────────────────────────────
 *
 * An open card used to carry every control that changes the PLAN under its sets,
 * all the time. Those are decisions made two or three times a workout, and they
 * sat a thumb's width from the ✓ that is pressed sixty times. So they moved
 * behind edit mode — and in the 2.9 redesign (#3) the door to it became a
 * labelled `✎ Edit` pill, because the unlabelled ✎ and bin circles it replaced
 * were two of the least-found controls in the app.
 *
 *   • THE HEADER is the name, a sub-line `4 sets · target 80 kg × 8`
 *     (`lib/exerciseCardLine.ts`), a `◎ Focus` chip on the card holding the
 *     session's next set — one of focus mode's only two doors, with the dock's —
 *     and the `Edit` pill.
 *   • OUTSIDE EDIT MODE the first row wears the `+ Warm-up` toggle (one set on
 *     top, `lib/warmup.ts`), and the footer is `⏱ Rest 1:30 ✎` — the chip runs a rest, the ✎ opens the editor
 *     that holds this exercise's rest. Taking an exercise out is in edit mode now;
 *     the one-tap bin beside the name went with the redesign.
 *   • IN EDIT MODE the pill becomes an acc-soft `✓ Done`, the sub-line reads
 *     `Editing · tap ⋮⋮ to move a set` (`lib/setOrder.ts`), every set row grows its grip and its red
 *     `−` (`SetRow`, so you remove the set you mean, not the bottom one), and the
 *     footer becomes full-width `+ Add set`, `Rest, targets and cue ›`, a
 *     divider, and the red `Remove exercise`.
 *
 * Edit mode belongs to the SCREEN, not to the card (`editingExerciseId`): at most
 * one card is in it, and it ends only on `Done`. Shutting the card or logging a
 * set does not end it — a user in the middle of reshaping an exercise who logs a
 * set on the way has not said they are finished reshaping it.
 *
 * ── ROWS ARRIVE AND LEAVE ───────────────────────────────────────────────────
 *
 * A row added — `Add set`, a warm-up, an Undo — grows in from zero height; a row
 * removed slides right and closes, and only THEN leaves the store (`GrowIn`). The
 * last row of an exercise is not removed on its own: removing it is removing the
 * exercise, so it goes through the same path `Remove exercise` does, and gets the
 * same Undo.
 *
 * ── `REMOVE EXERCISE` NO LONGER ASKS ────────────────────────────────────────
 *
 * It animates out and the screen shows `Removed Barbell row · Undo` for 4.5 s.
 * Sets already logged come back with the Undo, which is what the old sheet was
 * protecting; a question on every removal was that protection charged to the
 * nine removals out of ten that were meant.
 *
 * A long press LIFTS the card for reordering. The gesture and the movement live in
 * the screen (it owns the geometry of the list); this component only reports the
 * press and renders the two states it puts a card into — `lifted`, which follows
 * the finger, and `dimmed`, which is every other card while one is in the air. Same
 * language as the routine editor's reorder, deliberately.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import type { DraftEntry, DraftSet } from '../lib/draft';
import { workingSetLabels } from '../lib/draft';
import { exerciseSubline } from '../lib/exerciseCardLine';
import { shouldCloseEditor, visibleEditor } from '../lib/inlineEditor';
import { tap, undo } from '../lib/feedback';
import { isTimed as isTimedExercise } from '../lib/setTimer';
import { formatClock } from '../lib/units';
import { flushThen } from '../lib/typedFlush';
import type { ID, UnitSystem } from '../types/models';
import { curve, glass, glassTier, motion, palette, tint } from '../theme/tokens';
import { SpecularEdge } from './glass';
import { DragHandle, Icon } from './Icon';
import { useLanguage, useT } from '../hooks/useT';
import { useMotionScale } from '../hooks/useMotionScale';
import { GrowIn } from './motion';
import { DangerButton } from './primitives';
import { canMoveSet, movableRange } from '../lib/setOrder';
import { isMaxTestSet } from '../lib/repLadder';
import { warmupToggleState } from '../lib/warmup';
import { Pressable } from './Pressable';
import { QuickAdjust } from './QuickAdjust';
import { RollingNumber } from './RollingNumber';
import { FADE_ON, RunningText } from './RunningText';
import { SetRow, type SetField } from './SetRow';

interface ExerciseCardProps {
  entry: DraftEntry;
  /** This card is showing its sets. At most one card in the list is. */
  isExpanded: boolean;
  /**
   * THE session's next set, when it is one of this card's — otherwise null.
   *
   * Decided by `lib/upNext.ts` off what has been logged, not by which card is
   * open: reaching down the list to read an exercise must not move the mark off
   * the set you are about to do. Exactly one card in the list gets a non-null
   * value, and it is the card that glows. See the file header.
   */
  upNextSetId?: ID | null;
  unitSystem: UnitSystem;
  /** The set in this card whose clock is running, if any. */
  timingSetId?: ID | null;
  /** This card is being dragged: it follows the finger and marks itself. */
  isLifted?: boolean;
  /** Another card is being dragged, so this one is not the subject right now. */
  dimmed?: boolean;
  /**
   * Open focus mode on the session's next set — the header's `Focus` chip.
   *
   * Only handed to the card that HOLDS that set (see `upNextSetId`), because focus
   * mode always shows the work: a `Focus` chip on a card you opened to read would
   * take you somewhere else in the session, which is the same confusion the glow
   * was moved off the cursor to avoid.
   */
  onOpenFocus?: () => void;
  /**
   * Focus mode is on screen over the list. Every inline editor closes — focus
   * mode writes the numbers past this card, and an editor left open under it came
   * back stale. See `lib/inlineEditor.ts`.
   */
  focusModeOpen?: boolean;
  /** Tap: open this card, or shut it when it is already the open one. */
  onToggleExpanded: () => void;
  /** Long press — the screen turns this into a drag. Absent = not reorderable. */
  onLift?: () => void;
  onToggleSet: (setId: ID) => void;
  onPatchSet: (setId: ID, patch: Partial<DraftSet>) => void;
  onAddSet: () => void;
  /**
   * The first row's `Warm-up` toggle — insert one warm-up on top, or take the
   * unlogged one back off (`lib/warmup.ts`). Absent = no toggle.
   */
  onToggleWarmup?: () => void;
  /**
   * Take one row out of the STORE. Called after the row's exit animation, never
   * before — and never for the last row, which goes through `onRemoveExercise`.
   */
  onRemoveSet: (setId: ID) => void;
  /** Put a set at another index — edit mode's ⋮⋮ (`lib/setOrder.ts`). Absent = no moving. */
  onMoveSet?: (setId: ID, toIndex: number) => void;
  /**
   * Session edit mode is on for THIS card — see the file header. The screen owns
   * it, so at most one card is ever in it.
   */
  isEditing?: boolean;
  /** The ✎ and the `Done` pill. Absent = no edit mode on this card. */
  onToggleEditing?: () => void;
  /** Start the clock for a set, or stop the one already running on it. */
  onPressTimer: (setId: ID) => void;
  /**
   * The user's between-sets rest, in seconds — what the `Rest` button will run.
   * Read live from Settings by the screen, so the button's label and the timer it
   * starts are the same number.
   */
  restSeconds?: number;
  /**
   * Start a rest by hand. Only the expanded card gets it, and it is the answer to
   * "auto-rest is off, so how do I run a rest at all" — plus the way back from a
   * `Skip` you didn't mean.
   */
  onStartRest?: () => void;
  /**
   * Drop this exercise, sets and all — edit mode's `Remove exercise`, and the `−`
   * on its last row. The screen animates the card out and offers the Undo.
   */
  onRemoveExercise?: () => void;
  /**
   * Open the exercise editor on THIS movement, mid-workout.
   *
   * The rest between its sets, the weight and count it starts at, how many sets it
   * plans, its ladder, its clock — every one of those is a fact you discover while
   * doing the exercise, and every one of them lived behind three screens: leave the
   * session, find the Library tab, open the tree, find the row. Nobody does that
   * between sets, so the numbers stayed wrong.
   *
   * The edit lands on this card immediately — `activeWorkoutStore.syncExercise`,
   * called by the shell — because an edit made on the open card that only took
   * effect next Tuesday would be the same "I changed it and nothing happened" that
   * `lib/rest.ts` is about.
   */
  onEditExercise?: () => void;
}

function ExerciseCardComponent({
  entry,
  isExpanded,
  upNextSetId = null,
  unitSystem,
  timingSetId = null,
  isLifted = false,
  dimmed = false,
  onOpenFocus,
  focusModeOpen = false,
  onToggleExpanded,
  onLift,
  onToggleSet,
  onPatchSet,
  onAddSet,
  onToggleWarmup,
  onRemoveSet,
  isEditing = false,
  onMoveSet,
  onToggleEditing,
  onPressTimer,
  restSeconds = 0,
  onStartRest,
  onRemoveExercise,
  onEditExercise,
}: ExerciseCardProps) {
  /** Which set row has the editor open, and on which field. Card-local state. */
  const t = useT();
  const lang = useLanguage();
  const [openEditor, setFocus] = useState<{ setId: ID; field: SetField } | null>(null);
  /*
   * The open editor's "commit what is typed", registered by `QuickAdjust`. Every
   * press on a row that closes the editor calls it FIRST (`flushThen`): the list
   * keeps the keyboard up across taps, so no blur commits a typed 85 before the ✓
   * logs the set at the old 80 — see `lib/typedFlush.ts`.
   */
  const flushEditor = useRef<(() => void) | null>(null);
  /*
   * The editor actually drawn. Focus mode owns the up-next row's numbers, and
   * while it is on screen it owns every number — see `lib/inlineEditor.ts` for the
   * stale box this used to leave behind.
   */
  const editorContext = {
    setIds: entry.sets.map((s) => s.localId),
    focusModeOpen,
  };
  const focus = visibleEditor(openEditor, editorContext);
  const closeEditor = shouldCloseEditor(openEditor, editorContext);
  useEffect(() => {
    if (closeEditor) setFocus(null);
  }, [closeEditor]);
  /** Rows on their way out — still drawn, closing, and not yet out of the store. */
  const [leaving, setLeaving] = useState<ReadonlySet<ID>>(() => new Set());
  /**
   * The rows this card has already drawn, so a row it has NOT is one that just
   * arrived and grows in. Seeded with what was there at mount: opening a card is
   * not four rows arriving.
   */
  const known = useRef<Set<ID>>(new Set(entry.sets.map((s) => s.localId)));
  useEffect(() => {
    for (const set of entry.sets) known.current.add(set.localId);
  }, [entry.sets]);

  const completed = entry.sets.filter((s) => s.isCompleted).length;
  const total = entry.sets.length;
  const allDone = completed === total && total > 0;
  /*
   * W, 1, 2, 3 — warm-ups are not numbered as working sets, and the working sets
   * number around them. Derived in `lib/draft.ts`: it is arithmetic over the list,
   * and a component subtracting a running count from an index is a component with
   * a state machine in it.
   */
  /*
   * THE LIFTED ROW, while a set is being moved: tap ⋮⋮ to lift, tap ⋮⋮ where it
   * goes. Dropped when edit mode ends — a lift never outlives the mode it began in.
   */
  const [liftedSetId, setLiftedSetId] = useState<ID | null>(null);
  useEffect(() => {
    if (!isEditing) setLiftedSetId(null);
  }, [isEditing]);
  const setLabels = workingSetLabels(entry.sets);
  /* Which way the first row's warm-up toggle goes, if it is drawn at all. */
  const warmupToggle = onToggleWarmup && !isEditing ? warmupToggleState(entry.sets) : null;
  const isRounds = entry.exercise.countUnit === 'rounds';
  const isTimed = isTimedExercise(entry.exercise);
  const unit = isRounds ? t('round') : t('set');

  /**
   * The `−` on a row. The LAST row is the exercise — see the file header — so it
   * is handed to the screen's removal, Undo and all, rather than to the store.
   */
  const removeRow = (setId: ID) => {
    undo();
    flushEditor.current?.();
    setFocus(null);
    const remaining = entry.sets.filter((s) => !leaving.has(s.localId)).length;
    if (remaining <= 1) {
      onRemoveExercise?.();
      return;
    }
    setLeaving((current) => new Set(current).add(setId));
  };

  /*
   * Each row's handlers, made once per set and reading the card's latest state
   * through `live` when pressed. `SetRow` is memoized, and four fresh closures
   * per row per render meant every row of the open card repainted on every ✓
   * and every ± chip.
   */
  const live = useRef({
    removeRow,
    onPressTimer,
    onToggleSet,
  });
  live.current = {
    removeRow,
    onPressTimer,
    onToggleSet,
  };
  const rowHandlers = useRef(new Map<ID, RowHandlers>()).current;
  const handlersFor = (setId: ID): RowHandlers => {
    const known = rowHandlers.get(setId);
    if (known) return known;
    const handlers: RowHandlers = {
      onRemove: () => live.current.removeRow(setId),
      onPressTimer: () =>
        flushThen(flushEditor.current, () => {
          setFocus(null); // the clock and the editor never share the row
          live.current.onPressTimer(setId);
        }),
      onFocusField: (field) =>
        flushThen(flushEditor.current, () =>
          setFocus((current) =>
            // Tapping the open field again closes the panel.
            current?.setId === setId && current.field === field ? null : { setId, field },
          ),
        ),
      onToggleComplete: () =>
        flushThen(flushEditor.current, () => {
          setFocus(null); // committing a set always closes the editor
          live.current.onToggleSet(setId);
        }),
    };
    rowHandlers.set(setId, handlers);
    return handlers;
  };

  /* ---------------------------------------------------------------- */
  /* Collapsed                                                         */
  /* ---------------------------------------------------------------- */
  if (!isExpanded) {
    /*
     * The glow. Only on the card holding the session's next set — which already
     * means it has a set left — and only while nothing is being dragged: a green
     * ring on a dimmed card in a list where another card is in the air is two
     * signals fighting.
     *
     * `boxShadow` is the app's one deliberate exception to "exactly one shadow"
     * (`theme/tokens.ts`), and it is spent here because this mark has to be
     * findable at arm's length on a bench. It is decoration on top of the border,
     * never instead of it: on a renderer that ignores it the green ring and the
     * green name still say everything.
     */
    const glowing = upNextSetId != null && !isLifted && !dimmed;
    return (
      <Pressable
        onPress={onToggleExpanded}
        onLongPress={onLift}
        delayLongPress={280}
        accessibilityRole="button"
        accessibilityState={{ expanded: false }}
        accessibilityLabel={`${t('{name}, {done} of {total} sets done', {
          name: entry.exercise.name,
          done: completed,
          total,
        })}${glowing ? `, ${t('your next set is in here')}` : ''}`}
        accessibilityHint={onLift ? t('Long press, then slide to reorder') : undefined}
        style={[
          /* Momentum v3: a flat `card`-tier pane, radius 20 — or the `lit` tier
             when it holds the next set. Flat, never blurred: it repeats. */
          {
            borderRadius: COLLAPSED_RADIUS,
            borderWidth: 1,
            padding: 16,
            backgroundColor: glowing || isLifted ? glassTier.lit.tint : glassTier.card.tint,
            borderColor: glowing || isLifted ? glassTier.lit.border : glassTier.card.border,
          },
          dimmed ? { opacity: 0.4 } : null,
        ]}
        className="mx-lg mb-sm"
      >
        <View className="flex-row items-center">
          {/* The grip (U11): a hold lifts this card, and nothing else on it said
              so. Only where the card can move. */}
          {onLift ? (
            <View className="mr-sm">
              <DragHandle color={isLifted ? palette.greenBright : palette.inkFaint} />
            </View>
          ) : null}
          {/* The name RUNS rather than ellipsising: two machines whose names
              differ only at the end are two exercises. See `RunningText`. */}
          <RunningText
            text={entry.exercise.name}
            containerStyle={{ flex: 1 }}
            fadeColor={isLifted || glowing ? FADE_ON.lit : FADE_ON.card}
            className={[
              'text-task',
              glowing ? 'font-semibold text-acc' : allDone ? 'text-ink-faint' : 'text-ink',
            ].join(' ')}
          />

          {/* Progress as text, rolled when a set lands, and as a ring beside it:
              the text for reading, the ring for the shape of the list at a glance. */}
          <RollingNumber
            value={`${completed}/${total}`}
            lineHeight={20}
            duration={450}
            containerStyle={COUNTER_STYLE}
            className="text-label font-semibold text-ink-muted"
          />
          <View className="ml-sm">
            <MiniRing fraction={total > 0 ? completed / total : 0} done={allDone} />
          </View>
        </View>

        {/* One line of context: what happened last time. */}
        {entry.lastSessionSummary ? (
          <Text
            style={{ fontSize: 13.5, lineHeight: 18 }}
            className="mt-[2px] tabular-nums text-ink-faint"
          >
            {entry.lastSessionSummary}
          </Text>
        ) : null}
      </Pressable>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Expanded                                                          */
  /* ---------------------------------------------------------------- */
  /* The rest chip needs something to do: run a rest (the cursor's card) or
     open the editor that holds it. */
  const showRest = restSeconds > 0 && (onStartRest != null || onEditExercise != null);

  return (
    <View
      className="mx-lg mb-sm mt-xs"
      style={[{ borderRadius: EXPANDED_RADIUS }, dimmed ? { opacity: 0.4 } : null]}
    >
      {/* Momentum v3: ONE card for the whole exercise — name, plan, rows
          and footer — on the flat `card` tier. It repeats down the list, so it
          is never blurred; the rest card above is the lit one. */}
      <View
        style={[
          {
            borderRadius: EXPANDED_RADIUS,
            overflow: 'hidden',
            borderWidth: 1,
            padding: 16,
            backgroundColor: glassTier.card.tint,
            borderColor: isLifted ? glassTier.lit.border : glassTier.card.border,
          },
        ]}
      >
        <SpecularEdge color="rgba(236,241,238,0.10)" radius={EXPANDED_RADIUS} />

        {/* Header — name, then the target, then what it was last time. It is
            also the expanded card's grab handle: long-pressing a set row would
            fight the row's own controls, and this is the one part of the card
            that isn't one. */}
        <View className="flex-row items-start">
          <Pressable
            onPress={onToggleExpanded}
            onLongPress={onLift}
            delayLongPress={280}
            accessibilityRole="button"
            accessibilityState={{ expanded: true }}
            accessibilityLabel={entry.exercise.name}
            accessibilityHint={
              onLift
                ? t('Tap to close its sets. Long press, then slide to reorder')
                : t('Tap to close its sets')
            }
            className="flex-1 flex-row items-start"
          >
            {/* The grip (U11): this header is the card's grab handle, and now it
                says so. A mark only — the hold is what lifts. */}
            {onLift ? (
              <View className="mr-sm" style={{ marginTop: 4 }}>
                <DragHandle color={isLifted ? palette.greenBright : palette.inkFaint} />
              </View>
            ) : null}
            <View className="flex-1">
              <Text
                style={{ fontSize: 19, lineHeight: 24 }}
                className={['font-semibold', isLifted ? 'text-acc' : 'text-ink'].join(' ')}
              >
                {entry.exercise.name}
              </Text>
              {/* The sub-line: the plan in the order it is read (`4 sets · target
                  80 kg × 8`), or — for as long as edit mode lasts — the mode,
                  said in words, in the accent. */}
              {isEditing ? (
                <Text
                  style={{ fontSize: 14, lineHeight: 19 }}
                  className="mt-xs font-medium text-acc"
                >
                  {liftedSetId
                    ? t('Now tap ⋮⋮ where it should go')
                    : onMoveSet && movableRange(entry.sets)
                      ? t('Editing · tap ⋮⋮ to move a set')
                      : t('Editing')}
                </Text>
              ) : (
                <Text
                  style={{ fontSize: 14, lineHeight: 19 }}
                  className="mt-xs tabular-nums text-ink-muted"
                >
                  {exerciseSubline(entry, unitSystem, lang)}
                  {entry.exercise.isUnilateral ? ` · ${t('each side')}` : ''}
                  {entry.lastSessionShort
                    ? ` · ${t('last: {what}', { what: entry.lastSessionShort })}`
                    : ''}
                </Text>
              )}

              {/* THE CUE. Only on the OPEN card, faint and single-line: reference
                that must never compete with the numbers below it. */}
              {entry.exercise.cue ? (
                <Text numberOfLines={1} className="mt-xs text-label text-ink-faint">
                  {entry.exercise.cue}
                </Text>
              ) : null}
            </View>
          </Pressable>

          {/* FOCUS, by name and by the one Focus icon (redesign #5) — only on the
              card holding the session's next set, because focus mode always
              shows the work. Not while editing: that is the plan, not the set. */}
          {onOpenFocus && !isEditing ? (
            <HeaderPill
              icon="focus"
              label={t('Focus')}
              tone="acc"
              accessibilityLabel={t('Open focus mode on your next set')}
              onPress={onOpenFocus}
            />
          ) : null}

          {/* THE DOOR INTO EDIT MODE, and the way out of it — one labelled pill
              in place of the unlabelled ✎ and bin circles (redesign #3). */}
          {onToggleEditing ? (
            isEditing ? (
              <HeaderPill
                icon="check"
                label={t('Done')}
                tone="soft"
                accessibilityLabel={t('Done editing the plan')}
                onPress={onToggleEditing}
              />
            ) : (
              <HeaderPill
                icon="edit"
                label={t('Edit')}
                tone="muted"
                accessibilityLabel={t('Edit the plan of {name}', { name: entry.exercise.name })}
                onPress={onToggleEditing}
              />
            )
          ) : null}
        </View>

        <View className="mt-md">
          {/* THE WARM-UP TOGGLE, sitting on the first row it changes: `+ Warm-up`
              inserts one set on top, and the same chip — lit while that set is
              there and unlogged — takes it back off. */}
          {warmupToggle && onToggleWarmup ? (
            <WarmupChip on={warmupToggle === 'remove'} onPress={onToggleWarmup} />
          ) : null}
          {entry.sets.map((set, index) => (
            <GrowIn
              key={set.localId}
              appear={!known.current.has(set.localId)}
              leaving={leaving.has(set.localId)}
              onLeft={() => {
                setLeaving((current) => {
                  const next = new Set(current);
                  next.delete(set.localId);
                  return next;
                });
                onRemoveSet(set.localId);
              }}
            >
              {/* 6 between rows, inside the GrowIn so a leaving row takes its
                  gap with it. */}
              <View style={index > 0 ? { marginTop: 6 } : undefined}>
                {/* The max test says what it is, on the row, until it is done. */}
                {!set.isCompleted && isMaxTestSet(entry, set.localId) ? (
                  <Text className="mb-xs ml-xs text-label font-semibold text-acc">
                    {t('Max reps — go all out')}
                  </Text>
                ) : null}
                <SetRow
                  set={set}
                  workingNumber={setLabels[index]}
                  maxTest={isMaxTestSet(entry, set.localId)}
                  exercise={entry.exercise}
                  unitSystem={unitSystem}
                  /* The mark for "do this one". Every card has a next row; only
                     one row in the session is THE next row, and lighting all of
                     them would mark nothing. `upNextSetId` is that row. */
                  isUpNext={set.localId === upNextSetId}
                  focusedField={focus?.setId === set.localId ? focus.field : null}
                  isTimed={isTimed}
                  isTiming={timingSetId === set.localId}
                  /* Edit mode's `−`, on every row — see the file header. */
                  onRemove={isEditing ? handlersFor(set.localId).onRemove : undefined}
                  grip={
                    isEditing && onMoveSet ? (
                      <SetGrip
                        movable={canMoveSet(entry.sets, set.localId)}
                        lifted={liftedSetId === set.localId}
                        anyLifted={liftedSetId != null}
                        position={index + 1}
                        onPress={() => {
                          if (liftedSetId == null) setLiftedSetId(set.localId);
                          else {
                            if (liftedSetId !== set.localId) onMoveSet(liftedSetId, index);
                            setLiftedSetId(null);
                          }
                        }}
                        onStep={(by) => onMoveSet(set.localId, index + by)}
                      />
                    ) : undefined
                  }
                  onPressTimer={handlersFor(set.localId).onPressTimer}
                  onFocusField={handlersFor(set.localId).onFocusField}
                  onToggleComplete={handlersFor(set.localId).onToggleComplete}
                />
              </View>

              {focus?.setId === set.localId ? (
                /* The inline editor opens by growing its own height, so the rows
                   under it are pushed rather than jumped. */
                <GrowIn duration={260}>
                  <QuickAdjust
                    field={focus.field}
                    set={set}
                    exercise={entry.exercise}
                    unitSystem={unitSystem}
                    onChange={(patch) => onPatchSet(set.localId, patch)}
                    onClose={() => setFocus(null)}
                    /* `Log set` is the row's ✓: it closes the editor and logs. */
                    onLog={handlersFor(set.localId).onToggleComplete}
                    flushRef={flushEditor}
                  />
                </GrowIn>
              ) : null}
            </GrowIn>
          ))}
        </View>

        {isEditing ? (
          /*
           * EDIT MODE'S FOOTER (redesign #3): full-width secondary buttons, one
           * per plan edit, in the order they are reached for — another set, the
           * exercise's own numbers — then a divider and the one
           * red button. Full width and labelled, because the half-width cells
           * they replaced were read as a table rather than as buttons.
           */
          <GrowIn key="editing" duration={motion.row}>
            <View className="mt-md" style={{ gap: 8 }}>
              <FooterButton
                label={`+ ${t('Add {unit}', { unit })}`}
                onPress={() => {
                  tap();
                  onAddSet();
                }}
              />
              {/* The plan's own numbers — rest, defaults, targets, the cue — in
                  the exercise editor, mid-workout. */}
              {onEditExercise ? (
                <FooterButton
                  label={`${t('Rest, targets and cue')} ›`}
                  accessibilityLabel={t('Edit {name}: rest, defaults and targets', {
                    name: entry.exercise.name,
                  })}
                  onPress={() => {
                    tap();
                    onEditExercise();
                  }}
                />
              ) : null}
              {/* The way out of an exercise. It does not ask: the screen offers
                  the Undo. The danger style lives in `DangerButton`. */}
              {onRemoveExercise ? (
                <>
                  <View className="my-xs h-hairline bg-hairline" />
                  <DangerButton
                    label={t('Remove exercise')}
                    accessibilityHint={t('Remove {name} from this workout', {
                      name: entry.exercise.name,
                    })}
                    onPress={() => {
                      undo();
                      onRemoveExercise();
                    }}
                  />
                </>
              ) : null}
            </View>
          </GrowIn>
        ) : showRest ? (
          /*
           * THE NORMAL FOOTER (redesign #3): `Rest 1:30` with a trailing ✎, so it reads as a number you
           * can change: the chip runs a rest now (the answer to "auto-rest is
           * off, how do I rest at all"), the ✎ opens the editor that holds the
           * exercise's rest. `+ Add set` / `− Remove set` moved into edit mode
           * with every other plan edit; one tap on `Edit` away.
           */
          <View className="mt-md flex-row" style={{ gap: 8 }}>
            <RestChip
              label={t('Rest {clock}', { clock: formatClock(restSeconds) })}
              startLabel={t('Start a {clock} rest', { clock: formatClock(restSeconds) })}
              onStart={onStartRest}
              onEdit={onEditExercise}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */

/** A row's handlers, bound to its set once — see `handlersFor`. */
interface RowHandlers {
  onRemove: () => void;
  onPressTimer: () => void;
  onFocusField: (field: SetField) => void;
  onToggleComplete: () => void;
}

/** Hoisted: `RollingNumber` is memoized, and an inline object is a new prop. */
const COUNTER_STYLE = { marginLeft: 10 };

/** The expanded card's corner — the design's 22. */
const EXPANDED_RADIUS = 22;
/** A collapsed card's corner — the design's 20, `radius.card`. */
const COLLAPSED_RADIUS = 20;

/**
 * A header pill (redesign #3, #5): icon + word, 36 dp drawn and 44 dp to the
 * finger. `acc` is Focus (the accent outline — it goes to the work), `muted` is
 * Edit, and `soft` is edit mode's Done — the acc-soft fill, saying the card is
 * in a mode without shouting it the way a solid pill would.
 */
function HeaderPill({
  icon,
  label,
  tone,
  onPress,
  accessibilityLabel,
}: {
  icon: 'focus' | 'edit' | 'check';
  label: string;
  tone: 'acc' | 'muted' | 'soft';
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const color = tone === 'muted' ? palette.inkMuted : palette.acc;
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      hitSlop={{ top: 4, bottom: 4, left: 3, right: 3 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        marginLeft: 6,
        height: 36,
        paddingHorizontal: 12,
        borderRadius: 9999,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: tone === 'muted' ? glass.raisedEdge : tint(0.45),
        backgroundColor:
          tone === 'soft' ? tint(0.14) : pressed ? 'rgba(236,241,238,0.09)' : glass.raised,
      })}
    >
      <Icon name={icon} size={15} color={color} />
      <Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        style={{ color, marginLeft: 6 }}
        className="text-label font-semibold"
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * `⏱ Rest 1:30 ✎` — one chip, two targets. The body runs the rest now; the
 * trailing ✎ (its own 44 dp target) opens the editor that holds the exercise's
 * rest. Either may be absent — a card that is not the cursor cannot run a rest,
 * and then the whole chip is the way to the editor.
 */
function RestChip({
  label,
  startLabel,
  onStart,
  onEdit,
}: {
  label: string;
  startLabel: string;
  onStart?: () => void;
  onEdit?: () => void;
}) {
  const t = useT();
  const body = onStart ?? onEdit;
  return (
    <View
      style={{
        flex: 1,
        height: 44,
        borderRadius: 9999,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: glass.raised,
        borderWidth: 1,
        borderColor: 'rgba(236,241,238,0.08)',
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={() => {
          tap();
          body?.();
        }}
        accessibilityRole="button"
        accessibilityLabel={onStart ? startLabel : t('Change the rest: {what}', { what: label })}
        style={({ pressed }) => ({
          flex: 1,
          height: 44,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingLeft: 14,
          backgroundColor: pressed ? 'rgba(236,241,238,0.06)' : 'transparent',
        })}
      >
        <Icon name="timer" size={15} color={palette.inkMuted} />
        <Text
          numberOfLines={1}
          style={{ marginLeft: 6 }}
          className="text-label font-medium tabular-nums text-ink-muted"
        >
          {label}
        </Text>
      </Pressable>
      {onEdit ? (
        <Pressable
          onPress={() => {
            tap();
            onEdit();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('Change the rest: {what}', { what: label })}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? 'rgba(236,241,238,0.06)' : 'transparent',
          })}
        >
          <Icon name="edit" size={14} color={palette.inkFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * `+ Warm-up` / `✓ Warm-up` — the first row's toggle. A pill rather than a
 * switch, because its effect is a ROW appearing above it and the pill reads as
 * the thing that row belongs to; lit (acc-soft, check) while the warm-up is on.
 */
function WarmupChip({ on, onPress }: { on: boolean; onPress: () => void }) {
  const t = useT();
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      hitSlop={{ top: 6, bottom: 6 }}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={on ? t('Remove the warm-up set') : t('Add a warm-up set on top')}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        height: 32,
        marginBottom: 8,
        paddingHorizontal: 12,
        borderRadius: 9999,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: on ? tint(0.45) : glass.raisedEdge,
        backgroundColor: on ? tint(0.14) : pressed ? 'rgba(236,241,238,0.09)' : glass.raised,
      })}
    >
      {on ? <Icon name="check" size={14} color={palette.acc} /> : null}
      <Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        style={{ color: on ? palette.acc : palette.inkMuted, marginLeft: on ? 6 : 0 }}
        className="text-label font-semibold"
      >
        {on ? t('Warm-up') : `+ ${t('Warm-up')}`}
      </Text>
    </Pressable>
  );
}

/**
 * One full-width secondary button of edit mode's footer: 48 high, glass, the
 * label centred.
 */
function FooterButton({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => ({
        minHeight: 48,
        borderRadius: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: glass.raisedEdge,
        backgroundColor: pressed ? 'rgba(236,241,238,0.09)' : glass.raised,
      })}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        className="text-body font-medium text-ink"
      >
        {label}
      </Text>
    </Pressable>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const RING_SIZE = 22;
const RING_STROKE = 2.5;
const RING_R = (RING_SIZE - RING_STROKE * 2) / 2 + RING_STROKE / 2;
const RING_LENGTH = 2 * Math.PI * RING_R;

/**
 * The collapsed card's progress ring: 22 dp, a hairline track, `green-bright`
 * fill — `ink-faint` once the exercise is done, because done is history — and
 * the arc travels to its new share over 600 ms when a set lands.
 */
function MiniRing({ fraction, done }: { fraction: number; done: boolean }) {
  const scale = useMotionScale();
  const clamped = Math.max(0, Math.min(1, fraction));
  const v = useRef(new Animated.Value(clamped)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: clamped,
      duration: 600 * scale,
      easing: curve(motion.ease),
      // strokeDashoffset is an SVG prop, not a transform: JS driver.
      useNativeDriver: false,
    }).start();
  }, [clamped, scale, v]);
  const offset = useMemo(
    () => v.interpolate({ inputRange: [0, 1], outputRange: [RING_LENGTH, 0] }),
    [v],
  );
  return (
    <Svg
      width={RING_SIZE}
      height={RING_SIZE}
      style={{ transform: [{ rotate: '-90deg' }] }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_R}
        fill="none"
        stroke={palette.hairline}
        strokeWidth={RING_STROKE}
      />
      <AnimatedCircle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_R}
        fill="none"
        stroke={done ? palette.inkFaint : palette.acc}
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={RING_LENGTH}
        strokeDashoffset={offset}
      />
    </Svg>
  );
}

export const ExerciseCard = memo(ExerciseCardComponent);

/**
 * Edit mode's ⋮⋮ on one set row: tap to lift it, tap another row's ⋮⋮ to drop
 * it there, tap the lifted one again to put it down where it was. A row that may
 * not move (a logged set, history) draws the mark faint and does nothing. Screen
 * readers get Move up / Move down instead of the two-tap dance.
 */
function SetGrip({
  movable,
  lifted,
  anyLifted,
  position,
  onPress,
  onStep,
}: {
  movable: boolean;
  lifted: boolean;
  anyLifted: boolean;
  position: number;
  onPress: () => void;
  onStep: (by: -1 | 1) => void;
}) {
  const t = useT();
  const glyph = (
    <Icon
      name="grip"
      size={18}
      color={lifted ? palette.acc : movable ? palette.inkMuted : palette.hairline}
    />
  );
  if (!movable) {
    return (
      <View style={{ width: 30, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        {glyph}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      hitSlop={{ top: 0, bottom: 0, left: 7, right: 7 }}
      accessibilityRole="button"
      accessibilityState={{ selected: lifted }}
      accessibilityLabel={
        lifted
          ? t('Set {n} is lifted. Tap to put it back', { n: position })
          : anyLifted
            ? t('Move the lifted set here, to place {n}', { n: position })
            : t('Move set {n}', { n: position })
      }
      accessibilityActions={[
        { name: 'moveUp', label: t('Move up') },
        { name: 'moveDown', label: t('Move down') },
      ]}
      onAccessibilityAction={(event) => onStep(event.nativeEvent.actionName === 'moveUp' ? -1 : 1)}
      style={{
        width: 30,
        height: 44,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: lifted ? tint(0.14) : anyLifted ? glass.sunken : 'transparent',
        borderWidth: lifted || anyLifted ? 1 : 0,
        borderColor: lifted ? tint(0.45) : palette.hairline,
      }}
    >
      {glyph}
    </Pressable>
  );
}
