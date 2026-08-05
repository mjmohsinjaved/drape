const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** A-33 — the trailing window the burn rate is measured over. */
export const TRAILING_WINDOW_DAYS = 7;

/** What {@link projectBudgetExhaustion} needs, and nothing more. */
export interface BudgetProjectionInput {
  /** Generations left this period. `SUM(delta)` over `usage_ledger` — never a stored column. */
  readonly remaining: number;
  /** Generations per day over the trailing seven days. See {@link trailingDailyRate}. */
  readonly trailingDailyRate: number;
  /** When the period rolls over and the budget is granted again (§4.26). */
  readonly resetsAt: Date;
}

/** The A-33 burn figures. */
export interface BudgetProjection {
  /** Echoed back so a caller has the rate and its consequence in one object. */
  readonly trailingDailyRate: number;
  /**
   * When the budget runs out at that rate, or `null` when it does not run out before
   * the period resets — see below for why `null` is the honest answer in three cases.
   */
  readonly projectedExhaustionAt: Date | null;
  /** Days of budget left at the trailing rate, or `null` when the rate is zero. */
  readonly daysRemaining: number | null;
}

/**
 * A-33 — spend over the trailing window, as a per-day rate. One decimal place.
 *
 * Separate from the projection because it is a different question with a different
 * failure mode: this one is arithmetic over a ledger sum, and the projection is a
 * judgement about what that rate implies.
 */
export function trailingDailyRate(
  trailingSpend: number,
  windowDays: number = TRAILING_WINDOW_DAYS,
): number {
  if (windowDays <= 0) {
    return 0;
  }
  return round1(Math.max(0, trailingSpend) / windowDays);
}

/**
 * **A-33 — "projected exhaustion from a 7-day trailing rate".**
 *
 * Three cases answer `null`, each for a different reason:
 *
 *  - **Zero usage.** A rate of zero divides into the remaining budget as infinity. A
 *    chart cannot draw infinity and an admin cannot act on it, so the projection is
 *    `null` — "at this rate, never" — rather than a date in the year 30,000.
 *  - **Nothing left.** The budget is already spent; there is no exhaustion to project
 *    because it has happened.
 *  - **Past the period boundary.** The budget resets on the boundary (§4.26), so a
 *    projection beyond it would predict an event the calendar prevents. Reporting "you
 *    will run out on the 3rd of next month" when the grant lands on the 1st is worse
 *    than reporting nothing: it invites an admin to raise a ceiling that did not need
 *    raising.
 *
 * A pure function over two numbers and a date, so every case is exercised from a
 * literal rather than through a ledger (E-5).
 *
 * ### Note for whoever consolidates this
 *
 * `quota`'s `BudgetService` carries a private helper computing the same figure for
 * `GET /admin/usage` (§5.16). Two implementations of one number is one too many; this
 * is the exported, tested one and the private copy should call it. The duplication is
 * flagged rather than silently left, because a burn-rate chart and a burn-rate alert
 * that disagree is a bug nobody notices until the month it matters.
 */
export function projectBudgetExhaustion(
  input: BudgetProjectionInput,
  now: Date = new Date(),
): BudgetProjection {
  const rate = round1(input.trailingDailyRate);

  if (rate <= 0 || input.remaining <= 0) {
    return { trailingDailyRate: rate, projectedExhaustionAt: null, daysRemaining: null };
  }

  const daysRemaining = input.remaining / rate;
  const projected = new Date(now.getTime() + daysRemaining * MILLISECONDS_PER_DAY);

  return {
    trailingDailyRate: rate,
    daysRemaining: round1(daysRemaining),
    projectedExhaustionAt: projected >= input.resetsAt ? null : projected,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
