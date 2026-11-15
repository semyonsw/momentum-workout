import { describe, expect, it } from 'vitest';

import { translatedKeys } from './i18n';

/**
 * Group C of the 2.9 redesign (the Workout section, the nav, the top bars,
 * Home's running card): every string it added reaches a Russian
 * phone in Russian, and every word the nav and the corners now print was
 * already translated.
 */
describe('2.9 redesign, group C strings', () => {
  it('has a Russian entry for every new and reused label', () => {
    const keys = [
      'AI coach',
      '{name} · running',
      '{time} · {exercise}, set {set} of {of}',
      '{time} · {exercise}, warm-up',
      'Resume',
      'Resume {name}',
      'Progress',
      'Open the graphs',
      'Create a routine',
      'Set up a training order',
      'Start an empty workout',
      // Reused: the nav labels, the corner captions, the Progress chips.
      'Workout',
      'Tasks',
      'Home',
      'Finance',
      'Settings',
      'History',
      'Routines',
      'Graphs',
      'Muscle map',
      'Body',
    ];
    for (const key of keys) expect(translatedKeys()).toContain(key);
  });
});
