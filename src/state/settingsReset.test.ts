import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, useSettings } from './settingsStore';

/**
 * `Reset every setting`: every duration, switch and target goes back; the look,
 * the language, the bodyweight and the backup folder — not settings in the
 * sense the button means — stay exactly as they were.
 */

afterEach(() => {
  useSettings.getState().importSettings(DEFAULT_SETTINGS);
});

describe('the reset', () => {
  it('puts the durations back and keeps the look, the language and the bodyweight', () => {
    const s = useSettings.getState();
    s.setNumber('restSecondsBetweenSets', 60);
    s.setTheme('custom');
    s.setLanguage('en');
    s.setBodyweightKg(80);
    s.setAutoBackupFolder('content://tree/Download');

    useSettings.getState().resetToDefaults();
    const after = useSettings.getState();
    expect(after.restSecondsBetweenSets).toBe(DEFAULT_SETTINGS.restSecondsBetweenSets);
    expect(after.themeId).toBe('custom');
    expect(after.language).toBe('en');
    expect(after.bodyweightKg).toBe(80);
    expect(after.autoBackupFolderUri).toBe('content://tree/Download');
  });
});
