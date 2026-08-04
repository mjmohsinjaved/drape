import { describe, expect, it } from 'vitest';

import { getDirection, isRtlLocale } from './is-rtl-locale';

describe('isRtlLocale', () => {
  it('returns true for Urdu, the RTL locale Drape ships', () => {
    expect(isRtlLocale('ur')).toBe(true);
    expect(isRtlLocale('ur-PK')).toBe(true);
    expect(isRtlLocale('UR-pk')).toBe(true);
    expect(isRtlLocale('ur_PK')).toBe(true);
  });

  it('returns false for English', () => {
    expect(isRtlLocale('en')).toBe(false);
    expect(isRtlLocale('en-PK')).toBe(false);
    expect(isRtlLocale('en-US')).toBe(false);
  });

  it('recognises other RTL languages', () => {
    for (const locale of ['ar', 'ar-EG', 'he-IL', 'fa-IR', 'ps', 'sd', 'ckb', 'dv', 'yi']) {
      expect(isRtlLocale(locale), locale).toBe(true);
    }
  });

  it('recognises an RTL script subtag on an otherwise LTR language', () => {
    expect(isRtlLocale('pa-Arab-PK')).toBe(true);
    expect(isRtlLocale('pa-Guru-IN')).toBe(false);
  });

  it('does not match a region that merely looks like a language subtag', () => {
    // `AR` here is Argentina, not Arabic.
    expect(isRtlLocale('es-AR')).toBe(false);
  });

  it('treats unknown, empty and non-string input as LTR', () => {
    expect(isRtlLocale('')).toBe(false);
    expect(isRtlLocale('   ')).toBe(false);
    expect(isRtlLocale('zz-ZZ')).toBe(false);
    expect(isRtlLocale(null)).toBe(false);
    expect(isRtlLocale(undefined)).toBe(false);
  });

  it('handles the two-part uz-af entry', () => {
    expect(isRtlLocale('uz-AF')).toBe(true);
    expect(isRtlLocale('uz-UZ')).toBe(false);
  });
});

describe('getDirection', () => {
  it('maps to the html dir attribute value', () => {
    expect(getDirection('ur')).toBe('rtl');
    expect(getDirection('en')).toBe('ltr');
    expect(getDirection(undefined)).toBe('ltr');
  });
});
