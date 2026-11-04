import { describe, expect, it } from 'vitest';

import { aiCardShown } from './aiEntry';

describe('the assistant card', () => {
  it('shows on a phone that never closed it and never chatted', () => {
    expect(aiCardShown('Workout', undefined, false)).toBe(true);
    expect(aiCardShown('Workout', [], false)).toBe(true);
  });

  it('goes after the ✕', () => {
    expect(aiCardShown('Workout', ['Workout'], false)).toBe(false);
  });

  it('goes after the first chat', () => {
    expect(aiCardShown('Workout', undefined, true)).toBe(false);
  });
});
