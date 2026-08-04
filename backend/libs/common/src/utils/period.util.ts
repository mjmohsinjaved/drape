/**
 * Billing-period helpers — ARCHITECTURE.md §4.26 / §4.27.
 *
 * `quota_ledger.period` and `usage_ledger.period` are `char(7)`, `YYYY-MM`, in the
 * `TIMEZONE` zone (default `Asia/Karachi`). The period boundary is a **local**
 * midnight, not a UTC one, so every conversion here goes through `Intl` with an
 * explicit time zone rather than through the host's local time.
 *
 * No date library is used: `date-fns` v4 needs `@date-fns/tz` for zoned arithmetic
 * and that is not a declared dependency, while `Intl.DateTimeFormat` ships with Node.
 */

/** The ledger period zone. Overridden per call from `TIMEZONE` where it matters. */
export const DEFAULT_BILLING_TIME_ZONE = 'Asia/Karachi';

/** A `YYYY-MM` billing period. Month is `01`–`12`. */
export const BILLING_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Exact width of the `char(7)` column. */
export const BILLING_PERIOD_LENGTH = 7;

/** A parsed period. `month` is 1-based, as it reads in the string. */
export interface ParsedPeriod {
  year: number;
  /** 1–12. */
  month: number;
}

/** true when `value` is a well-formed `YYYY-MM` period. */
export function isValidPeriod(value: unknown): value is string {
  return typeof value === 'string' && BILLING_PERIOD_PATTERN.test(value);
}

function assertValidPeriod(period: string, caller: string): void {
  // Tested against the pattern directly rather than through `isValidPeriod`:
  // that predicate narrows an already-`string` argument to `never` on the
  // negative branch, which makes it unusable in the error message.
  if (!BILLING_PERIOD_PATTERN.test(period)) {
    throw new Error(`${caller}: "${period}" is not a YYYY-MM billing period`);
  }
}

/** Formats a year and 1-based month as `YYYY-MM`. */
export function formatPeriod(year: number, month: number): string {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new Error(`formatPeriod: year ${year} is out of range`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`formatPeriod: month ${month} is out of range`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** Splits a `YYYY-MM` period into its parts. */
export function parsePeriod(period: string): ParsedPeriod {
  assertValidPeriod(period, 'parsePeriod');
  return { year: Number(period.slice(0, 4)), month: Number(period.slice(5, 7)) };
}

/**
 * The wall-clock parts of `instant` in `timeZone`.
 * `Intl` is the only zone database available without a new dependency.
 */
function zonedParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  }

  return {
    year: parts.year ?? 0,
    // `hourCycle: h23` is not requested, so 24:00 can appear for local midnight.
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: (parts.hour ?? 0) % 24,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** The offset of `timeZone` from UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // Discard the sub-second remainder: `asUtc` has second resolution.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The `YYYY-MM` period an instant falls in, in `timeZone`. */
export function periodFor(instant: Date, timeZone: string = DEFAULT_BILLING_TIME_ZONE): string {
  const parts = zonedParts(instant, timeZone);
  return formatPeriod(parts.year, parts.month);
}

/** The current `YYYY-MM` period. `now` is injectable so tests never depend on the clock. */
export function currentPeriod(
  timeZone: string = DEFAULT_BILLING_TIME_ZONE,
  now: Date = new Date(),
): string {
  return periodFor(now, timeZone);
}

/** The period after `period`. Rolls the year over at December. */
export function nextPeriod(period: string): string {
  const { year, month } = parsePeriod(period);
  return month === 12 ? formatPeriod(year + 1, 1) : formatPeriod(year, month + 1);
}

/** The period before `period`. Rolls the year back at January. */
export function previousPeriod(period: string): string {
  const { year, month } = parsePeriod(period);
  return month === 1 ? formatPeriod(year - 1, 12) : formatPeriod(year, month - 1);
}

/** Shifts a period by `months`, forwards or backwards. */
export function addPeriods(period: string, months: number): string {
  if (!Number.isInteger(months)) {
    throw new Error('addPeriods: months must be an integer');
  }
  const { year, month } = parsePeriod(period);
  const zeroBased = year * 12 + (month - 1) + months;
  return formatPeriod(Math.floor(zeroBased / 12), (zeroBased % 12) + 1);
}

/** Negative when `a` precedes `b`, 0 when equal, positive when `a` follows `b`. */
export function comparePeriods(a: string, b: string): number {
  assertValidPeriod(a, 'comparePeriods');
  assertValidPeriod(b, 'comparePeriods');
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The UTC instant of local midnight on the first day of `period` in `timeZone`.
 *
 * The offset is resolved twice: once from a naive UTC guess and once from the
 * corrected instant, which settles the answer across a DST transition that lands on
 * the boundary itself. `Asia/Karachi` has no DST today, but the helper must not
 * quietly break if `TIMEZONE` is ever changed.
 */
export function periodStart(period: string, timeZone: string = DEFAULT_BILLING_TIME_ZONE): Date {
  const { year, month } = parsePeriod(period);
  const naiveUtcMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);

  let instantMs = naiveUtcMs - zoneOffsetMs(new Date(naiveUtcMs), timeZone);
  instantMs = naiveUtcMs - zoneOffsetMs(new Date(instantMs), timeZone);

  return new Date(instantMs);
}

/**
 * The UTC instant at which `period` ends — exclusive, i.e. the start of the next
 * period. This is the `resetsAt` value surfaced in `QUOTA_EXHAUSTED.details` (§2.3).
 */
export function periodEnd(period: string, timeZone: string = DEFAULT_BILLING_TIME_ZONE): Date {
  return periodStart(nextPeriod(period), timeZone);
}

/** Alias for `periodEnd` — reads better at the `QUOTA_EXHAUSTED` throw site. */
export function periodResetsAt(period: string, timeZone: string = DEFAULT_BILLING_TIME_ZONE): Date {
  return periodEnd(period, timeZone);
}

/** true when `instant` falls inside `period`, in `timeZone`. */
export function isInPeriod(
  period: string,
  instant: Date,
  timeZone: string = DEFAULT_BILLING_TIME_ZONE,
): boolean {
  return periodFor(instant, timeZone) === period;
}

/** Every period from `from` to `to`, inclusive, ascending. */
export function periodRange(from: string, to: string): string[] {
  assertValidPeriod(from, 'periodRange');
  assertValidPeriod(to, 'periodRange');
  if (comparePeriods(from, to) > 0) {
    return [];
  }
  const periods: string[] = [];
  let cursor = from;
  while (comparePeriods(cursor, to) <= 0) {
    periods.push(cursor);
    cursor = nextPeriod(cursor);
  }
  return periods;
}

/** The `n` most recent periods ending at `period`, ascending. Used by the A-33 chart. */
export function lastNPeriods(period: string, count: number): string[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('lastNPeriods: count must be a positive integer');
  }
  return periodRange(addPeriods(period, -(count - 1)), period);
}
