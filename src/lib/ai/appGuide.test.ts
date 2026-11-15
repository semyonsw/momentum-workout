import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { APP_GUIDE_RULES, appGuide } from './appGuide';
import { systemPrompt } from './aiPrompts';

/**
 * The app guide is only worth sending if it is TRUE. Every label it quotes must
 * still be a string somewhere in the app's source: rename or remove a button and
 * this names the guide line that now describes something that is not there.
 */

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) && name !== 'appGuide.ts' ? [path] : [];
  });
}

const SOURCE = sources(join(__dirname, '..', '..'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

/** A quoted label worth checking: no placeholders, ellipses or invented numbers. */
function checkable(label: string): boolean {
  return (
    label.length >= 3 &&
    !/[<>…]/.test(label) &&
    !/\b[NM]\b/.test(label) &&
    !/m:ss|mm:ss/.test(label)
  );
}

describe('the app guide', () => {
  const quoted = (guide: string) =>
    [...guide.matchAll(/"([^"\n]+)"/g)].map((m) => m[1]).filter(checkable);

  it('quotes a real number of labels', () => {
    expect(quoted(appGuide()).length).toBeGreaterThan(150);
  });

  it('quotes only labels that still exist in the source', () => {
    const missing = [...new Set(quoted(appGuide()))].filter((label) => !SOURCE.includes(label));
    expect(missing).toEqual([]);
  });

  it('goes with the chat, after the chat’s own rules', () => {
    const prompt = systemPrompt('en');
    expect(prompt).toContain(APP_GUIDE_RULES);
    expect(prompt.endsWith(appGuide())).toBe(true);
  });

  it('has no Home landing, and four nav items', () => {
    expect(appGuide()).not.toMatch(/\bHome\b/);
    expect(appGuide()).toContain('Four items: "Workout"');
  });

  it('lists what the assistant can change, and nothing it cannot', () => {
    expect(appGuide()).toContain("log today's body weight");
    expect(appGuide()).not.toMatch(
      /log an amount|tick, excuse|### Tasks screen|### Finance screen/,
    );
  });
});
