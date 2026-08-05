/**
 * Time arithmetic constants.
 *
 * `24 * 60 * 60 * 1000` was declared privately in six files — `analytics-window.ts`,
 * `budget-projection.ts`, `invites.service.ts`, `person-photos.service.ts`,
 * `purge.service.ts`, `budget.service.ts` — plus a seventh copy exported from
 * `share.constants.ts`. Six correct copies of a number are still six places for a
 * seventh, incorrect one to appear, and a day's worth of milliseconds is not a fact
 * about any module.
 *
 * Deliberately **not** a calendar-aware helper: this is exactly 86 400 000 ms, which is
 * what a retention window, a TTL and a trailing-rate denominator all mean. Anything that
 * needs "the same clock time next month" belongs in `period.util.ts`, which knows about
 * time zones.
 */

/** Milliseconds in a 24-hour day. */
export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Milliseconds in an hour. */
export const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
