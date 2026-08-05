import { MILLISECONDS_PER_DAY } from '@library/common';

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
/**
 * A-29's soft warning, **against whatever ceiling actually applies**.
 *
 * `SettingsService.getBudgetPolicy()` computes `warnAt` from
 * `budget.monthlyGenerations`, which is right for the policy and wrong for a period an
 * admin has adjusted: an `ADMIN_ADJUSTMENT` row moves the period's granted total and
 * touches no setting, so a warning pinned to the setting fires at 80% of a budget that
 * no longer exists. The ratio is the durable part of the policy; the number is not.
 *
 * A ceiling of zero warns at zero, and `budgetStateFor` reads a zero `hardStopAt` as
 * exhausted anyway — so the two agree that a budget of nothing is not a budget to warn
 * about, it is a budget that is already spent.
 */
export function warnAtOf(ceiling: number, warnThresholdPercent: number): number {
  return Math.floor((Math.max(0, ceiling) * Math.max(0, warnThresholdPercent)) / 100);
}

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

/* -------------------------------------------------------------------------------------------------
 * A-33 — the burn rate and what it implies
 *
 * These two live here, next to `burnPercent`, because the projection is a property of the
 * **budget**, not of the reporting view that draws it. `modules/analytics` had its own copy and
 * `BudgetService` had a second private one, which meant the A-33 usage chart and the E-14 budget
 * alert could disagree about when the money runs out. One implementation, imported by both.
 * ---------------------------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------------------------------
 * Refund identity
 * ---------------------------------------------------------------------------------------------- */

/**
 * The marker a compensating row carries so a second refund of the same job can find the
 * first — **and therefore do nothing**.
 *
 * ### Why the row cannot simply carry the `jobId`
 *
 * `UQ_quota_ledger_job` and `UQ_usage_ledger_job` are
 * `UNIQUE ("jobId") WHERE "jobId" IS NOT NULL`, and §4.26 says that index "is what makes
 * a double consumption physically impossible". A reversal that reused the id would have
 * to weaken it. So the compensating row is written with `jobId = null`, and the job it
 * reverses is named in `note`.
 *
 * That left both refunds **not idempotent**: `refundWithin` looked for the *charge*,
 * found it — it is still there, ledgers are append-only — and appended another reversal.
 * Two calls credited the consumer twice for one generation. Now the lookup asks the
 * question that actually matters, "has this job already been reversed?", and the marker
 * is what makes that question answerable with an indexed prefix match rather than a
 * convention about wording.
 *
 * The marker leads the note so `note LIKE 'refund:<jobId>%'` is a prefix predicate, and
 * the human-readable reason follows it.
 */
export function refundMarker(jobId: string): string {
  return `refund:${jobId}`;
}

/** `refund:<jobId> — <reason>` — the full note a compensating row carries. */
export function refundNote(jobId: string, reason: string | undefined): string {
  return `${refundMarker(jobId)} — ${(reason ?? 'Refund').slice(0, 160)}`;
}

/** The `LIKE` pattern that finds an existing reversal of `jobId`. */
export function refundNotePattern(jobId: string): string {
  return `${refundMarker(jobId)}%`;
}
