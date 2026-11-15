/**
 * HomeScreen — what do I train today.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ WORKOUT                      ( ✦ AI coach )  │  ← glass bar, content under
 *   │ ( SEQUENCE  3/4 · then Push              › ) │  ← only while it is on
 *   │ ╭──────────────────────────────────────────╮ │
 *   │ │ UP NEXT · PULL                           │ │  ← the hero, `lit` glass
 *   │ │ Pull + swimming                          │ │
 *   │ │ 8 exercises · 25 sets                    │ │
 *   │ │ EXERCISES   SETS   WORKOUT   LAST        │ │
 *   │ │ ╭──────────────────────────────────────╮ │ │
 *   │ │ │               ▶ Start                │ │ │  ← THE button
 *   │ │ ╰──────────────────────────────────────╯ │ │
 *   │ ╰──────────────────────────────────────────╯ │
 *   │ OTHER ROUTINES                               │
 *   │ ╭ Push    Push · chest · 2 ex   ( ▶ Start ) ╮│
 *   │ RECENT · PROGRESS · AI                       │
 *   └──────────────────────────────────────────────┘
 *
 * THE USER PICKS THE WORKOUT. Every routine is on this screen and every one of
 * them is one tap from starting, because "the queue says pull but the pull-up
 * bar is taken" is a normal Tuesday. The hero only suggests — the sequence's
 * turn, or the routine after the one trained last (`lib/workoutHome
 * .suggestedRoutine` says why that and not another rule).
 *
 * ── ONE BIG START (4.0) ───────────────────────────────────────────────────
 *
 * The owner's ask was that the button be found without looking for it. So the
 * hero carries ONE wide `▶ Start` at the commit gradient, and every other
 * routine a `▶ Start` pill of its own. Both START the workout — open it and
 * begin the clock (`navigation/sessionRoute.startsAfterOpen`) — because a
 * button that says Start and lands on a second Start lied once. Opening WITHOUT
 * starting is still there for someone who wants to look first: the hero card
 * and each row's body open the routine as before, unstarted, and leaving it
 * leaves no trace.
 *
 * What went: the floating ▶ in the corner (it was a second copy of the hero's
 * button, and two primaries for one action is one too many), and the
 * `Routines` and ⟲ glyphs in the top bar — the routines and the history are
 * tabs now (`lib/sectionNav.ts`). The capsule that follows you once the hero
 * scrolls away stays: it is the hero, carried along, with the same ▶.
 *
 * While a workout is running there is no hero: the in-progress card is the
 * one thing to press, and a `Start` for another routine would only lead back
 * to the running one (a live session is never clobbered).
 *
 * NOTHING TO OPEN offers the three ways forward: `Create a routine`, `Set up a
 * training order`, `Start an empty workout`.
 *
 * ── THE MOTION PASS ───────────────────────────────────────────────────────
 *
 *   • A SKELETON, while the log has not been read (`workoutHistoryStore.ready`):
 *     a hero block, two rows and a well, each with a shimmer sweeping over it.
 *     An empty screen that fills itself in is a screen that looked, for a
 *     moment, like the app had forgotten your training.
 *   • THE HERO'S HALO BREATHES, 26 → 44 dp over six seconds, and it gained a
 *     fourth stat: `LAST · 6 Sep`, when this routine was last done. `#92` rolls
 *     when it changes.
 *   • The routine rows arrive one after another, 70 ms apart.
 *   • A workout in progress gets a ring — the share of its sets done — and its
 *     name runs rather than wrapping.
 *   • SAVING A WORKOUT comes back here, and the hero throws sparks while the new
 *     row grows into Recent.
 *   • THE BUBBLE. Scroll the hero away and it follows you as a capsule at the top:
 *     `#92`, the routine, its size, and a ▶ — or, mid-workout, the share done in a
 *     ring, the clock ticking and the sets counting as they are logged.
 *     `components/FloatingBubble.tsx` is the shell all three sections share.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { AiEntryCard } from '../components/AiEntryCard';
import { Icon } from '../components/Icon';
import { SectionTopBar } from '../components/SectionTopBar';
import { SparkBurst, SPARK_MS } from '../components/SparkBurst';
import { BubblePressable } from '../components/bubbles';
import { FloatingBubble, useHeroRecede } from '../components/FloatingBubble';
import { GlassSurface, Lamps, SpecularEdge, useBarInsets } from '../components/glass';
import { GrowIn, Reveal, Stagger, pressedStyle, usePressScale } from '../components/motion';
import { Kicker, PrimaryButton, TextButton } from '../components/primitives';
import { Sparkline } from '../components/Sparkline';
import { Pressable } from '../components/Pressable';
import { RollingNumber, RollingPhrase } from '../components/RollingNumber';
import { FADE_ON, RunningText } from '../components/RunningText';
import { useBubbleOnScroll } from '../hooks/useBubbleOnScroll';
import { useArrived } from '../hooks/useArrived';
import { useMotionScale } from '../hooks/useMotionScale';
import { useLanguage, useT } from '../hooks/useT';
import { formatElapsed, formatShortDate, formatVolumeKg } from '../lib/units';
import { progressSpark, suggestedRoutine } from '../lib/workoutHome';
import { isResting, useActiveWorkout, useSessionProgress } from '../state/activeWorkoutStore';
import { useWorkoutHistory } from '../state/workoutHistoryStore';
import {
  curve,
  focalType,
  glass,
  gradientFill,
  motion,
  palette,
  radius,
  stopTint,
  tint,
} from '../theme/tokens';
import type { ID, RecentSessionSummary } from '../types/models';

/**
 * The second line of a routine or a Recent row — a step below `ink-muted`,
 * because the muted one competes with the name above it. It was #6B766F, between
 * the old faint and muted; the raised `inkFaint` (U3) is that step now, and
 * legible on a bench where #6B766F (4.3:1) was not quite.
 */
const DETAIL_INK = palette.inkFaint;

/** One routine, described well enough to choose it without opening it. */
export interface RoutineChoice {
  routineId: ID;
  name: string;
  /**
   * "Pull · back, biceps" — which movement family it is, derived from the
   * exercises rather than from the routine's name. Null when nothing is filed.
   */
  focus: string | null;
  exerciseCount: number;
  setCount: number;
  /** When it was last trained, for the hero's `LAST` stat. Null if never. */
  lastTrainedAt: string | null;
  /** Made by the assistant and not opened yet — the row's `AI` pill. */
  isAi?: boolean;
}

export type NextUpPlan = RoutineChoice;

/** The sequence as this screen needs it. Absent whenever it is off or empty. */
export interface SequenceView {
  /** Every step in order, the current one marked. Repeats are normal. */
  steps: { key: string; name: string; isCurrent: boolean }[];
  /** The routine whose turn it is, or null if that step no longer resolves. */
  next: NextUpPlan | null;
}

/** A workout that has been started and not finished, if there is one. */
export interface WorkoutInProgress {
  title: string;
  /** When it started — the in-progress card and the bubble tick from it. */
  startedAt: string;
  done: number;
  total: number;
}

/**
 * What the shell hands down about the running workout: which one, and since when.
 *
 * NOT its set counts. Those move on every ✓, and the shell reading them meant
 * every set logged re-rendered the whole shell — every route, every memo check —
 * in the same frame as the tick's flash and the rest starting. This screen reads
 * them itself (`useSessionProgress`), so a ✓ repaints the card that shows them.
 */
export type RunningWorkout = Pick<WorkoutInProgress, 'title' | 'startedAt'>;

interface HomeScreenProps {
  /**
   * The workout already running, if any. It gets the top of the screen and the
   * floating slot, because while one exists every routine row leads back to IT
   * rather than to the routine that was tapped — a live session is never
   * clobbered, and the user has to be able to see why.
   */
  inProgress: RunningWorkout | null;
  sequence: SequenceView | null;
  /** Every routine, in list order. */
  choices: RoutineChoice[];
  recent: RecentSessionSummary[];
  /**
   * Workout ordinals, keyed by session id — the same numbers History shows, so
   * "workout 92" means one thing everywhere. See `workoutNumbers`.
   */
  numbers: Record<ID, number>;
  /** Open the routine WITHOUT starting it — the card body, a row's body. */
  onOpen: (routineId: ID) => void;
  /** Open the routine and start it — every `▶ Start` on this screen. */
  onStart: (routineId: ID) => void;
  /** Back to the logging screen of the workout in progress. */
  onResume: () => void;
  /** Tapping a step in the opened sequence goes to the screen that edits it. */
  onOpenSequence: () => void;
  onOpenSession: (sessionId: string) => void;
  /**
   * Make an empty routine and open its editor — the empty screen's way forward
   * (U12), the same create the Routines list's `Add routine` does.
   */
  onNewRoutine: () => void;
  /** The Progress card's header: the History tab, on its Graphs view. */
  onOpenGraphs: () => void;
  /** The Progress card's `Muscle map` chip. */
  onOpenMuscles: () => void;
  /** The Progress card's `Body` chip — the bodyweight log. */
  onOpenBody: () => void;
  /**
   * `Start an empty workout`, from the empty state (#18): a session with no
   * routine behind it, filled from the picker. See `lib/workoutHome.ts`.
   */
  onStartEmpty: () => void;
  /** A key has passed its test: the sparkle is lit. See `components/AiEntryCard.tsx`. */
  aiReady: boolean;
  /** The training chat, asking `prompt` if a chip was tapped. */
  onOpenAi: (prompt?: string) => void;
  /**
   * The workout that was just saved, if this screen is what the save came back
   * to: the hero throws its sparks and the new row grows into Recent. Cleared
   * through `onCelebrated` once it has played.
   */
  justSaved?: { id: ID; at: number } | null;
  onCelebrated?: () => void;
}

export function HomeScreen({
  inProgress: running,
  sequence,
  choices,
  recent,
  numbers,
  onOpen,
  onStart,
  onResume,
  onOpenSequence,
  onOpenSession,
  onNewRoutine,
  onOpenGraphs,
  onOpenMuscles,
  onOpenBody,
  onStartEmpty,
  aiReady,
  onOpenAi,
  justSaved = null,
  onCelebrated,
}: HomeScreenProps) {
  const t = useT();
  const progress = useSessionProgress();
  const inProgress = useMemo<WorkoutInProgress | null>(
    () => (running ? { ...running, done: progress.done, total: progress.total } : null),
    [progress.done, progress.total, running],
  );
  const bars = useBarInsets();
  /*
   * THE HERO: the sequence's turn, or the routine after the one trained last.
   * None while a workout runs — the in-progress card is the thing to press.
   */
  const suggested = useMemo(
    () => suggestedRoutine(choices, sequence?.next ?? null),
    [choices, sequence?.next],
  );
  const next = inProgress ? null : suggested;
  /*
   * An empty routine has nothing to start — a ▶ that lands on an editor is a
   * button that lies. Empty ones live in the Routines tab, which is where they
   * get filled in.
   */
  const others = useMemo(
    () =>
      choices.filter((choice) => choice.routineId !== next?.routineId && choice.exerciseCount > 0),
    [choices, next?.routineId],
  );

  /*
   * What the workout about to be logged will be numbered. Derived here rather
   * than passed, because `numbers` is already on this screen for the RECENT
   * rows and the next ordinal is one `max` away from it — a second prop carrying
   * the same fact is a second thing that can disagree with the history screen.
   */
  const ordinals = Object.values(numbers);
  const nextNumber = ordinals.length > 0 ? Math.max(...ordinals) + 1 : 1;

  /* What the capsule carries once the hero has scrolled away. */
  const openable = next;

  /* The log has been read — until then, the skeleton. See the file header. */
  const ready = useWorkoutHistory((s) => s.ready);

  /* The bubble, and the hero stepping back while it is up. */
  /*
   * 300 up, 250 down: the hero is ~260 tall under a strip, so the pill arrives
   * as the card's last row leaves, and the 50 of hysteresis keeps a thumb
   * resting near the line from making it flicker.
   */
  const { visible: bubbleUp, onScroll, scrollRef, scrollToTop } = useBubbleOnScroll(300, 250);
  const heroRecede = useHeroRecede(bubbleUp);

  /*
   * THE CELEBRATION, once, on the mount a save came back to. The id is held for
   * the Recent row that grows in; the sparks run for as long as they take.
   *
   * Read on ARRIVAL, which for a mount at arrival is the mount: a section built
   * ahead (`hooks/useArrived.ts`) would otherwise have read the save from before
   * it happened, or thrown the sparks where nobody could see them. `undefined`
   * is "not read yet".
   */
  const arrived = useArrived();
  const saveNow = () =>
    justSaved != null && Date.now() - justSaved.at < 4000 ? justSaved.id : null;
  const [celebrating, setCelebrating] = useState<ID | null | undefined>(() =>
    arrived ? saveNow() : undefined,
  );
  if (arrived && celebrating === undefined) setCelebrating(saveNow());
  const [sparksDone, setSparksDone] = useState(false);
  const sparks = celebrating != null && !sparksDone;
  useEffect(() => {
    if (celebrating == null) return undefined;
    onCelebrated?.();
    const timer = setTimeout(() => setSparksDone(true), SPARK_MS);
    return () => clearTimeout(timer);
    // Once: `celebrating` is set a single time, and this is about the save that
    // brought the screen here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebrating]);

  /*
   * THE LIST, MEMOIZED ON EVERYTHING BUT THE BUBBLE. The bubble's flag is this
   * screen's own state and it flips mid-fling, twice per trip down the page; as
   * plain JSX, each flip re-rendered every row, marquee and card under the thumb
   * in the frame the bubble's entrance starts. Nothing in here reads it.
   */
  const list = useMemo(
    () =>
      !ready ? (
        <Skeleton />
      ) : (
        <>
          {inProgress ? (
            <Animated.View style={next ? undefined : heroRecede}>
              <InProgressCard progress={inProgress} onPress={onResume} />
            </Animated.View>
          ) : null}

          {sequence ? <SequenceStrip sequence={sequence} onPress={onOpenSequence} /> : null}

          {next ? (
            <Animated.View style={heroRecede}>
              <Hero
                plan={next}
                number={nextNumber}
                onOpen={() => onOpen(next.routineId)}
                onStart={() => onStart(next.routineId)}
              />
            </Animated.View>
          ) : null}

          {others.length > 0 ? (
            <>
              <Kicker className="mx-lg mb-kicker-gap mt-kicker">
                {next ? t('Other routines') : inProgress ? t('Routines') : t('Start a workout')}
              </Kicker>
              <View className="mx-lg" style={{ gap: 8 }}>
                {others.map((choice, index) => (
                  <Stagger key={choice.routineId} delay={120 + index * 70}>
                    <ChoiceRow
                      choice={choice}
                      onPress={() => onOpen(choice.routineId)}
                      /* Mid-workout a row leads back to the running one, so it
                         offers no `Start` of its own. */
                      onStart={inProgress ? null : () => onStart(choice.routineId)}
                    />
                  </Stagger>
                ))}
              </View>
            </>
          ) : null}

          {others.length === 0 && !next ? (
            <Empty
              first={choices.length === 0}
              onNewRoutine={onNewRoutine}
              onOpenSequence={onOpenSequence}
              onStartEmpty={inProgress ? null : onStartEmpty}
            />
          ) : null}

          {recent.length > 0 ? (
            <>
              <Kicker className="mx-lg mb-kicker-gap mt-kicker">{t('Recent')}</Kicker>
              {/* One `well` holding all of them, and the only surface on this
                screen that is a container rather than a card: the past is
                context, and eight lit panes of it would out-shout the hero. */}
              <GlassSurface tier="well" radius={radius.row} flat className="mx-lg">
                {recent.map((session, index) => (
                  /* Keyed on the celebration too: `appear` is latched when a row
                     mounts, and in a section built ahead the saved row can mount
                     before the arrival that decides it is the one to grow. */
                  <GrowIn
                    key={`${session.id}:${session.id === celebrating}`}
                    appear={session.id === celebrating}
                    duration={500}
                  >
                    <RecentRow
                      session={session}
                      number={numbers[session.id]}
                      divided={index > 0}
                      onPress={() => onOpenSession(session.id)}
                    />
                  </GrowIn>
                ))}
              </GlassSurface>
            </>
          ) : null}

          <ProgressCard
            onOpenGraphs={onOpenGraphs}
            onOpenMuscles={onOpenMuscles}
            onOpenBody={onOpenBody}
          />

          <AiEntryCard section="Workout" ready={aiReady} onOpen={onOpenAi} />
        </>
      ),
    [
      aiReady,
      celebrating,
      choices.length,
      heroRecede,
      inProgress,
      next,
      nextNumber,
      numbers,
      onNewRoutine,
      onOpen,
      onOpenAi,
      onOpenBody,
      onOpenGraphs,
      onOpenMuscles,
      onOpenSequence,
      onOpenSession,
      onResume,
      onStart,
      onStartEmpty,
      others,
      ready,
      recent,
      sequence,
      t,
    ],
  );

  return (
    <View className="flex-1 bg-bg">
      <StatusBar style="light" />
      <Lamps section="Workout" />

      {/* The corner is the assistant, in words (4.0) — the routines and the
          history are tabs. See `components/SectionTopBar.tsx`. */}
      <SectionTopBar
        title={t('Workout')}
        actions={[
          {
            key: 'ai',
            icon: 'sparkle',
            label: t('Open the AI coach'),
            caption: t('AI coach'),
            lit: aiReady,
            onPress: () => onOpenAi(),
          },
        ]}
      />

      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        className="flex-1"
        contentContainerStyle={{ paddingTop: bars.top, paddingBottom: bars.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {list}
      </ScrollView>

      {/* The workout just saved, celebrated from the hero's band. */}
      {sparks ? <SparkBurst y={bars.top + 110} /> : null}

      {/* THE BUBBLE — the hero, carried along once it has scrolled away. */}
      {ready && (inProgress || openable) ? (
        <WorkoutBubble
          visible={bubbleUp}
          inProgress={inProgress}
          plan={openable}
          number={nextNumber}
          onTop={scrollToTop}
          onPlay={inProgress ? onResume : () => openable && onStart(openable.routineId)}
        />
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The shape of the screen, before the log has been read: a hero block, a label,
 * two rows, a label and a well, each with a light sweeping over it. Nothing in it
 * is a number that could be mistaken for data.
 */
function Skeleton() {
  const t = useT();
  return (
    <View accessible accessibilityLabel={t('Loading your training log')}>
      <Shimmer height={196} radius={radius.hero} marginTop={10} delay={0} />
      <View
        style={{ marginTop: 22, marginHorizontal: 16, marginBottom: 10, width: 110, height: 10 }}
        className="rounded-[6px] bg-ink/5"
      />
      <Shimmer height={68} radius={radius.row} delay={100} />
      <Shimmer height={68} radius={radius.row} marginTop={8} delay={100} />
      <View
        style={{ marginTop: 22, marginHorizontal: 16, marginBottom: 10, width: 70, height: 10 }}
        className="rounded-[6px] bg-ink/5"
      />
      <Shimmer height={180} radius={radius.row} delay={200} faint />
    </View>
  );
}

/**
 * One skeleton block, and the light across it: a gradient strip translated from
 * off the left edge to off the right over 1.3 s, looped, native-driven. Still,
 * with reduced motion on — the block is the information; the sweep is not.
 */
function Shimmer({
  height,
  radius: corner,
  marginTop = 0,
  delay,
  faint = false,
}: {
  height: number;
  radius: number;
  marginTop?: number;
  delay: number;
  faint?: boolean;
}) {
  const { width } = useWindowDimensions();
  const scale = useMotionScale();
  const sweep = useRef(new Animated.Value(0)).current;
  const arrived = useArrived();
  useEffect(() => {
    if (scale === 0 || !arrived) return undefined;
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1300,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const start = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(start);
      loop.stop();
    };
  }, [arrived, delay, scale, sweep]);

  const strip = 300;
  const sweepX = useMemo(
    () => sweep.interpolate({ inputRange: [0, 1], outputRange: [-strip, width] }),
    [strip, sweep, width],
  );
  return (
    <View
      style={{
        marginTop,
        marginHorizontal: 16,
        height,
        borderRadius: corner,
        overflow: 'hidden',
        backgroundColor: faint ? 'rgba(236,241,238,0.025)' : 'rgba(236,241,238,0.035)',
      }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: strip,
          transform: [
            {
              translateX: sweepX,
            },
          ],
        }}
      >
        <LinearGradient
          colors={[
            'rgba(236,241,238,0)',
            faint ? 'rgba(236,241,238,0.06)' : 'rgba(236,241,238,0.08)',
            'rgba(236,241,238,0)',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

/**
 * The workout already running: where it is up to, and one tap back to it.
 *
 *   ╭──────────────────────────────────────╮
 *   │ IN PROGRESS · 12:04          ╭──╮    │
 *   │ Pull + swimming (tension o░  │42│    │  ← the ring: the share of sets done
 *   │ 3 of 17 sets · resting       ╰──╯    │
 *   ╰──────────────────────────────────────╯
 *
 * The whole card resumes the session — it was a statement with the way back in
 * the floating slot, and a card that says "in progress" and does nothing when
 * pressed is a card people press anyway.
 */
function InProgressCard({
  progress,
  onPress,
}: {
  progress: WorkoutInProgress;
  onPress: () => void;
}) {
  const t = useT();
  const press = usePressScale(0.98);
  const resting = useActiveWorkout((s) => isResting(s.rest));
  const fraction = progress.total > 0 ? progress.done / progress.total : 0;

  return (
    <Animated.View
      style={{ marginHorizontal: 16, marginTop: 10, transform: press.style.transform }}
    >
      <GlassSurface tier="lit" radius={radius.hero} shadow="e2" flat>
        <Pressable
          onPress={onPress}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          accessibilityRole="button"
          accessibilityLabel={`${t('In progress')}: ${progress.title}. ${t(
            '{done} of {total} sets',
            {
              done: progress.done,
              total: progress.total,
            },
          )}. ${t('Back to the workout')}`}
          className="flex-row items-center px-[20px] py-[18px]"
        >
          <View className="mr-[14px] flex-1" style={{ minWidth: 0 }}>
            <View className="flex-row items-center">
              <Kicker tone="green">{`${t('In progress')} · `}</Kicker>
              <TickingClock startedAt={progress.startedAt} className="text-green-bright" />
            </View>
            <RunningText
              text={progress.title}
              fadeColor={FADE_ON.lit}
              containerStyle={{ marginTop: 8 }}
              className="text-title font-medium text-ink"
            />
            <View className="mt-xs flex-row items-center">
              <RollingPhrase
                template={t('{done} of {total} sets', { total: progress.total })}
                values={{ done: progress.done }}
                lineHeight={18}
                className="text-label text-ink-muted"
              />
              {resting ? (
                <Text className="text-label text-ink-muted">{` · ${t('resting')}`}</Text>
              ) : null}
            </View>
          </View>
          <ProgressDial fraction={fraction} size={52} stroke={4}>
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 12.5 }}
              className="font-semibold tabular-nums text-green-bright"
            >
              {`${Math.round(fraction * 100)}%`}
            </Text>
          </ProgressDial>
        </Pressable>
      </GlassSurface>
    </Animated.View>
  );
}

/** A clock counting up from `startedAt`, ticking once a second and only itself. */
function TickingClock({ startedAt, className }: { startedAt: string; className?: string }) {
  const startMs = useMemo(() => new Date(startedAt).getTime(), [startedAt]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  return (
    <Text
      maxFontSizeMultiplier={1.3}
      className={['text-micro font-semibold uppercase tabular-nums', className ?? ''].join(' ')}
    >
      {formatElapsed(Number.isFinite(startMs) ? now - startMs : 0)}
    </Text>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * A progress ring whose arc TRAVELS to its share (`motion.ring`), for the
 * in-progress card and the bubble's badge. JS-driven: `strokeDashoffset` is an
 * SVG prop, not a transform.
 */
function ProgressDial({
  fraction,
  size,
  stroke,
  track = palette.greenDim,
  children,
}: {
  fraction: number;
  size: number;
  stroke: number;
  /** Null for no track at all — the bubble's badge draws only the arc. */
  track?: string | null;
  children?: ReactNode;
}) {
  const scale = useMotionScale();
  const clamped = Math.max(0, Math.min(1, fraction));
  const r = (size - stroke) / 2;
  const length = 2 * Math.PI * r;
  const v = useRef(new Animated.Value(clamped)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: clamped,
      duration: motion.ring * scale,
      easing: curve(motion.ease),
      useNativeDriver: false,
    }).start();
  }, [clamped, scale, v]);
  const ringOffset = useMemo(
    () => v.interpolate({ inputRange: [0, 1], outputRange: [length, 0] }),
    [length, v],
  );
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg
        width={size}
        height={size}
        style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}
      >
        {track ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={track}
            strokeWidth={stroke}
          />
        ) : null}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={palette.greenBright}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={ringOffset}
        />
      </Svg>
      {children}
    </View>
  );
}

/**
 * THE WORKOUT BUBBLE — the hero at a tenth of its size.
 *
 *   ╭──────────────────────────────────────────╮
 *   │ ( #92 )  UP NEXT · WORKOUT          ( ▶ ) │
 *   │          Pull + swimming (tensi░          │
 *   │          5 exercises · 17 sets            │
 *   ╰──────────────────────────────────────────╯
 *
 * Mid-workout the same capsule changes on the fly: the badge becomes the share
 * done with a ring filling around it, the kicker ticks the elapsed clock, the
 * line counts sets as they are logged, and ▶ goes back to the session. The badge
 * and the text scroll back up to the hero they stand in for.
 */
function WorkoutBubble({
  visible,
  inProgress,
  plan,
  number,
  onTop,
  onPlay,
}: {
  visible: boolean;
  inProgress: WorkoutInProgress | null;
  plan: RoutineChoice | null;
  number: number;
  onTop: () => void;
  onPlay: () => void;
}) {
  const t = useT();
  const fraction = inProgress && inProgress.total > 0 ? inProgress.done / inProgress.total : 0;
  const name = inProgress ? inProgress.title : (plan?.name ?? '');
  const spoken = inProgress
    ? `${t('In progress')}: ${name}, ${t('{done} of {total} sets', {
        done: inProgress.done,
        total: inProgress.total,
      })}. ${t('Back to the workout')}.`
    : `${t('Workout {number}', { number })}, ${name}, ${t('{exercises} exercises · {sets} sets', {
        exercises: plan?.exerciseCount ?? 0,
        sets: plan?.setCount ?? 0,
      })}. ${t('Start')}.`;

  return (
    <FloatingBubble
      visible={visible}
      width={338}
      contentStyle={{ gap: 10 }}
      accessibilityLabel={spoken}
    >
      <Pressable
        onPress={onTop}
        accessibilityRole="button"
        accessibilityLabel={t('Back to the top')}
        style={{
          width: 50,
          height: 50,
          borderRadius: 9999,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tint(0.2),
          borderWidth: 1,
          borderColor: tint(0.38),
        }}
      >
        {inProgress ? (
          <View style={{ position: 'absolute', top: -1, left: -1 }}>
            <ProgressDial fraction={fraction} size={50} stroke={2.5} track={null} />
          </View>
        ) : null}
        <RollingNumber
          value={inProgress ? `${Math.round(fraction * 100)}%` : `#${number}`}
          lineHeight={18}
          duration={inProgress ? 600 : 800}
          style={{ fontSize: 14 }}
          className="font-bold text-green-bright"
        />
      </Pressable>

      <Pressable
        onPress={onTop}
        accessibilityRole="button"
        accessibilityLabel={t('Back to the top')}
        style={{ width: 158 }}
      >
        <View className="flex-row items-center">
          <Text
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
            style={{ fontSize: 12.5, letterSpacing: 1.1 }}
            className="font-semibold uppercase text-acc"
          >
            {inProgress ? `${t('In progress')} · ` : `${t('Up next')} · ${t('Workout')}`}
          </Text>
          {inProgress ? <TickingClockSmall startedAt={inProgress.startedAt} /> : null}
        </View>
        <RunningText
          text={name}
          fadeColor="#171C1A"
          containerStyle={{ marginTop: 2 }}
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 16, lineHeight: 20 }}
          className="font-semibold text-ink"
        />
        {inProgress ? (
          <RollingPhrase
            template={t('{done} of {total} sets', { total: inProgress.total })}
            values={{ done: inProgress.done }}
            lineHeight={16}
            duration={500}
            containerStyle={{ marginTop: 1 }}
            style={{ fontSize: 12.5 }}
            className="text-ink-muted"
          />
        ) : (
          <RollingPhrase
            template={t('{exercises} exercises · {sets} sets')}
            values={{ exercises: plan?.exerciseCount ?? 0, sets: plan?.setCount ?? 0 }}
            lineHeight={16}
            duration={500}
            containerStyle={{ marginTop: 1 }}
            style={{ fontSize: 12.5 }}
            className="text-ink-muted"
          />
        )}
      </Pressable>

      <PlayButton
        onPress={onPlay}
        label={inProgress ? t('Back to the workout') : t('Start {name}', { name })}
      />
    </FloatingBubble>
  );
}

/** The bubble's kicker clock: 10.5 px, in the accent, ticking. */
function TickingClockSmall({ startedAt }: { startedAt: string }) {
  const startMs = useMemo(() => new Date(startedAt).getTime(), [startedAt]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  return (
    <Text
      maxFontSizeMultiplier={1.3}
      style={{ fontSize: 12.5, letterSpacing: 1.1 }}
      className="font-semibold tabular-nums text-acc"
    >
      {formatElapsed(Number.isFinite(startMs) ? now - startMs : 0)}
    </Text>
  );
}

/**
 * The bubble's ▶: 50 dp of the commit gradient. Sinks to 0.9. The glyph is
 * `onAcc` — ink on a light theme's gradient is the one pairing that vanishes.
 */
function PlayButton({ onPress, label }: { onPress: () => void; label: string }) {
  const press = usePressScale(0.9);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Animated.View
        style={{
          width: 50,
          height: 50,
          borderRadius: 9999,
          transform: press.style.transform,
        }}
      >
        <View
          style={{
            flex: 1,
            borderRadius: 9999,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <LinearGradient
            {...gradientFill()}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
          <SpecularEdge color="rgba(255,255,255,0.3)" radius={9999} />
          <SolidPlay size={18} color={palette.onAcc} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

/**
 * The repo's ▶, FILLED, as the floating action draws it. `Icon` strokes only,
 * and an outlined triangle at 15–18 dp reads as a hollow glyph on a pill that
 * is otherwise solid. Nudged 2 dp right onto the circle's optical centre.
 */
function SolidPlay({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ marginLeft: 2 }}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          d="M8 5.5l11 6.5-11 6.5z"
          fill={color}
          stroke={color}
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

/**
 * The routine whose turn it is, as the one hero on the screen.
 *
 * `lit` glass over the section's brightest lamp, which is what the depth stack
 * is for: the card does not carry its own highlight, it is a translucent pane
 * with the light already behind it. The name is the only thing on this screen at
 * `hero-name` — one hero per screen is the rule the focal steps exist to keep.
 *
 * The three stats are a fact each, in a row, and none of them is new data: the
 * exercise and set counts came with the plan, and the ordinal is one `max` off
 * the numbers the RECENT rows below are already drawn from. The third is green
 * because it is the only one of the three about the workout you are ABOUT to do
 * rather than about the routine as written.
 *
 * Its foot is THE button on the screen (4.0): a full-width `▶ Start`, 56 dp, at
 * the commit gradient — it opens the routine and starts it. The card around it
 * still opens the routine WITHOUT starting, for a look first; the button is
 * its own pressable inside the card's, so a tap on it is one start, not an
 * open and a start.
 */
function Hero({
  plan,
  number,
  onOpen,
  onStart,
}: {
  plan: NextUpPlan;
  number: number;
  onOpen: () => void;
  onStart: () => void;
}) {
  const t = useT();
  const lang = useLanguage();
  const press = usePressScale(0.98);
  const openLabel = t('Open {name}', { name: plan.name });
  const kicker = plan.focus ? `${t('Up next')} · ${plan.focus}` : t('Up next');
  return (
    <Animated.View
      style={{ marginHorizontal: 16, marginTop: 16, transform: press.style.transform }}
    >
      <Pressable
        onPress={onOpen}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={`${kicker}. ${openLabel}`}
      >
        <GlassSurface tier="lit" radius={radius.hero} shadow="e2">
          {/* The corner lamp: the theme's THIRD colour, so the hero carries the
            far end of the gradient the floating ▶ under the thumb starts from. */}
          <View
            pointerEvents="none"
            style={{ position: 'absolute', top: -80, right: -60, width: 220, height: 220 }}
          >
            <Svg width={220} height={220}>
              <Defs>
                <RadialGradient id="heroLamp" cx="50%" cy="50%" r="50%">
                  <Stop offset="0%" stopColor={stopTint(3, 1)} stopOpacity={0.26} />
                  <Stop offset="65%" stopColor={stopTint(3, 1)} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={110} cy={110} r={110} fill="url(#heroLamp)" />
            </Svg>
          </View>
          <View className="p-[20px]">
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <RunningText
                text={kicker}
                fadeColor={FADE_ON.lit}
                containerStyle={{ flex: 1 }}
                maxFontSizeMultiplier={1.3}
                style={{ letterSpacing: 1.1 }}
                className="text-micro font-semibold uppercase text-acc"
              />
            </View>

            <Text
              numberOfLines={2}
              maxFontSizeMultiplier={1.3}
              style={focalType.heroName}
              className="mt-sm font-semibold text-ink"
            >
              {plan.name}
            </Text>

            <Text className="mt-xs text-label text-ink-muted">
              {t('{exercises} exercises · {sets} sets', {
                exercises: plan.exerciseCount,
                sets: plan.setCount,
              })}
            </Text>

            {/* The divider fades out rather than crossing the card: a full-width
              rule inside a pane reads as a seam between two panes. */}
            <View
              className="mt-lg h-hairline"
              style={{ backgroundColor: 'rgba(236,241,238,0.12)', width: '62%' }}
            />

            <View className="mt-lg flex-row flex-wrap" style={{ rowGap: 10 }}>
              <HeroStat label={t('Exercises')} value={String(plan.exerciseCount)} />
              <HeroStat label={t('Sets')} value={String(plan.setCount)} />
              <HeroStat label={t('Workout')} value={`#${number}`} tone="green" rolls />
              {plan.lastTrainedAt ? (
                <HeroStat
                  label={t('Last')}
                  value={formatShortDate(plan.lastTrainedAt, lang)}
                  tone="muted"
                />
              ) : null}
            </View>

            <View className="mt-lg">
              <StartButton
                label={t('Start')}
                spoken={t('Start {name}', { name: plan.name })}
                onPress={onStart}
              />
            </View>
          </View>
        </GlassSurface>
      </Pressable>
    </Animated.View>
  );
}

/**
 * `▶ Start` — the hero's primary and the screen's: the commit gradient, a filled
 * ▶ and one word, 56 dp and the card's full width. The routine's name is the
 * headline right above it, so the button does not repeat it; the screen reader
 * hears it in `spoken`.
 */
function StartButton({
  label,
  spoken,
  onPress,
}: {
  label: string;
  spoken: string;
  onPress: () => void;
}) {
  return (
    <BubblePressable
      onPress={onPress}
      radius="pill"
      bubbleColor={palette.onAcc}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      style={(state) => [
        pressedStyle(state),
        {
          height: 56,
          borderRadius: radius.pill,
          overflow: 'hidden',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 18,
          gap: 8,
        },
      ]}
    >
      <LinearGradient
        {...gradientFill()}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <SolidPlay size={18} color={palette.onAcc} />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={{ color: palette.onAcc, fontSize: 18 }}
        className="font-semibold"
      >
        {label}
      </Text>
    </BubblePressable>
  );
}

function HeroStat({
  label,
  value,
  tone = 'plain',
  rolls = false,
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'green' | 'muted';
  /** The workout number rolls when it changes — a workout was just saved. */
  rolls?: boolean;
}) {
  const color = tone === 'green' ? 'text-acc' : tone === 'muted' ? 'text-ink-muted' : 'text-ink';
  return (
    <View className="mr-[22px]">
      <Text
        maxFontSizeMultiplier={1.3}
        style={{ fontSize: 12.5, letterSpacing: 1.1 }}
        className="font-semibold uppercase text-ink-faint"
      >
        {label}
      </Text>
      {rolls ? (
        <RollingNumber
          value={value}
          lineHeight={24}
          duration={900}
          containerStyle={{ marginTop: 2 }}
          style={{ fontSize: 22 }}
          className={['font-semibold', color].join(' ')}
        />
      ) : (
        <Text
          allowFontScaling={false}
          style={{ fontSize: 22, lineHeight: 24 }}
          className={['mt-[2px] font-semibold tabular-nums', color].join(' ')}
        >
          {value}
        </Text>
      )}
    </View>
  );
}

/**
 * The sequence, FOLDED by default to one line: `SEQUENCE · 11/12 · then Push ⌄`.
 *
 * It used to be the full wrapping line of chips, always — and a real sequence is
 * not four steps, it is twelve, with long names. That was twelve rows of chips
 * between the top bar and the hero, pushing the one card this screen exists for
 * below the fold. The folded line keeps what is worth a glance on every visit —
 * where in the order you are, and what comes AFTER today (today itself is the
 * hero right under it, so naming it here too would be saying it twice). The
 * chevron opens the full order; it closes again the same way.
 *
 * Open state is local and starts closed each time the screen mounts. The whole
 * order is a thing you look at occasionally, not every time, and a preference
 * persisted for one disclosure is more machinery than the question deserves.
 *
 * Open, it is the same wrapping line of chips as before, step whose turn it is on
 * a lit pane. WRAPPING and not a horizontal `ScrollView`, which it once was: a
 * sideways-scrolling row hides the steps past the edge, and wrapped chips are
 * all visible without a gesture. Tapping a chip opens the screen that edits the order — a chip
 * is a label, not a start button, and the thing you want after looking at your
 * order is usually to change it.
 */
function SequenceStrip({ sequence, onPress }: { sequence: SequenceView; onPress: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { steps } = sequence;
  const currentIndex = steps.findIndex((step) => step.isCurrent);
  // The cursor wraps (`advanceSequence`), so after the last step comes the first.
  const after =
    currentIndex >= 0 && steps.length > 1 ? steps[(currentIndex + 1) % steps.length] : null;
  const summary = [
    currentIndex >= 0 ? `${currentIndex + 1}/${steps.length}` : null,
    after ? t('then {name}', { name: after.name }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View className="mt-lg">
      <BubblePressable
        onPress={() => setOpen((was) => !was)}
        radius="pill"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${t('Sequence')}. ${summary}. ${open ? t('Hide the sequence') : t('Show the sequence')}`}
        style={(state) => [
          pressedStyle(state),
          {
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 44,
            marginHorizontal: 16,
            paddingHorizontal: 14,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: 'rgba(236,241,238,0.045)',
            backgroundColor: 'rgba(236,241,238,0.028)',
          },
        ]}
      >
        <Kicker>{t('Sequence')}</Kicker>
        <RunningText
          text={summary}
          fadeColor={FADE_ON.page}
          containerStyle={{ flex: 1, marginLeft: 12 }}
          maxFontSizeMultiplier={1.3}
          className="text-label tabular-nums text-ink-faint"
        />
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} color={palette.inkFaint} />
      </BubblePressable>

      {open ? (
        <Reveal>
          <View className="mx-lg mt-md flex-row flex-wrap items-center" style={{ rowGap: 8 }}>
            {steps.map((step, index) => (
              <SequenceChip key={step.key} step={step} divided={index > 0} onPress={onPress} />
            ))}
          </View>
        </Reveal>
      ) : null}
    </View>
  );
}

function SequenceChip({
  step,
  divided,
  onPress,
}: {
  step: SequenceView['steps'][number];
  /** A `›` before it — every chip but the first. */
  divided: boolean;
  onPress: () => void;
}) {
  const t = useT();
  return (
    <BubblePressable
      onPress={onPress}
      radius="pill"
      accessibilityRole="button"
      accessibilityLabel={`${step.name}${step.isCurrent ? `, ${t('next up')}` : ''}. ${t('Edit the sequence.')}`}
      style={(state) => [pressedStyle(state), { flexDirection: 'row', alignItems: 'center' }]}
    >
      {divided ? (
        <Text className="mx-[3px] text-label text-ink-faint" maxFontSizeMultiplier={1.3}>
          ›
        </Text>
      ) : null}
      <View
        style={{
          height: 34,
          justifyContent: 'center',
          paddingHorizontal: 14,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: step.isCurrent ? tint(0.3) : 'rgba(236,241,238,0.045)',
          backgroundColor: step.isCurrent ? tint(0.13) : 'rgba(236,241,238,0.028)',
        }}
      >
        <Text
          numberOfLines={1}
          className={[
            'text-label',
            step.isCurrent ? 'font-semibold text-acc' : 'text-ink-muted',
          ].join(' ')}
        >
          {step.name}
        </Text>
      </View>
    </BubblePressable>
  );
}

/**
 * One startable routine, as its own `card` pane with 8 of air under it.
 *
 * The row's body opens it unstarted (a look first); the `▶ Start` pill at its
 * end starts it (4.0) — it was a bare ▶ in a circle, and the whole row did one
 * thing, so "does this start it or show it" was a guess. The pill is its own
 * 44 dp target inside the row's. `onStart` null (a workout is running) leaves
 * the row a plain way back to it.
 */
function ChoiceRow({
  choice,
  onPress,
  onStart,
}: {
  choice: RoutineChoice;
  onPress: () => void;
  onStart: (() => void) | null;
}) {
  const t = useT();
  const press = usePressScale(0.97);
  const detail = [
    choice.focus,
    t('{exercises} exercises · {sets} sets', {
      exercises: choice.exerciseCount,
      sets: choice.setCount,
    }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Animated.View style={{ transform: press.style.transform }}>
      <GlassSurface tier="card" radius={radius.row} shadow="e1" flat>
        <BubblePressable
          onPress={onPress}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          radius={radius.row}
          accessibilityRole="button"
          accessibilityLabel={`${t('Open {name}', { name: choice.name })}. ${detail}`}
          style={(state) => [
            pressedStyle(state),
            {
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 14,
              paddingHorizontal: 16,
            },
          ]}
        >
          {/* Both lines RUN rather than ellipsise — two routines whose names
              differ only at the end are two routines. */}
          <View className="flex-1 pr-md" style={{ minWidth: 0 }}>
            <View className="flex-row items-center">
              <RunningText
                text={choice.name}
                fadeColor={FADE_ON.card}
                containerStyle={{ flexShrink: 1 }}
                className="text-body font-medium text-ink"
              />
              {choice.isAi ? <AiPill /> : null}
            </View>
            <RunningText
              text={detail}
              fadeColor={FADE_ON.card}
              containerStyle={{ marginTop: 2 }}
              style={{ fontSize: 14, lineHeight: 19, color: DETAIL_INK }}
              className="tabular-nums"
            />
          </View>
          {onStart ? (
            <BubblePressable
              onPress={onStart}
              radius="pill"
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t('Start {name}', { name: choice.name })}
              style={(state) => [
                pressedStyle(state),
                {
                  height: 42,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingLeft: 12,
                  paddingRight: 14,
                  borderRadius: radius.pill,
                  overflow: 'hidden',
                  borderWidth: 1,
                  borderColor: tint(0.26),
                  backgroundColor: tint(0.14),
                },
              ]}
            >
              <SpecularEdge color="rgba(236,241,238,0.12)" radius={radius.pill} />
              <Icon name="play" size={14} color={palette.acc} />
              <Text maxFontSizeMultiplier={1.3} className="text-label font-semibold text-acc">
                {t('Start')}
              </Text>
            </BubblePressable>
          ) : (
            <Icon name="chevron-right" size={18} color={palette.inkFaint} />
          )}
        </BubblePressable>
      </GlassSurface>
    </Animated.View>
  );
}

/**
 * `AI`, beside a routine the assistant made, until it is first opened — a
 * statement of where the row came from. In the assistant's OWN fixed violet →
 * pink rather than the theme: it says who made the row, and the one colour pair
 * no theme can wear is the one that always means the assistant.
 */
function AiPill() {
  return (
    <View
      style={{
        marginLeft: 8,
        height: 20,
        paddingHorizontal: 7,
        justifyContent: 'center',
        borderRadius: radius.pill,
        overflow: 'hidden',
      }}
    >
      <LinearGradient
        colors={['#8B5CF6', '#EC4899']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <Text
        maxFontSizeMultiplier={1.3}
        style={{ fontSize: 12.5, letterSpacing: 0.9, color: '#FFFFFF' }}
        className="font-bold uppercase"
      >
        AI
      </Text>
    </View>
  );
}

function RecentRow({
  session,
  number,
  divided,
  onPress,
}: {
  session: RecentSessionSummary;
  /** Its ordinal, when the numbering gives it one. */
  number?: number;
  /** A hairline above it — every row but the first. */
  divided: boolean;
  onPress: () => void;
}) {
  const t = useT();
  const lang = useLanguage();
  const numbered = number != null && number >= 1;
  /*
   * Two lines rather than one, and the ordinal moved INLINE with the title.
   *
   * The single line ran out of room once the set count and the volume joined it
   * — and those two are the reason to look at a past session at all, since the
   * date and the duration only say that it happened. The `#91` keeps its green
   * and its tabular weight, but it is now a prefix on the title rather than a
   * column, because there is no second column left to align it against. The
   * title RUNS beside it.
   */
  const detail = [
    formatShortDate(session.performedAt, lang),
    t('{minutes} min', { minutes: session.durationMinutes }),
    t('{count} sets', { count: session.setCount }),
    // A volume built from sets that carried no weight is a floor, not a total,
    // so it is left off rather than stated wrongly.
    session.totalVolumeKg > 0 && !session.volumeIsPartial
      ? formatVolumeKg(session.totalVolumeKg, lang)
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View>
      {divided ? <View className="ml-lg h-hairline bg-hairline" /> : null}
      <BubblePressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[
          numbered ? `${t('Workout {number}', { number })},` : '',
          session.title,
          detail,
        ]
          .filter(Boolean)
          .join(' ')}
        style={(state) => [pressedStyle(state), { paddingVertical: 13, paddingHorizontal: 16 }]}
      >
        <View className="flex-row items-center">
          {numbered ? (
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 13.5 }}
              className="mr-sm font-semibold tabular-nums text-acc"
            >
              {`#${number}`}
            </Text>
          ) : null}
          <RunningText
            text={session.title}
            fadeColor="#0B0E0D"
            containerStyle={{ flex: 1 }}
            className="text-task text-ink"
          />
        </View>
        <RunningText
          text={detail}
          fadeColor="#0B0E0D"
          containerStyle={{ marginTop: 2 }}
          style={{ fontSize: 14, lineHeight: 19, color: DETAIL_INK }}
          className="tabular-nums"
        />
      </BubblePressable>
    </View>
  );
}

/**
 * Nothing to open: there are no routines, or every one of them is empty.
 *
 * It used to be one card for both, pointing at "the list glyph in the corner" —
 * directions to a button instead of the button (U12). Each case keeps its own
 * words, and both now offer the same three ways forward (#18), strongest first:
 *   • `Create a routine` — the primary: creates one and opens its editor;
 *   • `Set up a training order` — the sequence screen, for someone who already
 *     knows they train push → pull → legs;
 *   • `Start an empty workout` — the ghost: a session with nothing planned,
 *     exercises added as you go. Absent while a workout is already running, since
 *     that one would have to be thrown away first.
 * The routines that are all empty are one tap away on the Routines tab.
 */
function Empty({
  first,
  onNewRoutine,
  onOpenSequence,
  onStartEmpty,
}: {
  first: boolean;
  onNewRoutine: () => void;
  onOpenSequence: () => void;
  onStartEmpty: (() => void) | null;
}) {
  const t = useT();
  return (
    <GlassSurface tier="card" radius={radius.card} shadow="e1" flat className="mx-lg mt-kicker">
      <View className="p-lg">
        <Kicker>{first ? t('No routines yet') : t('Nothing to open')}</Kicker>
        {first ? (
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 22, lineHeight: 28, letterSpacing: -0.4 }}
            className="mt-sm font-semibold text-ink"
          >
            {t('Make your first routine')}
          </Text>
        ) : null}
        <Text className="mt-sm text-body text-ink-muted">
          {first
            ? t('It appears here, one tap from starting.')
            : t('Put some exercises in one of your routines and it shows up here, ready to open.')}
        </Text>
        <View className="mt-lg" style={{ gap: 8 }}>
          <PrimaryButton label={t('Create a routine')} onPress={onNewRoutine} />
          <PrimaryButton
            label={t('Set up a training order')}
            variant="ghost"
            onPress={onOpenSequence}
          />
          {onStartEmpty ? (
            <TextButton label={t('Start an empty workout')} onPress={onStartEmpty} />
          ) : null}
        </View>
      </View>
    </GlassSurface>
  );
}

/**
 * PROGRESS, one tap from the section (#11).
 *
 *   ╭──────────────────────────────────────────╮
 *   │ PROGRESS                       Graphs ›  │  ← the whole header opens Graphs
 *   │ ╱╲__╱‾‾╲_╱‾                              │  ← volume, last ten workouts
 *   │ ( Muscle map )  ( Body )                 │
 *   ╰──────────────────────────────────────────╯
 *
 * All three used to sit behind ⟲ → Graphs → a row. The header row is one target
 * with the sparkline inside it, so "how is it going" is a glance and "show me" is
 * one tap; the line is a shape, not a reading — `lib/workoutHome.progressSpark`
 * says what it leaves out. The two chips are secondary: places, not the answer.
 */
function ProgressCard({
  onOpenGraphs,
  onOpenMuscles,
  onOpenBody,
}: {
  onOpenGraphs: () => void;
  onOpenMuscles: () => void;
  onOpenBody: () => void;
}) {
  const t = useT();
  const workouts = useWorkoutHistory((s) => s.workouts);
  const spark = useMemo(() => progressSpark(workouts), [workouts]);
  return (
    <View
      className="mx-lg mt-md"
      style={{
        borderRadius: radius.row,
        borderWidth: 1,
        borderColor: glass.raisedEdge,
        backgroundColor: glass.raised,
        overflow: 'hidden',
      }}
    >
      <BubblePressable
        onPress={onOpenGraphs}
        radius={radius.row}
        accessibilityRole="button"
        accessibilityLabel={`${t('Progress')}. ${t('Open the graphs')}`}
        style={(state) => [pressedStyle(state), { paddingHorizontal: 14, paddingTop: 12 }]}
      >
        <View className="flex-row items-center" style={{ minHeight: 32 }}>
          <View className="flex-1">
            <Kicker>{t('Progress')}</Kicker>
          </View>
          <Text maxFontSizeMultiplier={1.3} className="text-label font-semibold text-acc">
            {t('Graphs')}
          </Text>
          <Icon name="chevron-right" size={16} color={palette.acc} />
        </View>
        {spark ? (
          <View style={{ marginTop: 6 }}>
            <Sparkline values={spark.values} min={spark.min} max={spark.max} height={40} />
          </View>
        ) : null}
      </BubblePressable>
      <View
        className="flex-row flex-wrap"
        style={{ gap: 8, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 }}
      >
        <CardChip label={t('Muscle map')} onPress={onOpenMuscles} />
        <CardChip label={t('Body')} onPress={onOpenBody} />
      </View>
    </View>
  );
}

/** A secondary chip on a card: 44 dp, glass, a place to go. */
function CardChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <BubblePressable
      onPress={onPress}
      radius="pill"
      accessibilityRole="button"
      accessibilityLabel={label}
      style={(state) => [
        pressedStyle(state),
        {
          height: 44,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: glass.raisedEdge,
          backgroundColor: glass.sunken,
        },
      ]}
    >
      <Text maxFontSizeMultiplier={1.3} className="text-label font-semibold text-ink">
        {label}
      </Text>
    </BubblePressable>
  );
}
