/**
 * BodyDoor — the way into the bodyweight log: one glass row.
 *
 *   ╭──────────────────────────────────────────╮
 *   │ ↗  Bodyweight              77.2 kg     › │   56 dp, raised glass
 *   ╰──────────────────────────────────────────╯
 *
 * In the places bodyweight already lives — under the Graphs view's lines and
 * in Settings → Bodyweight — rather than a new corner glyph or a tab: a
 * door where you already look at your weight is found without being taught. The
 * detail is the latest reading, so the row answers "what did I weigh" before it
 * is tapped.
 */

import { Text, View } from 'react-native';

import { Icon } from './Icon';
import { BubblePressable } from './bubbles';
import { pressedStyle } from './motion';
import { useLanguage, useT } from '../hooks/useT';
import { formatWeight, unitLabel } from '../lib/units';
import { useSettings } from '../state/settingsStore';
import { glass, palette, radius } from '../theme/tokens';

export function BodyDoor({ onPress }: { onPress: () => void }) {
  const t = useT();
  const lang = useLanguage();
  const unitSystem = useSettings((s) => s.unitSystem);
  const latest = useSettings((s) => s.bodyweightLog[0]);
  const detail = latest
    ? `${formatWeight(latest.kg, unitSystem)} ${unitLabel(unitSystem, lang)}`
    : t('Nothing logged yet');

  return (
    <BubblePressable
      onPress={onPress}
      radius={radius.row}
      accessibilityRole="button"
      accessibilityLabel={`${t('Bodyweight')}. ${detail}`}
      style={(state) => [
        pressedStyle(state),
        {
          minHeight: 56,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          gap: 12,
          borderRadius: radius.row,
          borderWidth: 1,
          borderColor: glass.raisedEdge,
          backgroundColor: glass.raised,
        },
      ]}
    >
      <Icon name="trending-up" size={20} color={palette.acc} />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        className="flex-1 text-body font-medium text-ink"
      >
        {t('Bodyweight')}
      </Text>
      <View style={{ maxWidth: '45%' }}>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 13 }}
          className="tabular-nums text-ink-faint"
        >
          {detail}
        </Text>
      </View>
      <Icon name="chevron-right" size={16} color={palette.inkFaint} />
    </BubblePressable>
  );
}
