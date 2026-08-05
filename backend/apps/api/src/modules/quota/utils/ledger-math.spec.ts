/**
 * PRD E-5 — "unit coverage of … quota and budget arithmetic".
 *
 * These tests exist to hold one property: **the balance is a function of the rows, and
 * nothing else.** Not of their order, not of when they were inserted, not of a cached
 * total anybody kept. Every case below is a fact about addition over an append-only
 * list; if any of them ever fails, a stored balance has crept in somewhere.
 */
import { QuotaReason } from '../enums/quota-reason.enum';
import { UsageReason } from '../enums/usage-reason.enum';

import {
  BUDGET_STATES,
  budgetStateFor,
  burnPercent,
  crossedThreshold,
  deriveBudgetBalance,
  deriveQuotaBalance,
  projectBudgetExhaustion,
  sumDeltas,
  trailingDailyRate,
  type LedgerRow,
} from './ledger-math';

const AUGUST = '2026-08';
const SEPTEMBER = '2026-09';

function quotaRow(delta: number, reason: QuotaReason, period = AUGUST): LedgerRow<QuotaReason> {
  return { delta, reason, period };
}

function usageRow(delta: number, reason: UsageReason, period = AUGUST): LedgerRow<UsageReason> {
  return { delta, reason, period };
}

describe('quota ledger arithmetic (§4.26)', () => {
  it('derives the balance from a grant and its consumptions', () => {
    const rows = [
      quotaRow(15, QuotaReason.MONTHLY_GRANT),
      quotaRow(-1, QuotaReason.GENERATION_CONSUMED),
      quotaRow(-1, QuotaReason.GENERATION_CONSUMED),
      quotaRow(-1, QuotaReason.GENERATION_CONSUMED),
      quotaRow(-1, QuotaReason.GENERATION_CONSUMED),
    ];

    expect(deriveQuotaBalance(rows, AUGUST)).toEqual({
      period: AUGUST,
      limit: 15,
      used: 4,
      remaining: 11,
    });
  });

  it('counts a mid-period override raise as allowance, not as a rewrite', () => {
    // A-18: the +15 row is untouched. The raise to 40 appends the difference.
    const rows = [
      quotaRow(15, QuotaReason.MONTHLY_GRANT),
      quotaRow(-2, QuotaReason.GENERATION_CONSUMED),
      quotaRow(25, QuotaReason.OVERRIDE_GRANT),
    ];

    const balance = deriveQuotaBalance(rows, AUGUST);

    expect(balance.limit).toBe(40);
    expect(balance.used).toBe(2);
    expect(balance.remaining).toBe(38);
  });

  it('includes an admin adjustment in the allowance', () => {
    const rows = [
      quotaRow(15, QuotaReason.MONTHLY_GRANT),
      quotaRow(-15, QuotaReason.GENERATION_CONSUMED),
      quotaRow(5, QuotaReason.ADMIN_ADJUSTMENT),
    ];

    expect(deriveQuotaBalance(rows, AUGUST)).toEqual({
      period: AUGUST,
      limit: 20,
      used: 15,
      remaining: 5,
    });
  });

  it('treats a refund as an un-consumption, so `used` falls back', () => {
    // The compensating row carries no jobId (UQ_quota_ledger_job) but the same reason,
    // so the decomposition stays honest: she is charged for one generation, not two.
    const rows = [
      quotaRow(15, QuotaReason.MONTHLY_GRANT),
      quotaRow(-1, QuotaReason.GENERATION_CONSUMED),
      quotaRow(-1, QuotaReason.GENERATION_CONSUMED),
      quotaRow(1, QuotaReason.GENERATION_CONSUMED),
    ];

    const balance = deriveQuotaBalance(rows, AUGUST);

    expect(balance.limit).toBe(15);
    expect(balance.used).toBe(1);
    expect(balance.remaining).toBe(14);
  });

  it('does not let one period reach into another', () => {
    const rows = [
      quotaRow(15, QuotaReason.MONTHLY_GRANT, AUGUST),
      quotaRow(-14, QuotaReason.GENERATION_CONSUMED, AUGUST),
      quotaRow(15, QuotaReason.MONTHLY_GRANT, SEPTEMBER),
      quotaRow(-1, QuotaReason.GENERATION_CONSUMED, SEPTEMBER),
    ];

    expect(deriveQuotaBalance(rows, AUGUST).remaining).toBe(1);
    expect(deriveQuotaBalance(rows, SEPTEMBER).remaining).toBe(14);
    // A period the consumer was dormant for has no rows at all — and no balance.
    expect(deriveQuotaBalance(rows, '2026-07').remaining).toBe(0);
  });

  it('gives the same answer whatever order the rows arrive in', () => {
    // The out-of-order insert: a consumption committed before the grant it spends
    // against, a replayed row, rows read back by a different sort. Addition does not
    // care, and neither may the derivation.
    const rows = [
      quotaRow(15, QuotaReason.MONTHLY_GRANT),
      quotaRow(-1, QuotaReason.GENERATION_CONSUMED),
      quotaRow(25, QuotaReason.OVERRIDE_GRANT),
      quotaRow(-3, QuotaReason.GENERATION_CONSUMED),
    ];

    const inOrder = deriveQuotaBalance(rows, AUGUST);
    const reversed = deriveQuotaBalance([...rows].reverse(), AUGUST);
    const shuffled = deriveQuotaBalance([rows[3], rows[0], rows[2], rows[1]], AUGUST);

    expect(reversed).toEqual(inOrder);
    expect(shuffled).toEqual(inOrder);
    expect(inOrder.remaining).toBe(36);
  });

  it('sums to zero for an empty ledger rather than throwing', () => {
    expect(sumDeltas<QuotaReason>([], AUGUST)).toBe(0);
    expect(deriveQuotaBalance([], AUGUST)).toEqual({
      period: AUGUST,
      limit: 0,
      used: 0,
      remaining: 0,
    });
  });
});

describe('budget ledger arithmetic (§4.27)', () => {
  it('splits consumer demand from admin test renders while summing both', () => {
    const rows = [
      usageRow(2000, UsageReason.MONTHLY_BUDGET_GRANT),
      ...Array.from({ length: 40 }, () => usageRow(-1, UsageReason.CONSUMER_GENERATION)),
      ...Array.from({ length: 5 }, () => usageRow(-1, UsageReason.TEST_RENDER)),
    ];

    const balance = deriveBudgetBalance(rows, AUGUST);

    expect(balance.limit).toBe(2000);
    expect(balance.used).toBe(45);
    expect(balance.remaining).toBe(1955);
    expect(sumDeltas(rows, AUGUST, [UsageReason.TEST_RENDER])).toBe(-5);
  });

  it('applies a mid-period budget change as a further grant row', () => {
    const rows = [
      usageRow(2000, UsageReason.MONTHLY_BUDGET_GRANT),
      usageRow(-1500, UsageReason.CONSUMER_GENERATION),
      // The admin lowered budget.monthlyGenerations to 1600 at 3pm.
      usageRow(-400, UsageReason.MONTHLY_BUDGET_GRANT),
    ];

    const balance = deriveBudgetBalance(rows, AUGUST);

    expect(balance.limit).toBe(1600);
    expect(balance.used).toBe(1500);
    expect(balance.remaining).toBe(100);
  });
});

describe('budgetStateFor — the A-29 thresholds', () => {
  const thresholds = { warnAt: 800, hardStopAt: 1000 };

  it('is OK below the soft warning', () => {
    expect(budgetStateFor(799, thresholds)).toBe(BUDGET_STATES.OK);
  });

  it('warns at exactly 80%', () => {
    expect(budgetStateFor(800, thresholds)).toBe(BUDGET_STATES.WARNING);
  });

  it('is still only warning at 99.9%', () => {
    // 999 of 1000. One generation short of the ceiling is not the ceiling: a hard stop
    // here would refuse a try-on the budget could pay for.
    expect(burnPercent(999, 1000)).toBe(99.9);
    expect(budgetStateFor(999, thresholds)).toBe(BUDGET_STATES.WARNING);
  });

  it('hard-stops at exactly 100%', () => {
    expect(budgetStateFor(1000, thresholds)).toBe(BUDGET_STATES.EXHAUSTED);
  });

  it('stays exhausted past 100%', () => {
    expect(budgetStateFor(1001, thresholds)).toBe(BUDGET_STATES.EXHAUSTED);
  });

  it('treats a budget of zero as exhausted, never as unlimited', () => {
    // The safe reading of a missing cost ceiling is not "spend freely".
    expect(budgetStateFor(0, { warnAt: 0, hardStopAt: 0 })).toBe(BUDGET_STATES.EXHAUSTED);
    expect(budgetStateFor(0, { warnAt: 0, hardStopAt: -1 })).toBe(BUDGET_STATES.EXHAUSTED);
  });

  it('reports the burn percentage to one decimal place', () => {
    expect(burnPercent(1612, 2000)).toBe(80.6);
    expect(burnPercent(0, 2000)).toBe(0);
    expect(burnPercent(5, 0)).toBe(100);
  });
});

describe('crossedThreshold — E-14 fires on the crossing, not the state', () => {
  it('is true only for the step that moves across the line', () => {
    expect(crossedThreshold(799, 800, 800)).toBe(true);
  });

  it('is false for every step already above it', () => {
    // The four hundredth generation past 80% must not page an admin again.
    expect(crossedThreshold(800, 801, 800)).toBe(false);
    expect(crossedThreshold(950, 951, 800)).toBe(false);
  });

  it('is false for a step that stays below it', () => {
    expect(crossedThreshold(700, 701, 800)).toBe(false);
  });

  it('is false for a threshold of zero — an unconfigured limit alerts on nothing', () => {
    expect(crossedThreshold(0, 1, 0)).toBe(false);
  });
});

/* -------------------------------------------------------------------------------------------------
 * A-33 — the burn rate and its projection
 *
 * These two used to exist twice: once in `modules/analytics` and once as a private helper on
 * `BudgetService`. A chart and an alert that disagree about when the money runs out is a bug
 * nobody notices until the month it matters, so there is now one implementation — here, next to
 * `burnPercent`, because the projection is a property of the budget, not of the view that draws it.
 * ---------------------------------------------------------------------------------------------- */

describe('trailingDailyRate — A-33', () => {
  it('divides the trailing spend by the window, to one decimal place', () => {
    expect(trailingDailyRate(1_400)).toBe(200);
    expect(trailingDailyRate(35)).toBe(5);
    expect(trailingDailyRate(77)).toBe(11);
  });

  it('is zero for no spend and for a non-positive window', () => {
    expect(trailingDailyRate(0)).toBe(0);
    expect(trailingDailyRate(700, 0)).toBe(0);
  });

  it('never reports a negative rate — a ledger cannot burn backwards', () => {
    expect(trailingDailyRate(-70)).toBe(0);
  });
});

describe('projectBudgetExhaustion — A-33', () => {
  const NOW = new Date('2026-08-15T12:00:00.000Z');
  const RESETS_AT = new Date('2026-09-01T00:00:00.000Z');

  it('projects a date when the rate reaches the ceiling inside the period', () => {
    const projection = projectBudgetExhaustion(
      { remaining: 40, trailingDailyRate: 10, resetsAt: RESETS_AT },
      NOW,
    );

    expect(projection.daysRemaining).toBe(4);
    expect(projection.projectedExhaustionAt).toEqual(
      new Date(NOW.getTime() + 4 * 24 * 60 * 60 * 1000),
    );
  });

  it('answers null at a zero rate — "at this rate, never" is the honest answer', () => {
    expect(
      projectBudgetExhaustion({ remaining: 2_000, trailingDailyRate: 0, resetsAt: RESETS_AT }, NOW),
    ).toEqual({ trailingDailyRate: 0, projectedExhaustionAt: null, daysRemaining: null });
  });

  it('answers null when the budget is already spent', () => {
    expect(
      projectBudgetExhaustion({ remaining: 0, trailingDailyRate: 180, resetsAt: RESETS_AT }, NOW)
        .projectedExhaustionAt,
    ).toBeNull();
  });

  it('answers null past the period boundary — the grant lands first', () => {
    // 923 remaining at 11/day is 84 days: the calendar prevents the event.
    expect(
      projectBudgetExhaustion({ remaining: 923, trailingDailyRate: 11, resetsAt: RESETS_AT }, NOW)
        .projectedExhaustionAt,
    ).toBeNull();
  });
});
