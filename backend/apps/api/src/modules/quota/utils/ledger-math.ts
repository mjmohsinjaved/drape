import { QuotaReason } from '../enums/quota-reason.enum';
import { UsageReason } from '../enums/usage-reason.enum';

/**
 * The arithmetic behind `quota_ledger` and `usage_ledger` — as **pure functions**.
 *
 * ### Why this file exists at all
 *
 * ARCHITECTURE §4.0 rule 10 and CLAUDE.md say the same thing twice: these two tables
 * are append-only and **remaining quota and remaining budget are derived by summing,
 * never stored in a mutable column**. A stored balance is a second source of truth
 * that drifts the first time a write half-fails, and once it has drifted there is no
 * way to tell which number was ever right. Summing an immutable list has no such
 * failure mode — the answer is a function of the rows, and the rows cannot change.
 *
 * Keeping the arithmetic *here*, over plain arrays and plain numbers, is what makes
 * E-5 ("unit coverage of … quota and budget arithmetic") mean something. Every case
 * worth testing — a grant, a consumption, an override raised mid-period, a period
 * boundary, a row inserted out of chronological order — is reachable from an array
 * literal, without a database, a transaction or a mock.
 *
 * ### The one property everything else rests on
 *
 * **Order does not matter.** Addition is commutative, so a row inserted late, or with
 * a `createdAt` earlier than the row before it, or replayed after a retry, changes
 * nothing about the balance. Any implementation that walked the rows in order and
 * carried a running total would be order-sensitive and would give a different answer
 * for the same facts. This one cannot.
 *
 * `usage_ledger.balanceAfter` is the deliberate exception that proves the rule: §4.27
 * calls it "an advisory snapshot for the A-33 burn-rate chart" and says outright that
 * "any code that reads `balanceAfter` to make a decision is a bug". Nothing in this
 * file reads it.
 */

/** The minimum shape the arithmetic needs from a ledger row. */
export interface LedgerRow<TReason extends string> {
  readonly delta: number;
  readonly reason: TReason;
  readonly period: string;
}

/** Quota reasons that *give* a consumer allowance (§4.26). */
export const QUOTA_GRANT_REASONS: readonly QuotaReason[] = [
  QuotaReason.MONTHLY_GRANT,
  QuotaReason.OVERRIDE_GRANT,
  QuotaReason.ADMIN_ADJUSTMENT,
];

/** The only quota reason that *spends* it. */
export const QUOTA_SPEND_REASONS: readonly QuotaReason[] = [QuotaReason.GENERATION_CONSUMED];

/** Usage reasons that give the platform budget (§4.27). */
export const BUDGET_GRANT_REASONS: readonly UsageReason[] = [
  UsageReason.MONTHLY_BUDGET_GRANT,
  UsageReason.ADMIN_ADJUSTMENT,
];

/** Usage reasons that spend it — split so A-33 can separate demand from testing. */
export const BUDGET_SPEND_REASONS: readonly UsageReason[] = [
  UsageReason.CONSUMER_GENERATION,
  UsageReason.TEST_RENDER,
];

/**
 * A-29's three states. Deliberately a union of string literals rather than a TS
 * `enum`: it is never persisted, so it has no entry in the §4.1 PostgreSQL enum
 * registry and must not look as though it does.
 */
export type BudgetState = 'OK' | 'WARNING' | 'EXHAUSTED';

export const BUDGET_STATES = {
  OK: 'OK',
  WARNING: 'WARNING',
  EXHAUSTED: 'EXHAUSTED',
} as const satisfies Record<BudgetState, BudgetState>;

/** What the A-29 thresholds are, as `SettingsService.getBudgetPolicy()` reports them. */
export interface BudgetThresholds {
  /** `budget.monthlyGenerations` — the hard stop. */
  readonly hardStopAt: number;
  /** `floor(monthlyGenerations * warnThresholdPercent / 100)` — the soft warning. */
  readonly warnAt: number;
}

/** The derived shape both ledgers report. */
export interface LedgerBalance {
  readonly period: string;
  /** Sum of the granting rows. */
  readonly limit: number;
  /** Absolute value of the sum of the spending rows. */
  readonly used: number;
  /** `SUM(delta)` over every row — the authoritative number (§4.26, §4.27). */
  readonly remaining: number;
}

/**
 * `SELECT COALESCE(SUM(delta), 0) …` — the whole of it.
 *
 * Rows outside `period` are excluded rather than tolerated: a period is a closed
 * accounting window, and an August consumption must not be able to reach back into
 * July's balance or forward into September's.
 */
export function sumDeltas<TReason extends string>(
  rows: readonly LedgerRow<TReason>[],
  period: string,
  reasons?: readonly TReason[],
): number {
  const allowed = reasons === undefined ? null : new Set<string>(reasons);

  return rows.reduce((total, row) => {
    if (row.period !== period) {
      return total;
    }
    if (allowed !== null && !allowed.has(row.reason)) {
      return total;
    }
    return total + row.delta;
  }, 0);
}

/**
 * The derived balance for one period, from a list of rows in any order.
 *
 * `remaining` is `SUM(delta)` over *everything*, not `limit - used`, so it stays
 * correct even for a reason this file has not been taught about yet. `limit` and
 * `used` are the human-readable decomposition the C-5 counter and the A-33 dashboard
 * display; `remaining` is what a guard decides on.
 */
export function deriveBalance<TReason extends string>(
  rows: readonly LedgerRow<TReason>[],
  period: string,
  grantReasons: readonly TReason[],
  spendReasons: readonly TReason[],
): LedgerBalance {
  const spent = sumDeltas(rows, period, spendReasons);

  return {
    period,
    limit: sumDeltas(rows, period, grantReasons),
    // `-0` is a real value in JavaScript and it leaks: `Object.is(-0, 0)` is false, so
    // an untouched ledger would fail an equality assertion for a reason that has
    // nothing to do with quota. Normalised once, here.
    used: spent === 0 ? 0 : -spent,
    remaining: sumDeltas(rows, period),
  };
}

/** `deriveBalance` with the `quota_ledger` reason split already applied (§4.26). */
export function deriveQuotaBalance(
  rows: readonly LedgerRow<QuotaReason>[],
  period: string,
): LedgerBalance {
  return deriveBalance(rows, period, QUOTA_GRANT_REASONS, QUOTA_SPEND_REASONS);
}

/** `deriveBalance` with the `usage_ledger` reason split already applied (§4.27). */
export function deriveBudgetBalance(
  rows: readonly LedgerRow<UsageReason>[],
  period: string,
): LedgerBalance {
  return deriveBalance(rows, period, BUDGET_GRANT_REASONS, BUDGET_SPEND_REASONS);
}

/**
 * A-29 — where `used` sits against the two thresholds.
 *
 * Both comparisons are `>=`, and that is the entire specification: "a soft warning at
 * 80% and a hard stop at 100%". At exactly `warnAt` the warning has fired; at exactly
 * `hardStopAt` the fitting room is closed. One generation short of the hard stop it
 * is not — 99.9% of a budget is still a budget with something left in it, and a `>`
 * on the warning or a `>=` off by one on the hard stop is precisely the bug that
 * either spams an admin a day early or spends a generation nobody authorised.
 *
 * A `hardStopAt` of `0` or less means "no budget configured"; it is treated as
 * exhausted rather than as unlimited, because the safe reading of a missing cost
 * ceiling is not "spend freely".
 */
export function budgetStateFor(used: number, thresholds: BudgetThresholds): BudgetState {
  if (thresholds.hardStopAt <= 0 || used >= thresholds.hardStopAt) {
    return BUDGET_STATES.EXHAUSTED;
  }
  if (thresholds.warnAt > 0 && used >= thresholds.warnAt) {
    return BUDGET_STATES.WARNING;
  }
  return BUDGET_STATES.OK;
}

/** Percent of the monthly budget consumed, 0–100+, rounded to one place for E-13. */
export function burnPercent(used: number, hardStopAt: number): number {
  if (hardStopAt <= 0) {
    return 100;
  }
  return Math.round((used / hardStopAt) * 1000) / 10;
}

/**
 * true when a consumption moved `used` **across** a threshold — the transition, not
 * the state.
 *
 * E-14 alerts on "budget at 80% and 100%". An alert that fired on the state rather
 * than the crossing would fire on every one of the four hundred generations after the
 * threshold, and an admin who is paged four hundred times stops reading the pages.
 */
export function crossedThreshold(
  usedBefore: number,
  usedAfter: number,
  threshold: number,
): boolean {
  return threshold > 0 && usedBefore < threshold && usedAfter >= threshold;
}
