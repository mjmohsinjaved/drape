/**
 * The two numbers the quota ledger, the budget ledger and the analytics projections all
 * have to agree on — PRD C-5, A-16, ARCHITECTURE.md §4.9, §4.10.
 *
 * Both were declared privately in more than one file. `GENERATION_COST` appeared in
 * `quota.service.ts` and `budget.service.ts`; `TRAILING_WINDOW_DAYS` in `budget.service.ts`
 * and `budget-projection.ts`. Two of them can disagree, and if they ever did the panel
 * would project a burn-down the ledger does not agree with — the one failure a
 * derived-balance design cannot tolerate, because there is no stored column to reconcile
 * against.
 */

/**
 * What one generation costs, in ledger units.
 *
 * One, and deliberately a named constant rather than a literal `1`: `quota_ledger` and
 * `usage_ledger` are append-only and the balance is **derived**, so the cost is the only
 * thing tying a `delta` of `-1` to the `remaining` a consumer is shown. A per-tier or
 * per-mode price would be introduced here, in one place, or not at all.
 */
export const GENERATION_COST = 1;

/**
 * Days of history a trailing daily rate is averaged over (A-16).
 *
 * Seven, so the average covers a whole week: try-on volume is strongly weekly — the
 * weekend is not the Tuesday — and a shorter window projects a month-end overspend from
 * a busy Saturday.
 */
export const TRAILING_WINDOW_DAYS = 7;
