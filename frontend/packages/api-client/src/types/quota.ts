/**
 * ARCHITECTURE.md §5.16 `quota` and budget, §4.26 and §4.27.
 *
 * Both ledgers are append-only. **Remaining quota and remaining budget are DERIVED with
 * `SUM(delta)` at read time and are never a stored balance.** Nothing in this file is writable
 * except through an explicit adjustment endpoint, and `balanceAfter` on a usage row is an advisory
 * snapshot for the A-33 burn-rate chart, never an authority.
 */

import type {
  IsoDateTime,
  LedgerPeriod,
  PaginationQuery,
  Uuid,
} from './common';
import type { QuotaReason, UsageReason } from './enums';

/**
 * `budget_snapshot` isn't in the closed §4.1 enum registry (it's computed, not stored) — declared
 * locally, matching `BudgetSnapshotResponseDto.state`.
 */
export const BUDGET_STATES = ['OK', 'WARNING', 'EXHAUSTED'] as const;
export type BudgetState = (typeof BUDGET_STATES)[number];

/** The system-wide monthly budget (A-29, §4.27) — what the try-on guard chain acts on. */
export interface BudgetSnapshot {
  period: LedgerPeriod;
  /** `budget.monthlyGenerations` (A-29). */
  limit: number;
  used: number;
  /** `SUM(delta)` — never a stored column. */
  remaining: number;
  /** Percent consumed, one decimal place. */
  percentUsed: number;
  /** The soft warning threshold (A-29, E-14). */
  warnAt: number;
  /** The hard stop (A-29). */
  hardStopAt: number;
  state: BudgetState;
  resetsAt: IsoDateTime;
}

/** `GET /quota/me` (CONSUMER) — the persistent counter of C-5. `staleTime: 0`; it changes on every generation. */
export interface MyQuota {
  period: LedgerPeriod;
  limit: number;
  used: number;
  remaining: number;
  resetsAt: IsoDateTime;
}

/**
 * `GET /admin/usage` (ADMIN) — A-33. Everything is derived from `usage_ledger` by summing.
 * **No query parameters** — there is exactly one live period.
 */
export interface AdminUsageOverview {
  budget: BudgetSnapshot;
  /** Consumer try-ons charged this period (A-33). */
  consumerGenerations: number;
  /** Admin test renders charged this period (A-33). */
  testRenders: number;
  /** Generations per day over the trailing 7 days (A-33). */
  trailingDailyRate: number;
  /** Null when the rate is zero or the budget lasts past the period boundary (A-33). */
  projectedExhaustionAt: IsoDateTime | null;
}

/** One row of `GET /admin/usage/ledger` (ADMIN) — paginated `usage_ledger` for reconciliation. */
export interface UsageLedgerEntry {
  id: Uuid;
  delta: number;
  reason: UsageReason;
  period: LedgerPeriod;
  jobId: Uuid | null;
  userId: Uuid | null;
  actorId: Uuid | null;
  /** **Advisory snapshot only** (§4.27). Never read it to make a decision. */
  balanceAfter: number;
  note: string | null;
  createdAt: IsoDateTime;
}

/** Shared by `GET /admin/usage/ledger` and `GET /admin/consumers/:userId/quota-ledger` (§5.16). */
export interface UsageLedgerQuery extends PaginationQuery {
  sortBy?: 'createdAt' | 'delta' | 'period';
  /** `YYYY-MM`. Defaults to the current period in `TIMEZONE` (§4.26). */
  period?: LedgerPeriod;
}

/**
 * `POST /admin/usage/adjust` (ADMIN) — appends an `ADMIN_ADJUSTMENT` row to the budget ledger.
 * **A delta, never a target** (§2.1) — correcting a balance means appending a compensating row.
 */
export interface AdjustUsageRequest {
  /** −1000..1000, never 0. */
  delta: number;
  note?: string;
}

/** The adjustment lands immediately; the response is the recomputed budget, not the ledger row. */
export type AdjustUsageResponse = BudgetSnapshot;

/** One row of `GET /admin/consumers/:userId/quota-ledger` (ADMIN) — §4.26. */
export interface QuotaLedgerEntry {
  id: Uuid;
  delta: number;
  reason: QuotaReason;
  period: LedgerPeriod;
  jobId: Uuid | null;
  actorId: Uuid | null;
  note: string | null;
  createdAt: IsoDateTime;
}

export interface QuotaLedgerQuery extends PaginationQuery {
  sortBy?: 'createdAt' | 'delta' | 'period';
  period?: LedgerPeriod;
}

/**
 * `POST /admin/consumers/:userId/quota-adjust` (ADMIN) — A-18. Appends an adjustment; it never
 * rewrites an earlier row. A delta outside the allowed range is `QUOTA_ADJUSTMENT_INVALID`.
 */
export interface AdjustConsumerQuotaRequest {
  /** −1000..1000, never 0. */
  delta: number;
  note?: string;
}

/** The adjustment lands immediately; the response is her recomputed quota, not the ledger row. */
export type AdjustConsumerQuotaResponse = MyQuota;
