import {
  addPeriods,
  BILLING_PERIOD_LENGTH,
  comparePeriods,
  currentPeriod,
  DEFAULT_BILLING_TIME_ZONE,
  formatPeriod,
  isInPeriod,
  isValidPeriod,
  lastNPeriods,
  nextPeriod,
  parsePeriod,
  periodEnd,
  periodFor,
  periodRange,
  periodResetsAt,
  periodStart,
  previousPeriod,
} from './period.util';

describe('isValidPeriod', () => {
  it('accepts a well-formed YYYY-MM', () => {
    expect(isValidPeriod('2026-08')).toBe(true);
    expect(isValidPeriod('2026-01')).toBe(true);
    expect(isValidPeriod('2026-12')).toBe(true);
  });

  it('rejects an out-of-range or malformed month', () => {
    expect(isValidPeriod('2026-00')).toBe(false);
    expect(isValidPeriod('2026-13')).toBe(false);
    expect(isValidPeriod('2026-8')).toBe(false);
    expect(isValidPeriod('26-08')).toBe(false);
    expect(isValidPeriod('2026/08')).toBe(false);
    expect(isValidPeriod(undefined)).toBe(false);
  });

  it('always yields the char(7) width the column declares', () => {
    expect('2026-08').toHaveLength(BILLING_PERIOD_LENGTH);
  });
});

describe('formatPeriod / parsePeriod', () => {
  it('zero-pads the month', () => {
    expect(formatPeriod(2026, 3)).toBe('2026-03');
  });

  it('round-trips', () => {
    expect(parsePeriod(formatPeriod(2026, 11))).toEqual({ year: 2026, month: 11 });
  });

  it('rejects an out-of-range month or year', () => {
    expect(() => formatPeriod(2026, 0)).toThrow(/month/);
    expect(() => formatPeriod(2026, 13)).toThrow(/month/);
    expect(() => formatPeriod(0, 1)).toThrow(/year/);
  });

  it('rejects a malformed period', () => {
    expect(() => parsePeriod('2026-13')).toThrow(/YYYY-MM/);
  });
});

describe('periodFor', () => {
  it('uses the ledger time zone, not UTC', () => {
    // 2026-07-31T20:00Z is already 2026-08-01T01:00 in Asia/Karachi (+05:00),
    // so the ledger row belongs to the August period, not July.
    expect(periodFor(new Date('2026-07-31T20:00:00.000Z'))).toBe('2026-08');
  });

  it('keeps the earlier period just before the local boundary', () => {
    expect(periodFor(new Date('2026-07-31T18:59:59.000Z'))).toBe('2026-07');
  });

  it('honours an explicit time zone', () => {
    expect(periodFor(new Date('2026-08-01T02:00:00.000Z'), 'America/New_York')).toBe('2026-07');
    expect(periodFor(new Date('2026-08-01T02:00:00.000Z'), 'UTC')).toBe('2026-08');
  });
});

describe('currentPeriod', () => {
  it('takes an injectable clock so tests never depend on the wall clock', () => {
    expect(currentPeriod(DEFAULT_BILLING_TIME_ZONE, new Date('2026-02-14T09:00:00.000Z'))).toBe(
      '2026-02',
    );
  });
});

describe('nextPeriod / previousPeriod', () => {
  it('advances within a year', () => {
    expect(nextPeriod('2026-08')).toBe('2026-09');
  });

  it('rolls over at December', () => {
    expect(nextPeriod('2026-12')).toBe('2027-01');
  });

  it('rolls back at January', () => {
    expect(previousPeriod('2026-01')).toBe('2025-12');
  });

  it('is its own inverse', () => {
    expect(previousPeriod(nextPeriod('2026-08'))).toBe('2026-08');
  });
});

describe('addPeriods', () => {
  it('shifts forwards across a year boundary', () => {
    expect(addPeriods('2026-11', 3)).toBe('2027-02');
  });

  it('shifts backwards across a year boundary', () => {
    expect(addPeriods('2026-02', -3)).toBe('2025-11');
  });

  it('is a no-op for zero', () => {
    expect(addPeriods('2026-08', 0)).toBe('2026-08');
  });

  it('rejects a fractional shift', () => {
    expect(() => addPeriods('2026-08', 1.5)).toThrow(/integer/);
  });
});

describe('comparePeriods', () => {
  it('orders chronologically', () => {
    expect(comparePeriods('2026-07', '2026-08')).toBeLessThan(0);
    expect(comparePeriods('2027-01', '2026-12')).toBeGreaterThan(0);
    expect(comparePeriods('2026-08', '2026-08')).toBe(0);
  });
});

describe('periodStart / periodEnd', () => {
  it('resolves the UTC instant of local midnight on the first of the month', () => {
    // Asia/Karachi is UTC+05:00 with no DST.
    expect(periodStart('2026-08').toISOString()).toBe('2026-07-31T19:00:00.000Z');
  });

  it('ends a period exactly where the next one starts', () => {
    expect(periodEnd('2026-08').toISOString()).toBe(periodStart('2026-09').toISOString());
  });

  it('gives QUOTA_EXHAUSTED its resetsAt value', () => {
    expect(periodResetsAt('2026-08').toISOString()).toBe('2026-08-31T19:00:00.000Z');
  });

  it('handles a year boundary', () => {
    expect(periodEnd('2026-12').toISOString()).toBe('2026-12-31T19:00:00.000Z');
  });

  it('is exact for UTC', () => {
    expect(periodStart('2026-08', 'UTC').toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('resolves a DST-observing zone without drifting', () => {
    // America/New_York is UTC-04:00 in August (EDT) and UTC-05:00 in January (EST).
    expect(periodStart('2026-08', 'America/New_York').toISOString()).toBe(
      '2026-08-01T04:00:00.000Z',
    );
    expect(periodStart('2026-01', 'America/New_York').toISOString()).toBe(
      '2026-01-01T05:00:00.000Z',
    );
  });

  it('brackets its own period', () => {
    const start = periodStart('2026-08');
    const end = periodEnd('2026-08');
    expect(periodFor(start)).toBe('2026-08');
    expect(periodFor(new Date(end.getTime() - 1))).toBe('2026-08');
    expect(periodFor(end)).toBe('2026-09');
  });
});

describe('isInPeriod', () => {
  it('is true inside and false outside', () => {
    expect(isInPeriod('2026-08', new Date('2026-08-15T00:00:00.000Z'))).toBe(true);
    expect(isInPeriod('2026-08', new Date('2026-09-15T00:00:00.000Z'))).toBe(false);
  });
});

describe('periodRange / lastNPeriods', () => {
  it('is inclusive of both ends, ascending', () => {
    expect(periodRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('returns a single period when both ends match', () => {
    expect(periodRange('2026-08', '2026-08')).toEqual(['2026-08']);
  });

  it('returns empty when the range is inverted', () => {
    expect(periodRange('2026-09', '2026-08')).toEqual([]);
  });

  it('gives the A-33 burn chart its trailing window', () => {
    expect(lastNPeriods('2026-08', 3)).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('rejects a non-positive count', () => {
    expect(() => lastNPeriods('2026-08', 0)).toThrow(/positive integer/);
  });
});
