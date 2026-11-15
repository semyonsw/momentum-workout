/**
 * RunningText — a one-line label that never resizes the control it is in.
 *
 * If it fits, it is a plain `Text`. If it does not, it ends in an ellipsis and
 * the screen reader still gets the whole string.
 *
 * ── IT USED TO RUN ────────────────────────────────────────────────────────
 *
 * Until the calm pass an overflowing label was a marquee: hold 1.2 s, ease left
 * until the end of the string cleared a right-edge gradient fade, hold, ease
 * back, forever (`lib/marquee.ts` still has the timings, which `AiEntryCard`
 * uses). The argument for it was that an ellipsis hides the part of a name that
 * tells two routines apart. The owner's call went the other way: the app should
 * feel fast and calm, and a label that never stops moving is neither. The box is
 * still the constant — the text gives way, now by truncating.
 *
 * The export, its props and `FADE_ON` stay so the forty-odd call sites compile
 * unchanged; `fadeColor`, `pxPerSecond` and `delayMs` are accepted and ignored.
 *
 * It never takes a touch: `pointerEvents="none"`, so the parent `Pressable`
 * keeps the tap.
 */

import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { mixSrgb } from '../lib/theme';
import { palette } from '../theme/tokens';

/**
 * The colours behind the three surfaces running text sits on. The fade they fed
 * is gone (see the header); kept because callers still name their surface.
 */
export const FADE_ON = {
  /** The gradient's END stop — what is behind a label's right edge on a fill. */
  get gradient(): string {
    return palette.c3;
  },
  card: '#121615',
  bar: '#0E1211',
  page: '#060807',
  /** A `lit` pane: c2 at 13% over the page. */
  get lit(): string {
    return mixSrgb(palette.c2, palette.bg, 0.13);
  },
};

export function RunningText({
  text,
  style,
  className,
  containerStyle,
  allowFontScaling,
  maxFontSizeMultiplier,
  accessibilityLabel,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  className?: string;
  /** Accepted and ignored since the calm pass. See `FADE_ON`. */
  fadeColor: string;
  /** The box — usually `flex: 1` or a fixed width, from the row it sits in. */
  containerStyle?: StyleProp<ViewStyle>;
  /** Accepted and ignored since the calm pass. */
  pxPerSecond?: number;
  /** Accepted and ignored since the calm pass. */
  delayMs?: number;
  allowFontScaling?: boolean;
  maxFontSizeMultiplier?: number;
  /** Defaults to the full string, which is the point: a reader gets all of it. */
  accessibilityLabel?: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? text}
      pointerEvents="none"
      style={[{ overflow: 'hidden', minWidth: 0, flexShrink: 1 }, containerStyle]}
    >
      <Text
        style={style}
        className={className}
        allowFontScaling={allowFontScaling}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {text}
      </Text>
    </View>
  );
}
