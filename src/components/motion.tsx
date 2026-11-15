/**
 * Motion — the app's shared entrance and press feedback, so five screens don't
 * each invent their own timing.
 *
 *   Reveal        a disclosure opening — fade + rise 4dp, 150ms. For content
 *                 that was not there a moment ago: an expanded library group, a
 *                 workout's detail, a set's history.
 *   pressedStyle  a `Pressable`'s `style` prop — dim plus 0.97 scale on contact.
 *   Pop           a ✓, the Done pill, an edit-mode `−` landing: fade + settle.
 *   Stagger       Reveal with a caller's rise and duration (no delay any more).
 *   Flash         a logged set's faint green wash, gone in 180ms.
 *   Ripple        retired — draws nothing.
 *   SecondPulse   retired — a plain wrapper.
 *   GrowIn        a row arriving by opening its own height, or leaving by
 *                 closing it — `Add set`, `Warm-up`, Undo, and the `−`.
 *   usePressScale a shallow sink under a finger, straight back on release.
 *
 * The curve is `FocusMode.tsx`'s `EASING` — the app already shipped one bezier
 * for "something arriving", and a second one here would be a second thing to
 * keep in sync for no reason anybody could see on screen.
 *
 * Entrances animate once, on mount, and never again: they read `Animated.Value`
 * off a ref rather than state, so a parent re-render (a set logged elsewhere, a
 * clock ticking) cannot replay them. An entrance that replays on every unrelated
 * render is a flicker, not an arrival.
 *
 * Every duration is multiplied by `useMotionScale()`, so with "Remove
 * animations" on each of these renders its END STATE on the first frame. None of
 * them owns a fact: the store is written first and the animation follows it, so
 * a slow frame can never delay a commit.
 *
 * ── AND THEN THE CALM PASS TOOK MOST OF IT BACK ────────────────────────────
 *
 * The owner's call: keep motion, but MINIMAL — the app should feel fast and
 * calm, and anything purely decorative goes. So, keeping every export so no
 * caller had to change:
 *
 *   • every duration is capped at `BRIEF_MS` (180), whatever a caller passes;
 *   • no delays — `Stagger` ignores its `delay`, so a list arrives at once
 *     instead of as a cascade;
 *   • no overshoot — `Pop` is a short fade-and-settle from 0.9, `usePressScale`
 *     sinks a little and comes straight back, and the ✎ tilt is gone;
 *   • rises are 4 dp, not 6–24;
 *   • `Ripple` draws nothing and `SecondPulse` no longer pulses (the timer's
 *     green inversion already says "final ten" in colour);
 *   • `GrowIn` keeps opening and closing its height, because a row arriving or
 *     leaving is information — but quickly, and without the sideways slide.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, View, type StyleProp, type ViewStyle } from 'react-native';

import { useArrived } from '../hooks/useArrived';
import { growInDeadline, leaveLatch } from '../lib/growIn';
import { useMotionScale } from '../hooks/useMotionScale';
import { curve, motion, tint } from '../theme/tokens';

/** Matches `FocusMode.tsx`'s `EASING`. */
const EASING = curve(motion.ease);

/** The longest anything in this file runs. See the header's calm pass. */
const BRIEF_MS = 180;
/** How far anything rises on arrival, whatever a caller asks for. */
const RISE_DP = 4;

/** A caller's duration, held to `BRIEF_MS`. */
function brief(ms: number): number {
  return Math.min(BRIEF_MS, Math.max(0, ms));
}

/** A caller's rise, held to `RISE_DP` in the direction it asked for. */
function nudge(dp: number): number {
  return Math.sign(dp) * Math.min(RISE_DP, Math.abs(dp));
}

function useEnter(duration: number, riseFrom: number) {
  const scale = useMotionScale();
  const arrived = useArrived();
  const enter = useRef(new Animated.Value(scale === 0 ? 1 : 0)).current;
  useEffect(() => {
    if (!arrived) return;
    Animated.timing(enter, {
      toValue: 1,
      duration: brief(duration) * scale,
      easing: EASING,
      useNativeDriver: true,
    }).start();
    // Mount only — see the file header on why an entrance never replays — or,
    // in a section built ahead (`hooks/useArrived.ts`), arrival only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enter, arrived]);

  /* Memoized, like every interpolation below: a fresh `interpolate()` is a fresh
     native node, and the Animated props built on it detach and re-attach on every
     render of a host that re-renders four times a second while a rest runs. */
  return useMemo(
    () => ({
      opacity: enter,
      transform: [
        {
          translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [nudge(riseFrom), 0] }),
        },
      ],
    }),
    [enter, riseFrom],
  );
}

export function Reveal({ children }: { children: ReactNode }) {
  const enterStyle = useEnter(150, -RISE_DP);
  return <Animated.View style={enterStyle}>{children}</Animated.View>;
}

/**
 * Function form, not a plain object, because `Pressable` only exposes `pressed`
 * through its `style` callback.
 */
export function pressedStyle({ pressed }: { pressed: boolean }): ViewStyle | undefined {
  return pressed ? { opacity: 0.7, transform: [{ scale: 0.97 }] } : undefined;
}

/* ------------------------------------------------------------------ */
/* The motion pass                                                     */
/* ------------------------------------------------------------------ */

/**
 * A mark arriving: fade in and settle from 0.9 to full size, on mount. It used
 * to scale from nothing on an overshoot curve; the calm pass keeps the "it just
 * landed" and drops the bounce.
 */
export function Pop({
  children,
  duration = 150,
  style,
}: {
  children: ReactNode;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const scale = useMotionScale();
  const v = useRef(new Animated.Value(scale === 0 ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: brief(duration) * scale,
      easing: EASING,
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  const settle = useMemo(
    () => ({
      opacity: v,
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
    }),
    [v],
  );
  return <Animated.View style={[style, settle]}>{children}</Animated.View>;
}

/**
 * `Reveal` with a caller's rise and duration, both held to the calm-pass caps.
 * It used to delay each row so a list arrived as a cascade; `delay` is still
 * accepted and now ignored — a list arrives at once, which is what reads as fast.
 */
export function Stagger({
  children,
  delay: _delay = 0,
  rise = RISE_DP,
  duration = BRIEF_MS,
  style,
}: {
  children: ReactNode;
  delay?: number;
  rise?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const enterStyle = useEnter(duration, rise);
  return <Animated.View style={[style, enterStyle]}>{children}</Animated.View>;
}

/**
 * A logged set's flash: a faint green wash over the row, 0.18 → 0 in `BRIEF_MS`
 * — the "that registered" a ✓ needs, gone before the next glance. Mounted with a
 * fresh key per ✓ so every log replays it. It takes no touches.
 */
export function Flash({ radius = 0 }: { radius?: number }) {
  const scale = useMotionScale();
  const v = useRef(new Animated.Value(scale === 0 ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: 0,
      duration: BRIEF_MS * scale,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: radius,
        backgroundColor: tint(0.18),
        opacity: v,
      }}
    />
  );
}

/**
 * Focus mode's DONE ripple — retired by the calm pass. A ring leaving the button
 * said nothing the haptic and the set being logged do not already say, so it
 * draws nothing. The export stays so `FocusControls` compiles unchanged.
 */
export function Ripple(_props: { size: number }) {
  return null;
}

/**
 * The final ten seconds used to pulse here, 1 → 1.03 once a second. The calm
 * pass stopped it: the timer's green inversion already says "final ten" without
 * anything moving, and a once-a-second throb is exactly the restlessness the
 * owner asked to lose. It is a plain wrapper now, kept for its callers.
 */
export function SecondPulse({
  children,
  style,
}: {
  active?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={style}>{children}</View>;
}

/**
 * A row that arrives by opening its own height, and leaves by closing it.
 *
 *   in    height 0 → natural, opacity 0 → 1     `BRIEF_MS` at most
 *   out   height → 0,         opacity → 0       `LEAVE_MS`
 *
 * No slide or rise any more (the calm pass): the height opening is the
 * information — "a row is here now" — and everything else on top was garnish.
 *
 * ── WHY TWO NODES ─────────────────────────────────────────────────────────
 *
 * Height is layout, so it can only animate on the JS thread; opacity and the
 * slide can run natively. One `Animated.View` cannot mix the two drivers, so the
 * outer node owns the height and the clip and the inner one owns the rest.
 *
 * The natural height is read off the inner node's own layout — a child of a
 * clipped parent is still laid out at its content height, because nothing here
 * flexes — and once the entrance is over the outer height is released back to
 * `auto`, so a plate line appearing under a weight later does not get cut off by
 * a number measured before it existed.
 *
 * `leaving` is how a caller removes one: set it, and delete the row from the
 * store in `onLeft`. The row is gone from the screen before it is gone from the
 * data, which is the order the design asks for; with reduced motion `onLeft`
 * fires on the next frame.
 */
/** A removed row closes this fast — quick enough to read as "gone", not as a show. */
const LEAVE_MS = 160;

export function GrowIn({
  children,
  appear = true,
  leaving = false,
  onLeft,
  duration = BRIEF_MS,
}: {
  children: ReactNode;
  /** False for a row that was already there — it renders at rest. */
  appear?: boolean;
  leaving?: boolean;
  onLeft?: () => void;
  duration?: number;
}) {
  const scale = useMotionScale();
  /* Latched at mount: a caller that stops calling a row "new" on its next render
     must not strand it half-open. */
  const animateIn = useRef(appear && scale > 0).current;
  const [natural, setNatural] = useState<number | null>(null);
  const [settled, setSettled] = useState(!animateIn);
  const height = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(animateIn ? 0 : 1)).current;
  const onLeftRef = useRef(onLeft);
  onLeftRef.current = onLeft;
  /* `onLeft` once, whether the close animation ends or the row is unmounted
     first (`leaveLatch` has the collapsed-card bug this closes). */
  const [latch] = useState(leaveLatch);
  const run = brief(duration) * scale;

  /* In: once the content has a height to open to. */
  useEffect(() => {
    if (!animateIn || natural == null || settled) return;
    height.setValue(0);
    Animated.timing(height, {
      toValue: natural,
      duration: run,
      easing: EASING,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) setSettled(true);
    });
    Animated.timing(fade, {
      toValue: 1,
      duration: run,
      easing: EASING,
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural]);

  /*
   * The deadline (`lib/growIn.ts`): past it the row is open, whatever became of
   * the layout event or the animation. A row the store holds is never left
   * drawn at zero height.
   */
  const leavingRef = useRef(leaving);
  leavingRef.current = leaving;
  useEffect(() => {
    if (!animateIn) return undefined;
    const timer = setTimeout(
      () => {
        if (leavingRef.current) return;
        fade.stopAnimation();
        fade.setValue(1);
        setSettled(true);
      },
      growInDeadline(brief(duration), scale),
    );
    return () => clearTimeout(timer);
    // Mount only: the deadline is counted from the row's arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Out: close from wherever it stands, then tell the caller. */
  useEffect(() => {
    if (!leaving) return;
    if (scale === 0) {
      const frame = requestAnimationFrame(() => latch.fire(onLeftRef.current));
      return () => cancelAnimationFrame(frame);
    }
    height.setValue(natural ?? 0);
    setSettled(false);
    const out = LEAVE_MS * scale;
    Animated.timing(height, {
      toValue: 0,
      duration: out,
      easing: EASING,
      useNativeDriver: false,
    }).start();
    Animated.timing(fade, {
      toValue: 0,
      duration: out,
      easing: EASING,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) latch.fire(onLeftRef.current);
    });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  /* Unmounted mid-leave (the card collapsed inside `LEAVE_MS`): the animation
     will never report `finished`, so the removal is delivered here instead. */
  useEffect(
    () => () => {
      latch.unmount(leavingRef.current, onLeftRef.current);
    },
    [latch],
  );

  const onLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const h = e.nativeEvent.layout.height;
      if (h > 0 && h !== natural) setNatural(h);
    },
    [natural],
  );

  return (
    <Animated.View
      style={settled && !leaving ? undefined : { height, overflow: 'hidden' }}
      pointerEvents={leaving ? 'none' : 'auto'}
    >
      <Animated.View style={{ opacity: fade }}>
        <View onLayout={onLayout}>{children}</View>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The sink under a finger: down to `to` in `PRESS_IN_MS`, straight back up in
 * `RELEASE_MS`. Returns the handlers to put on the `Pressable` and the style to
 * put on an `Animated.View` inside it.
 *
 * It used to sink as deep as 0.86, overshoot past full size on release over
 * 460 ms and, for the ✎, tilt −12° as if picked up. The calm pass holds the sink
 * to `MIN_SINK` whatever a caller asks, drops the overshoot, and ignores
 * `rotate` — the signature stays so no caller changes.
 */
const PRESS_IN_MS = 80;
const RELEASE_MS = 120;
/** The deepest a press may sink. */
const MIN_SINK = 0.96;

export function usePressScale(to = MIN_SINK, _rotate = 0) {
  const scale = useMotionScale();
  /** 1 = sunk, 0 = rest. */
  const v = useRef(new Animated.Value(0)).current;
  const onPressIn = useCallback(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: PRESS_IN_MS * scale,
      easing: EASING,
      useNativeDriver: true,
    }).start();
  }, [scale, v]);
  const onPressOut = useCallback(() => {
    Animated.timing(v, {
      toValue: 0,
      duration: RELEASE_MS * scale,
      easing: EASING,
      useNativeDriver: true,
    }).start();
  }, [scale, v]);
  const style = useMemo(() => {
    const depth = Math.max(MIN_SINK, Math.min(1, to));
    return {
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, depth] }) }],
    };
  }, [to, v]);
  return { onPressIn, onPressOut, style };
}
