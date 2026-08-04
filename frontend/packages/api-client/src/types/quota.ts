/**
 * ARCHITECTURE.md §5.16 `quota` and budget, §4.26 and §4.27.
 *
 * Both ledgers are append-only. **Remaining quota and remaining budget are DERIVED with
 * `SUM(delta)` at read time and are never a stored balance.** Nothing in this file is writable
 * except through an explicit adjustment endpoint, and `balanceAfter` on a usage row is an advisory
 * snapshot for the A-33 burn-rate chart, never an authority.
 */

import {
  type IsoDateTime,
  type LedgerPeriod,
  type PaginationQuery,
  type Uuid,
} from './common';
import { type QuotaReason, type UsageReason } from './enums';

/** `GET /quota/me` (CONSUMER) — the persistent counter of C-5. `staleTime: 0`; it changes on every generation. */
export interface MyQuota {
  period: LedgerPeriod;
  limit: number;
  used: number;
  remaining: number;
  resetsAt: IsoDateTime;
}

/** `GET /admin/usage` (ADMIN) — A-33. */
export interface AdminUsageOverview {
  period: LedgerPeriod;
  /** `settings['budget.monthlyGenerations']` for the period. */
  budget: number;
  generationsThisMonth: number;
  budgetRemaining: number;
  percentConsumed: number;
  /** `settings['budget.warnThresholdPercent']`; the soft warning fires here (A-29, E-14). */
  warnThresholdPercent: number;
  warnThresholdReached: boolean;
  budgetExhausted: boolean;
  /** Mean generations per day over the trailing seven days. */
  sevenDayTrailingRate: number;
  /** Null when the trailing rate is zero, or when the budget will not be exhausted this period. */
  projectedExhaustionAt: IsoDateTime | null;
  split: {
    consumerGenerations: number;
    testRenders: number;
  };
  /** Cache hits write no ledger row, so they are counted separately (C-22, §8.4). */
  cacheHits: number;
  billedCalls: number;
}

export interface AdminUsageQuery {
  period?: LedgerPeriod;
}

/** One row of `GET /admin/usage/ledger` (ADMIN) — paginated `usage_ledger` for reconciliation. */
export interface UsageLedgerEntry {
  id: Uuid;
  delta: number;
  reason: UsageReason;
  period: LedgerPeriod;
  jobId: Uuid | null;
  userId: Uuid | null;
  userName: string | null;
  /** **Advisory snapshot only** (§4.27). Never read it to make a decision. */
  balanceAfter: number;
  actorId: Uuid | null;
  actorName: string | null;
  note: string | null;
  createdAt: IsoDateTime;
}

export interface UsageLedgerQuery extends PaginationQuery {
  period?: LedgerPeriod;
  reason?: UsageReason;
  userId?: Uuid;
}

/** `POST /admin/usage/adjust` (ADMIN) — appends an `ADMIN_ADJUSTMENT` row to the budget ledger. */
export interface AdjustUsageRequest {
  delta: number;
  note: string;
  period?: LedgerPeriod;
}

export type AdjustUsageResponse = UsageLedgerEntry;

/** One row of `GET /admin/consumers/:userId/quota-ledger` (ADMIN) — §4.26. */
export interface QuotaLedgerEntry {
  id: Uuid;
  delta: number;
  reason: QuotaReason;
  period: LedgerPeriod;
  jobId: Uuid | null;
  actorId: Uuid | null;
  actorName: string | null;
  note: string | null;
  createdAt: IsoDateTime;
}

export interface QuotaLedgerQuery extends PaginationQuery {
  period?: LedgerPeriod;
  reason?: QuotaReason;
}

/**
 * `POST /admin/consumers/:userId/quota-adjust` (ADMIN) — A-18. Appends an adjustment; it never
 * rewrites an earlier row. A delta outside the allowed range is `QUOTA_ADJUSTMENT_INVALID`.
 */
export interface AdjustConsumerQuotaRequest {
  delta: number;
  note: string;
  period?: LedgerPeriod;
}

export interface AdjustConsumerQuotaResponse {
  entry: QuotaLedgerEntry;
  quota: MyQuota;
}
