import { describe, expect, it } from 'vitest';

import { truncate } from './truncate';

describe('truncate', () => {
  it('returns short input untouched', () => {
    expect(truncate('Lehenga', 20)).toBe('Lehenga');
    expect(truncate('Lehenga', 7)).toBe('Lehenga');
  });

  it('cuts to maxLength including the ellipsis', () => {
    const output = truncate('Zarrin Bridal Lehenga', 12);
    expect(output).toBe('Zarrin Brid…');
    expect(Array.from(output)).toHaveLength(12);
  });

  it('cuts on a word boundary when asked', () => {
    expect(truncate('Zarrin Bridal Lehenga', 12, { wordBoundary: true })).toBe('Zarrin…');
  });

  it('hard-cuts when a single word exceeds the limit even in wordBoundary mode', () => {
    expect(truncate('Supercalifragilistic', 10, { wordBoundary: true })).toBe('Supercali…');
  });

  it('accepts a custom ellipsis', () => {
    expect(truncate('Zarrin Bridal Lehenga', 12, { ellipsis: '...' })).toBe('Zarrin Br...');
  });

  it('never splits a surrogate pair', () => {
    // A naive input.slice(0, 2) here would leave half a surrogate pair behind.
    const output = truncate('👗👗👗👗👗', 3);
    expect(output).toBe('👗👗…');
    expect(Array.from(output)).toHaveLength(3);
  });

  it('counts non-Latin text by character, not by byte', () => {
    const urdu = 'عروسی لہنگا';
    expect(truncate(urdu, 100)).toBe(urdu);
    expect(Array.from(truncate(urdu, 6))).toHaveLength(6);
  });

  it('trims the whitespace it would otherwise leave before the ellipsis', () => {
    expect(truncate('Zarrin  Bridal', 8)).toBe('Zarrin…');
  });

  it('degrades safely on empty, nullish and non-positive input', () => {
    expect(truncate('', 10)).toBe('');
    expect(truncate(null, 10)).toBe('');
    expect(truncate(undefined, 10)).toBe('');
    expect(truncate('Lehenga', 0)).toBe('');
    expect(truncate('Lehenga', -5)).toBe('');
    expect(truncate('Lehenga', Number.NaN)).toBe('');
  });

  it('falls back to a hard cut when the ellipsis alone fills the budget', () => {
    expect(truncate('Lehenga', 1, { ellipsis: '...' })).toBe('L');
  });
});
