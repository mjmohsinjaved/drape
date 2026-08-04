import { de, enUS } from 'date-fns/locale';
import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, formatRelative, toDate } from './format-date';

// vitest.config.ts pins TZ=UTC, so local time and the ISO instant agree.
const ISO = '2026-08-12T14:30:00.000Z';

describe('toDate', () => {
  it('accepts ISO strings, epoch millis and Date instances', () => {
    expect(toDate(ISO)?.toISOString()).toBe(ISO);
    expect(toDate(Date.parse(ISO))?.toISOString()).toBe(ISO);
    expect(toDate(new Date(ISO))?.toISOString()).toBe(ISO);
  });

  it('returns null for nullish, empty and unparseable input', () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate('')).toBeNull();
    expect(toDate('not a date')).toBeNull();
    expect(toDate(new Date('nonsense'))).toBeNull();
    expect(toDate(Number.NaN)).toBeNull();
  });
});

describe('formatDate', () => {
  it('uses the d MMM yyyy default pattern', () => {
    expect(formatDate(ISO)).toBe('12 Aug 2026');
  });

  it('accepts a custom pattern', () => {
    expect(formatDate(ISO, { pattern: 'yyyy-MM-dd' })).toBe('2026-08-12');
  });

  it('is locale-aware', () => {
    const english = formatDate(ISO, { locale: enUS });
    const german = formatDate(ISO, { locale: de });

    expect(english).toBe('12 Aug 2026');
    expect(german).not.toBe('');
    expect(german).not.toBe(english);
  });

  it('returns the fallback rather than "Invalid Date"', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not a date')).toBe('—');
    expect(formatDate(undefined, { fallback: 'Never' })).toBe('Never');
  });
});

describe('formatDateTime', () => {
  it('appends the time', () => {
    expect(formatDateTime(ISO)).toBe('12 Aug 2026, 14:30');
  });

  it('honours an explicit pattern override', () => {
    expect(formatDateTime(ISO, { pattern: 'yyyy-MM-dd' })).toBe('2026-08-12');
  });

  it('falls back on bad input', () => {
    expect(formatDateTime(null)).toBe('—');
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-08-12T14:30:00.000Z');

  it('describes a past instant with a suffix', () => {
    expect(formatRelative('2026-08-12T11:30:00.000Z', { now })).toBe('about 3 hours ago');
  });

  it('describes a future instant', () => {
    expect(formatRelative('2026-08-14T14:30:00.000Z', { now })).toBe('in 2 days');
  });

  it('can drop the suffix', () => {
    expect(formatRelative('2026-08-12T11:30:00.000Z', { now, addSuffix: false })).toBe(
      'about 3 hours',
    );
  });

  it('is locale-aware', () => {
    const english = formatRelative('2026-08-12T11:30:00.000Z', { now, locale: enUS });
    const german = formatRelative('2026-08-12T11:30:00.000Z', { now, locale: de });

    expect(german).not.toBe('');
    expect(german).not.toBe(english);
  });

  it('works without an explicit `now`', () => {
    expect(formatRelative(new Date())).toMatch(/less than a minute/);
  });

  it('falls back on bad input', () => {
    expect(formatRelative(null)).toBe('—');
    expect(formatRelative('nope', { fallback: '' })).toBe('');
  });
});
