import { describe, expect, it } from 'vitest';

import { translatedKeys } from './i18n';

/**
 * Group A of the 2.9 redesign: the set row and the inline editor. Every string
 * still on screen from it is in Russian.
 */

describe('2.9 redesign A strings', () => {
  it('every string still in use is in Russian', () => {
    const keys = ['Log set', 'Reorder this set'];
    for (const key of keys) expect(translatedKeys()).toContain(key);
  });
});
