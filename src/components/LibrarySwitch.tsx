/**
 * LibrarySwitch — `Routines | Exercises`, under the header of the Routines tab.
 *
 * The workout corner once had two glyphs for these, ≡ and 📖, that looked alike;
 * U23 made them one door, and 4.0 made that door a tab on the bar. This switch
 * is how the tab holds two screens: each half stays the screen it was — the
 * routine list and the exercise tree — and the shell remembers which one is up
 * (`navigation/AppShell.tsx`). Rejected: one long screen with both lists (the
 * tree opens downward and would push the routines a screen away), and a fifth
 * tab for the library (what can I train is one question).
 */

import { View } from 'react-native';

import { Segmented } from './primitives';
import { useT } from '../hooks/useT';
import { LIBRARY_TABS, type LibraryTab } from '../lib/discoverability';

export function LibrarySwitch({
  value,
  onChange,
}: {
  value: LibraryTab;
  onChange: (tab: LibraryTab) => void;
}) {
  const t = useT();
  const labels: Record<LibraryTab, string> = {
    routines: t('Routines'),
    exercises: t('Exercises'),
  };
  return (
    <View className="mt-md">
      <Segmented
        options={LIBRARY_TABS.map((tab) => ({ value: tab, label: labels[tab] }))}
        value={value}
        onChange={(next) => {
          if (next !== value) onChange(next);
        }}
        accessibilityLabel={t('Routines or exercises')}
      />
    </View>
  );
}
