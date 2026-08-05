/**
 * PRD A-33, A-36, A-37, A-38 — the arithmetic behind the admin reports.
 *
 * These four functions are pure on purpose (E-5): a funnel that divides wrongly, a
 * leaderboard that picks the wrong denominator and a projection that returns a date
 * when it should return `null` are all silent failures — the chart still draws, the
 * numbers still look like numbers, and the buyer acts on them. So they are tested
 * against a fixed fixture set rather than through four joins and a ledger.
 */
import { MAX_ANALYTICS_WINDOW_DAYS } from '../constants/analytics.constants';

import { resolveAnalyticsWindow } from './analytics-window';
import { projectBudgetExhaustion, trailingDailyRate } from './budget-projection';
import { buildFunnel, percent, type FunnelCounts } from './funnel-math';
import { buildLeaderboardRow, buildRejectionRollup, count } from './leaderboard-math';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const PERIOD_RESETS_AT = new Date('2026-09-01T00:00:00.000Z');

/**
 * A fixed cohort. 1,000 signed up; the numbers below are the ones a real funnel
 * produces — a big drop at the photo, a small one at the enquiry.
 */
const COHORT: FunnelCounts = {
  SIGNUP: 1_000,
  EMAIL_VERIFIED: 780,
  PHOTO_UPLOADED: 390,
  FIRST_TRYON: 351,
  SHORTLISTED: 246,
  ENQUIRY: 62,
};

describe('A-36 funnel arithmetic', () => {
  const steps = buildFunnel(COHORT);

  it('returns the six A-36 steps in order', () => {
    expect(steps.map((step) => step.step)).toEqual([
      'SIGNUP',
      'EMAIL_VERIFIED',
      'PHOTO_UPLOADED',
      'FIRST_TRYON',
      'SHORTLISTED',
      'ENQUIRY',
    ]);
  });

  it('measures conversion from the signup cohort', () => {
    expect(steps[0].conversionFromStart).toBe(100);
    expect(steps[1].conversionFromStart).toBe(78);
    expect(steps[2].conversionFromStart).toBe(39);
    expect(steps[5].conversionFromStart).toBe(6.2);
  });

  it('measures conversion from the previous step — where the leak actually is', () => {
    // 390 of 780 verified consumers uploaded a photo: exactly half, and the largest
    // single drop in the funnel. From the start it looks like a gentle slope; from
    // the previous step it is the number worth acting on.
    expect(steps[2].conversionFromPrevious).toBe(50);
    expect(steps[3].conversionFromPrevious).toBe(90);
    expect(steps[5].conversionFromPrevious).toBe(25.2);
  });

  it('reports the drop between steps as a count', () => {
    expect(steps[1].droppedFromPrevious).toBe(220);
    expect(steps[2].droppedFromPrevious).toBe(390);
    expect(steps[0].droppedFromPrevious).toBe(0);
  });

  it('gives every step zero rather than NaN when nobody signed up', () => {
    const empty = buildFunnel({
      SIGNUP: 0,
      EMAIL_VERIFIED: 0,
      PHOTO_UPLOADED: 0,
      FIRST_TRYON: 0,
      SHORTLISTED: 0,
      ENQUIRY: 0,
    });

    for (const step of empty) {
      expect(Number.isNaN(step.conversionFromStart)).toBe(false);
      expect(step.count).toBe(0);
    }
    // A `NaN` reaches the browser as `null` and renders as a blank tile that looks
    // like a bug rather than like an empty state (D-5).
    expect(empty[0].conversionFromStart).toBe(0);
  });

  it('does not go negative when a later step is larger than the one before it', () => {
    // Legitimate: a consumer can star a garment from a shared shortlist without ever
    // uploading a photograph, and a render survives deletion of its source photo (C-28).
    const odd = buildFunnel({ ...COHORT, PHOTO_UPLOADED: 300, FIRST_TRYON: 320 });

    expect(odd[3].droppedFromPrevious).toBe(0);
    expect(odd[3].conversionFromPrevious).toBeGreaterThan(100);
  });

  it('percent rounds to one decimal place', () => {
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(2, 3)).toBe(66.7);
    expect(percent(0, 0)).toBe(0);
  });
});

describe('A-37 leaderboard arithmetic', () => {
  const row = buildLeaderboardRow({
    garmentId: 'a1111111-1111-4111-8111-111111111111',
    title: 'Anarkali in ivory',
    categoryName: 'Bridal',
    tryOns: '128',
    stars: '61',
    rejects: '22',
    enquiries: '9',
  });

  it('takes every rate over try-ons, not over verdicts', () => {
    // 61 of 128 try-ons, not 61 of the 83 people who said something.
    expect(row.starRate).toBe(47.7);
    expect(row.rejectRate).toBe(17.2);
    expect(row.enquiryRate).toBe(7);
  });

  it('reports verdict coverage so the denominator is visible', () => {
    expect(row.verdictCoverage).toBe(64.8);
  });

  it('converts the string counts PostgreSQL returns', () => {
    expect(row.tryOns).toBe(128);
    expect(typeof row.tryOns).toBe('number');
  });

  it('does not report a garment nobody tried as 100% anything', () => {
    const untried = buildLeaderboardRow({
      garmentId: 'b1111111-1111-4111-8111-111111111111',
      title: 'Never tried',
      categoryName: null,
      tryOns: 0,
      stars: 0,
      rejects: 0,
      enquiries: 0,
    });

    expect(untried.starRate).toBe(0);
    expect(untried.rejectRate).toBe(0);
    expect(untried.verdictCoverage).toBe(0);
  });

  it('distinguishes ignored from disliked', () => {
    const ignored = buildLeaderboardRow({
      garmentId: 'c1111111-1111-4111-8111-111111111111',
      title: 'Nobody commits',
      categoryName: 'Formal',
      tryOns: 100,
      stars: 5,
      rejects: 3,
      enquiries: 0,
    });

    expect(ignored.starRate).toBe(5);
    // Only 8% of the people who tried it said anything at all. A 5% star rate with
    // 8% coverage is a different problem from a 5% star rate with 90% coverage.
    expect(ignored.verdictCoverage).toBe(8);
  });

  it('count() survives nulls and rubbish from the driver', () => {
    expect(count(null)).toBe(0);
    expect(count(undefined)).toBe(0);
    expect(count('not a number')).toBe(0);
    expect(count('42')).toBe(42);
  });
});

describe('A-38 rejection rollup', () => {
  const rollup = buildRejectionRollup([
    { reason: 'TOO_HEAVY', count: '87' },
    { reason: 'PRICE', count: '64' },
    { reason: null, count: '100' },
    { reason: 'NECKLINE', count: '26' },
  ]);

  it('orders by frequency', () => {
    expect(rollup.map((row) => row.reason)).toEqual(['UNSTATED', 'TOO_HEAVY', 'PRICE', 'NECKLINE']);
  });

  it('keeps the unstated rejections instead of dropping them (C-21)', () => {
    // Dropping the 100 rows where she declined to say why would inflate TOO_HEAVY
    // from 31.4% to 49% — in the direction that sends a buyer after the wrong stock.
    expect(rollup[0]).toMatchObject({ reason: 'UNSTATED', count: 100, share: 36.1 });
    expect(rollup[1]).toMatchObject({ reason: 'TOO_HEAVY', share: 31.4 });
  });

  it('shares add up to 100', () => {
    const total = rollup.reduce((sum, row) => sum + row.share, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it('returns nothing for a window with no rejections', () => {
    expect(buildRejectionRollup([])).toEqual([]);
  });
});

describe('A-33 budget projection from a 7-day trailing rate', () => {
  it('derives the daily rate from trailing spend', () => {
    expect(trailingDailyRate(1_400)).toBe(200);
    expect(trailingDailyRate(35)).toBe(5);
    expect(trailingDailyRate(0)).toBe(0);
  });

  it('projects exhaustion at the trailing rate', () => {
    const projection = projectBudgetExhaustion(
      { remaining: 400, trailingDailyRate: 200, resetsAt: PERIOD_RESETS_AT },
      NOW,
    );

    expect(projection.daysRemaining).toBe(2);
    // Two days from 15 August at noon.
    expect(projection.projectedExhaustionAt).toEqual(new Date('2026-08-17T12:00:00.000Z'));
  });

  it('returns null on zero usage rather than a date in the year 30,000', () => {
    const projection = projectBudgetExhaustion(
      { remaining: 2_000, trailingDailyRate: 0, resetsAt: PERIOD_RESETS_AT },
      NOW,
    );

    expect(projection).toEqual({
      trailingDailyRate: 0,
      projectedExhaustionAt: null,
      daysRemaining: null,
    });
  });

  it('returns null when the budget is already spent — exhaustion is not a forecast', () => {
    const projection = projectBudgetExhaustion(
      { remaining: 0, trailingDailyRate: 180, resetsAt: PERIOD_RESETS_AT },
      NOW,
    );

    expect(projection.projectedExhaustionAt).toBeNull();
    expect(projection.daysRemaining).toBeNull();
  });

  it('returns null when the budget outlasts the period boundary', () => {
    // 400 left at 10/day is 40 days; the grant lands again on 1 September. Reporting a
    // date in late September would invite an admin to raise a ceiling that resets first.
    const projection = projectBudgetExhaustion(
      { remaining: 400, trailingDailyRate: 10, resetsAt: PERIOD_RESETS_AT },
      NOW,
    );

    expect(projection.projectedExhaustionAt).toBeNull();
    expect(projection.trailingDailyRate).toBe(10);
  });

  it('projects right up to, but not past, the boundary', () => {
    // 16.5 days from noon on 15 August lands on 1 September at midnight — the instant
    // the budget resets. That is the boundary, so it is not a projection.
    const atBoundary = projectBudgetExhaustion(
      { remaining: 165, trailingDailyRate: 10, resetsAt: PERIOD_RESETS_AT },
      NOW,
    );
    expect(atBoundary.projectedExhaustionAt).toBeNull();

    const justInside = projectBudgetExhaustion(
      { remaining: 160, trailingDailyRate: 10, resetsAt: PERIOD_RESETS_AT },
      NOW,
    );
    expect(justInside.projectedExhaustionAt).not.toBeNull();
  });
});

describe('the reporting window is bounded (§5.18)', () => {
  it('defaults to the last 30 days', () => {
    const window = resolveAnalyticsWindow({}, NOW);

    expect(window.to).toEqual(NOW);
    expect(window.days).toBe(30);
  });

  it('refuses a window wider than a year rather than clamping it', () => {
    expect(() =>
      resolveAnalyticsWindow({ from: '2020-01-01T00:00:00.000Z', to: NOW.toISOString() }, NOW),
    ).toThrow();
  });

  it('accepts exactly the maximum', () => {
    const from = new Date(NOW.getTime() - MAX_ANALYTICS_WINDOW_DAYS * 86_400_000);
    expect(() =>
      resolveAnalyticsWindow({ from: from.toISOString(), to: NOW.toISOString() }, NOW),
    ).not.toThrow();
  });

  it('refuses an inverted window', () => {
    expect(() =>
      resolveAnalyticsWindow(
        { from: '2026-08-20T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
        NOW,
      ),
    ).toThrow();
  });

  it('refuses a boundary that is not a date', () => {
    expect(() => resolveAnalyticsWindow({ from: 'last tuesday' }, NOW)).toThrow();
  });
});
