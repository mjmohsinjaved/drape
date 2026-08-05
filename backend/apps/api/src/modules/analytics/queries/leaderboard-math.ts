import { percent } from './funnel-math';

/**
 * One garment's raw counts, as the `GROUP BY` returns them.
 *
 * PostgreSQL returns `COUNT(*)` as a string through the driver, so the raw shape is
 * strings and the conversion happens in exactly one place — {@link buildLeaderboardRow}.
 * A `Number()` scattered across a mapper is where a leaderboard silently starts sorting
 * `"9" > "10"`.
 */
export interface GarmentCountsRaw {
  readonly garmentId: string;
  readonly title: string;
  readonly categoryName: string | null;
  /** Distinct renders produced for this garment in the window. */
  readonly tryOns: string | number;
  /** `shortlist_items` at `LOVE_IT` or `MAYBE`. */
  readonly stars: string | number;
  /** `shortlist_items` at `NOT_FOR_ME`. */
  readonly rejects: string | number;
  /** `enquiry_items` referencing this garment. */
  readonly enquiries: string | number;
}

/** One row of the A-37 leaderboard, with the three rates derived. */
export interface GarmentLeaderboardRow {
  readonly garmentId: string;
  readonly title: string;
  readonly categoryName: string | null;
  readonly tryOns: number;
  readonly stars: number;
  readonly rejects: number;
  readonly enquiries: number;
  /** Percent of try-ons that became a `LOVE_IT` or `MAYBE`. */
  readonly starRate: number;
  /** Percent of try-ons that became a `NOT_FOR_ME`. */
  readonly rejectRate: number;
  /** Percent of try-ons that reached an enquiry. */
  readonly enquiryRate: number;
  /**
   * Verdicts as a share of try-ons. Below 1 it means most people who tried the piece
   * never said anything about it, which is a different problem from disliking it.
   */
  readonly verdictCoverage: number;
}

/**
 * **A-37 — "most tried, star rate, reject rate, enquiry rate".**
 *
 * ### Every rate has the same denominator, deliberately
 *
 * All three are per **try-on**, not per verdict. Star rate over verdicts would read
 * beautifully for a garment two people tried and one starred; star rate over try-ons
 * says that of the forty women who tried it, three came back. The second number is the
 * one a buyer can act on, and A-37's own phrasing — "most tried" first — is asking for
 * the try-on to be the unit.
 *
 * `verdictCoverage` is carried alongside so the denominator is visible rather than
 * implied: a garment with a 5% star rate and 8% coverage is not disliked, it is
 * ignored, and those two need different responses from a studio.
 *
 * Pure, so the arithmetic is tested from a literal (E-5) rather than through four joins.
 */
export function buildLeaderboardRow(raw: GarmentCountsRaw): GarmentLeaderboardRow {
  const tryOns = count(raw.tryOns);
  const stars = count(raw.stars);
  const rejects = count(raw.rejects);
  const enquiries = count(raw.enquiries);

  return {
    garmentId: raw.garmentId,
    title: raw.title,
    categoryName: raw.categoryName,
    tryOns,
    stars,
    rejects,
    enquiries,
    starRate: percent(stars, tryOns),
    rejectRate: percent(rejects, tryOns),
    enquiryRate: percent(enquiries, tryOns),
    verdictCoverage: percent(stars + rejects, tryOns),
  };
}

/** One row of the A-38 rejection-reasons rollup. */
export interface RejectionReasonRow {
  /** `NECKLINE`, `COLOR`, `TOO_HEAVY`, `SILHOUETTE`, `PRICE` — or `UNSTATED`. */
  readonly reason: string;
  readonly count: number;
  /** Percent of all rejections in the window. */
  readonly share: number;
}

/**
 * **A-38 — the rejection-reasons rollup.**
 *
 * > "Rejection reasons rollup by neckline, color, weight, silhouette and price."
 *
 * The source is `shortlist_items` at `NOT_FOR_ME` (§4.20: those rows "are retained for
 * A-38 rejection-reason analytics"), and `rejectReason` is nullable there — C-21 lets
 * her say "not for me" without saying why, and most people will. Those rows are
 * reported as `UNSTATED` rather than dropped: a rollup that silently excluded them
 * would overstate every stated reason in proportion to how many people declined to
 * give one, which is exactly the direction that misleads a buyer.
 */
export function buildRejectionRollup(
  rows: readonly { reason: string | null; count: string | number }[],
): RejectionReasonRow[] {
  const counted = rows.map((row) => ({
    reason: row.reason ?? 'UNSTATED',
    count: count(row.count),
  }));

  const total = counted.reduce((sum, row) => sum + row.count, 0);

  return counted
    .map((row) => ({ ...row, share: percent(row.count, total) }))
    .sort((a, b) => b.count - a.count);
}

/** `COUNT(*)` comes back from pg as a string. Converted here and nowhere else. */
export function count(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
