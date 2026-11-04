import { describe, expect, it } from 'vitest';

import { MAX_DIGITS, keypadKeys, keypadPress } from './keypad';

/** Every key in turn, from an empty entry. */
function type(keys: string[], decimals: number, from = ''): string {
  return keys.reduce((entry, key) => keypadPress(entry, key, decimals), from);
}

describe('the keys', () => {
  it('draw `.` with decimals and `000` without', () => {
    expect(keypadKeys(1)[9]).toBe('.');
    expect(keypadKeys(0)[9]).toBe('000');
  });

  it('twelve keys either way, with ⌫ last', () => {
    expect(keypadKeys(0)).toHaveLength(12);
    expect(keypadKeys(2)).toHaveLength(12);
    expect(keypadKeys(2)[11]).toBe('back');
  });
});

describe('keypadPress — the entry reducer', () => {
  it('types digits, dropping a leading zero', () => {
    expect(type(['1', '2', '5'], 2)).toBe('125');
    expect(type(['0', '5'], 2)).toBe('5');
    expect(type(['0', '0'], 0)).toBe('0');
  });

  it('a point starts the fraction; a bare point is "0."', () => {
    expect(type(['1', '2', '.', '5'], 2)).toBe('12.5');
    expect(type(['.', '5'], 2)).toBe('0.5');
  });

  it('ignores a second point', () => {
    expect(type(['1', '.', '.', '5'], 2)).toBe('1.5');
    expect(type(['1', '.', '5', '.', '0'], 2)).toBe('1.50');
  });

  it('caps the fraction at two decimals', () => {
    expect(type(['9', '.', '9', '9', '9', '9'], 2)).toBe('9.99');
  });

  it('ignores the point where there are no decimals', () => {
    expect(type(['1', '.', '5'], 0)).toBe('15');
  });

  it('backspaces across the point, one character at a time', () => {
    const entry = type(['1', '2', '.', '3', '4'], 2);
    expect(entry).toBe('12.34');
    const steps = [];
    let current = entry;
    for (let i = 0; i < 6; i += 1) {
      current = keypadPress(current, 'back', 2);
      steps.push(current);
    }
    expect(steps).toEqual(['12.3', '12.', '12', '1', '', '']);
    // And typing again after the point is gone starts the whole part again.
    expect(keypadPress('12', '5', 2)).toBe('125');
  });

  it('keeps `000` exactly as it was without decimals', () => {
    expect(type(['5', '000'], 0)).toBe('5000');
    expect(type(['000'], 0)).toBe('0');
    expect(type(['1', '.', '000'], 2)).toBe('1.');
  });

  it('holds the whole part to the cap, two digits fewer with cents', () => {
    const many = Array.from({ length: 20 }, () => '9');
    expect(type(many, 0)).toHaveLength(MAX_DIGITS);
    expect(type(many, 2)).toHaveLength(MAX_DIGITS - 2);
    expect(type([...many, '.', '9', '9'], 2)).toBe(`${'9'.repeat(MAX_DIGITS - 2)}.99`);
  });
});
