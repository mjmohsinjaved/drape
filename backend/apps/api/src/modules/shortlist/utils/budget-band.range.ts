import { BudgetBand } from '@api/modules/users/enums/budget-band.enum';

/**
 * The PKR bounds behind `budget_band_enum` (§4.1) — PRD C-32.
 *
 * > C-32: "a running total against her stated budget".
 *
 * The bands are stored as an enum rather than as two numbers, which is right: she
 * picks a band, not a figure. But "am I over budget?" needs a figure, and deriving
 * one from the enum's *name* would be a parser over a label. So the mapping is
 * explicit and total — `Record<BudgetBand, …>` stops compiling the day a band is
 * added, which is the point.
 *
 * The top band has no ceiling. `null` says so; a very large sentinel would quietly
 * become a real comparison somewhere.
 */
export interface BudgetRange {
  /** Inclusive floor, in PKR. */
  readonly min: number;
  /** Exclusive ceiling, in PKR. `null` for the open-ended top band. */
  readonly max: number | null;
}

export const BUDGET_BAND_RANGES: Readonly<Record<BudgetBand, BudgetRange>> = {
  [BudgetBand.UNDER_100K]: { min: 0, max: 100_000 },
  [BudgetBand.BAND_100K_250K]: { min: 100_000, max: 250_000 },
  [BudgetBand.BAND_250K_500K]: { min: 250_000, max: 500_000 },
  [BudgetBand.BAND_500K_1M]: { min: 500_000, max: 1_000_000 },
  [BudgetBand.ABOVE_1M]: { min: 1_000_000, max: null },
};

/** The figure a running total is measured against. `null` when she has stated no band. */
export function budgetCeilingFor(band: BudgetBand | null): number | null {
  return band === null ? null : BUDGET_BAND_RANGES[band].max;
}

/**
 * Whether a running total is still inside the stated band.
 *
 * `null` — not "true" — when there is no band or no ceiling. A shortlist with no
 * stated budget is neither within nor over it, and rendering "within budget" for a
 * consumer who never named one would be the API inventing a fact.
 */
export function isWithinBudget(total: number, band: BudgetBand | null): boolean | null {
  const ceiling = budgetCeilingFor(band);
  return ceiling === null ? null : total <= ceiling;
}
