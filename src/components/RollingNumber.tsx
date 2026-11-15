/**
 * RollingNumber — a number that changes in place, instantly.
 *
 * The name is historical. It used to be an odometer: each digit a clipped column
 * of 0–9 that slid to its value over 320–900 ms. The calm pass (the owner wants
 * the app fast and calm, decorative motion out) replaced the roll with a plain
 * swap — the new value is on screen the frame it exists, which is also the
 * fastest a number can be read. The export, its props and `RollingPhrase` stay,
 * so no caller changed; `duration` is accepted and ignored.
 *
 * What it still guarantees:
 *
 *  • ALWAYS TABULAR, so the number never shifts sideways by a pixel as a digit
 *    changes — the difference between an app and an instrument.
 *  • `lineHeight` sets the box, as before, so a caller's layout is unchanged.
 *  • NO HALF-DIGITS, by construction. The roll's long tail of bugs — a column
 *    parked between two cells after a fast ± or a size change (`lib/
 *    rollingDigits.ts` still documents and tests them) — cannot happen to text
 *    that has no columns.
 */

import { memo } from 'react';
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

function RollingNumberComponent({
  value,
  lineHeight,
  style,
  className,
  containerStyle,
  accessibilityLabel,
  allowFontScaling = false,
}: {
  value: string;
  lineHeight: number;
  style?: StyleProp<TextStyle>;
  className?: string;
  /** Accepted and ignored since the calm pass — numbers no longer roll. */
  duration?: number;
  containerStyle?: StyleProp<ViewStyle>;
  /** Defaults to the value itself. */
  accessibilityLabel?: string;
  /**
   * Off by default: the box height is `lineHeight` in dp, and an OS font scale on
   * top of it would draw digits taller than the box.
   */
  allowFontScaling?: boolean;
}) {
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? value}
      style={[{ flexDirection: 'row', height: lineHeight, overflow: 'hidden' }, containerStyle]}
    >
      <Text
        style={[style, TABULAR, { lineHeight, height: lineHeight }]}
        className={className}
        allowFontScaling={allowFontScaling}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * Memoized: the session header and the rest pill re-render four times a second,
 * and a number whose value did not change has no reason to re-render.
 */
export const RollingNumber = memo(RollingNumberComponent);

/**
 * A translated sentence with live numbers in it: `3 of 17 sets`, `подходов:
 * 3 из 17`.
 *
 * The sentence is translated WITH its holes still in it — `t()` leaves a
 * placeholder it was not given — and split on them here, so the number sits in
 * whatever position the language puts it. Gluing `<Roll/> + ' of 17 sets'` at the
 * call site would freeze English word order into the layout, which is exactly the
 * mistake `lib/i18n.ts` exists to prevent.
 */
export function RollingPhrase({
  template,
  values,
  lineHeight,
  style,
  className,
  duration,
  containerStyle,
}: {
  /** Already translated, e.g. `t('{done} of {total} sets', { total: 17 })`. */
  template: string;
  /** The live holes, by name. Any other hole was filled by `t()`. */
  values: Record<string, string | number>;
  lineHeight: number;
  style?: StyleProp<TextStyle>;
  className?: string;
  duration?: number;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const parts = template.split(/(\{\w+\})/);
  const spoken = template.replace(/\{(\w+)\}/g, (hole, name: string) =>
    name in values ? String(values[name]) : hole,
  );
  return (
    <View
      accessible
      accessibilityLabel={spoken}
      style={[{ flexDirection: 'row', alignItems: 'center', height: lineHeight }, containerStyle]}
    >
      {parts.map((part, index) => {
        const hole = /^\{(\w+)\}$/.exec(part);
        if (hole && hole[1] in values) {
          return (
            <RollingNumber
              key={`${index}-${hole[1]}`}
              value={String(values[hole[1]])}
              lineHeight={lineHeight}
              style={style}
              className={className}
              duration={duration}
            />
          );
        }
        if (part === '') return null;
        return (
          <Text
            key={index}
            allowFontScaling={false}
            numberOfLines={1}
            style={[style, TABULAR, { lineHeight }]}
            className={className}
          >
            {part}
          </Text>
        );
      })}
    </View>
  );
}
