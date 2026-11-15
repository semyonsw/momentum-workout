/**
 * BubblePressable — the app's press feedback: a dim under the finger, nothing
 * that outlives the touch.
 *
 * ── WHAT IT USED TO BE, AND WHY IT IS NOT ANY MORE ────────────────────────
 *
 * Every press used to open a ring from the touch point that faded out over
 * 620 ms. On forty tappable things that is a lot of motion for a log you open
 * between sets, and it made fast taps feel slower than they were: the app was
 * still animating the last press while you were making the next one. The owner
 * asked for an app that feels fast and calm, so the ring went and what is left
 * is the one sentence that matters — "this is under your finger, right now".
 *
 * The dim is a plain style swap on press-in and press-out, not an animation:
 * zero frames is the fastest feedback there is, and it is immune to "Remove
 * animations" by construction. A caller that passes `style` as a function owns
 * its pressed look (usually `pressedStyle` from `motion.tsx`), so the default dim
 * only applies when it does not — never both, which would dim twice.
 *
 * The component keeps its name and its props (`radius`, `bubbleColor`) so the
 * shared vocabulary in `primitives.tsx` and every screen compile unchanged.
 */

import { useState, type ReactNode } from 'react';
import { Pressable, type PressableProps } from 'react-native';

import { press } from '../lib/feedback';

/** The default pressed look, for a caller that does not supply its own. */
const PRESSED = { opacity: 0.7 } as const;

export interface BubblePressableProps extends Omit<PressableProps, 'children'> {
  /**
   * Plain children only.
   *
   * `Pressable` also accepts a render function taking `{ pressed }`. Nothing in this app uses that form — `pressedStyle` is how the pressed state
   * is expressed here — so narrowing it is free and it keeps the type honest.
   */
  children?: ReactNode;
  /**
   * Accepted and ignored: the corner radius the old ring was clipped to. Kept so
   * forty call sites did not have to change when the ring went.
   */
  radius?: number | 'pill';
  /** Accepted and ignored: the old ring's colour. See `radius`. */
  bubbleColor?: string;
  /**
   * Off, for the few places a press dim would be noise — a drag handle, a scrim.
   * The name is the old ring's; the meaning is "give default press feedback".
   */
  bubbles?: boolean;
  /**
   * The tick (`feedback.press`) when the press lands. On for every button by
   * default; off for a control that already speaks for itself. On the PRESS and
   * not on touch-down: a finger that lands on a row and then scrolls the list is
   * not pressing anything, and a buzz for every scroll is the fastest way to get
   * vibration switched off.
   */
  haptic?: boolean;
}

export function BubblePressable({
  radius: _radius,
  bubbleColor: _bubbleColor,
  bubbles = true,
  haptic = true,
  onPress,
  onPressIn,
  onPressOut,
  children,
  style,
  ...rest
}: BubblePressableProps) {
  /**
   * WHETHER A FINGER IS DOWN, TRACKED HERE RATHER THAN BY `Pressable`.
   *
   * `Pressable` accepts `style` as a callback taking `{ pressed }`, but
   * `jsxImportSource: 'nativewind'` wraps every React Native component at the
   * JSX call site and resolves `style` so it can merge `className` into it — a
   * FUNCTION is not something it can merge, so it goes on the floor, and a
   * control whose layout lived in that callback renders as bare children. So the
   * callback is resolved HERE, into a plain object, before NativeWind sees it.
   */
  const [pressed, setPressed] = useState(false);

  const resolved =
    typeof style === 'function'
      ? style({ pressed })
      : pressed && bubbles
        ? [style, PRESSED]
        : style;

  return (
    <Pressable
      {...rest}
      onPress={
        onPress
          ? (event) => {
              if (haptic) press();
              onPress(event);
            }
          : undefined
      }
      onPressIn={(event) => {
        setPressed(true);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        onPressOut?.(event);
      }}
      style={resolved}
    >
      {children}
    </Pressable>
  );
}
