/**
 * Deterministic time for tests.
 *
 * A surprising amount of Drape is time-shaped: sliding session expiry (S-7), the
 * `YYYY-MM` ledger period boundary in `Asia/Karachi` (§4.26), the 30-day photo purge
 * (§9.3), token TTLs, and the exponential lockout backoff (S-6). None of that can be
 * tested honestly against `Date.now()`.
 *
 * `jest.setup.ts` restores real timers after every test, so a suite that freezes the clock
 * cannot leak that decision into the next file.
 */

/**
 * The canonical "now" for the suite.
 *
 * Chosen deliberately: mid-month, mid-day UTC, which is 17:00 in `Asia/Karachi` (UTC+5) —
 * the same calendar day in both zones. A time near midnight would make period-boundary
 * tests pass or fail depending on which zone the assertion happened to use, which is
 * exactly the bug those tests exist to catch.
 */
export const FIXED_NOW = new Date('2026-08-15T12:00:00.000Z');

/**
 * Freezes the clock. `Date`, `Date.now`, `setTimeout` and friends are all faked, so a test
 * can advance time explicitly rather than wait for it.
 */
export function freezeClock(at: Date = FIXED_NOW): void {
  jest.useFakeTimers({ now: at });
}

/** Moves the frozen clock forward and runs any timer that becomes due. */
export function advanceClock(milliseconds: number): void {
  jest.advanceTimersByTime(milliseconds);
}

/** Jumps the frozen clock to an absolute instant without running intervening timers. */
export function setClock(at: Date): void {
  jest.setSystemTime(at);
}

/** Returns the frozen clock's current instant. */
export function nowFromClock(): Date {
  return new Date(Date.now());
}

/** Restores real timers. Safe to call when the clock was never frozen. */
export function restoreClock(): void {
  jest.useRealTimers();
}

/** `FIXED_NOW` shifted by whole days — the shape most retention assertions want. */
export function daysFromFixedNow(days: number): Date {
  return new Date(FIXED_NOW.getTime() + days * 24 * 60 * 60 * 1000);
}

/** `FIXED_NOW` shifted by whole minutes — token TTLs and lockout windows. */
export function minutesFromFixedNow(minutes: number): Date {
  return new Date(FIXED_NOW.getTime() + minutes * 60 * 1000);
}
