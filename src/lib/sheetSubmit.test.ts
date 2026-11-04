import { describe, expect, it } from 'vitest';

import { sheetNumber } from './sheetSubmit';

/**
 * U8: the return key saves when — and only when — the button would. These are
 * the one rule both read.
 */

describe('sheetNumber — what NumberSheet’s return and Save accept', () => {
  it('takes a whole number at or above the floor', () => {
    expect(sheetNumber('91')).toBe(91);
    expect(sheetNumber('1')).toBe(1);
    expect(sheetNumber(' 12 ')).toBe(12);
  });

  it('refuses nothing, zero below the default floor, and anything not digits', () => {
    expect(sheetNumber('')).toBeNull();
    expect(sheetNumber('   ')).toBeNull();
    expect(sheetNumber('0')).toBeNull();
    expect(sheetNumber('-3')).toBeNull();
    expect(sheetNumber('1e3')).toBeNull();
    expect(sheetNumber('12a')).toBeNull();
    expect(sheetNumber('1 2')).toBeNull();
  });

  it('honours a custom floor', () => {
    expect(sheetNumber('0', { min: 0 })).toBe(0);
    expect(sheetNumber('4', { min: 5 })).toBeNull();
    expect(sheetNumber('5', { min: 5 })).toBe(5);
  });

  it('refuses a decimal unless the sheet takes one', () => {
    expect(sheetNumber('62.5')).toBeNull();
    expect(sheetNumber('62.5', { decimal: true })).toBe(62.5);
  });

  it('takes a comma from a Russian keyboard as the point', () => {
    expect(sheetNumber('62,5', { decimal: true })).toBe(62.5);
  });

  it('allows one decimal place, and a trailing point mid-typing', () => {
    expect(sheetNumber('62.', { decimal: true })).toBe(62);
    expect(sheetNumber('62.55', { decimal: true })).toBeNull();
    expect(sheetNumber('.5', { decimal: true })).toBeNull();
    expect(sheetNumber('6.2.5', { decimal: true })).toBeNull();
  });
});
