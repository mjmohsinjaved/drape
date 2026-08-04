/**
 * Query and payload shapes shared by more than one module in ARCHITECTURE.md §5.
 * Anything used by exactly one module lives in that module's file instead.
 */

import type { SortOrder } from './envelope';

/**
 * §2.8 `PaginationQueryDto`. Every list endpoint accepts these four. Defaults are applied by the
 * API (`page: 1`, `limit: 20`, `sortBy: 'createdAt'`, `sortOrder: 'DESC'`), so the client omits
 * what it does not care about.
 *
 * `sortBy` is narrowed per module against an allow-list before it reaches the query builder — each
 * module's own query type overrides it with a literal union.
 */
export interface PaginationQuery {
  page?: number;
  /** 1–100. The API rejects anything larger. */
  limit?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
}

/** Pagination plus the free-text `search` most list endpoints add. */
export interface SearchablePaginationQuery extends PaginationQuery {
  search?: string;
}

/** A closed date window, both bounds ISO-8601. Used by audit, analytics and enquiry exports. */
export interface DateRangeQuery {
  from?: string;
  to?: string;
}

/** An ISO-8601 instant. Every timestamp on the wire is `timestamptz` serialised to a string. */
export type IsoDateTime = string;

/** A true calendar date, `YYYY-MM-DD`. Only `eventDate` fields use this (§4.0 rule 2). */
export type IsoDate = string;

/** A ledger period, `YYYY-MM` in `Asia/Karachi` (§4.26). */
export type LedgerPeriod = string;

/** A UUID v4 primary key (§4.0 rule 1). */
export type Uuid = string;

/**
 * A short-lived signed URL for a stored object (§3.4). Never a storage key — the client never
 * sees one — and never valid for longer than the TTL for its class of file.
 */
export interface SignedFileUrl {
  url: string;
  expiresAt: IsoDateTime;
}

/** Money as the API serialises it: a `decimal(18,2)` and its `char(3)` currency (§4.0 rule 5). */
export interface Money {
  amount: number;
  currency: string;
}

/** §2.4 `BULK_OPERATION_PARTIAL_FAILURE` — the per-item outcome the UI renders (D-16). */
export interface BulkItemResult {
  id: Uuid;
  success: boolean;
  errorCode?: string;
  message?: string;
}

export interface BulkOperationResult {
  requested: number;
  succeeded: number;
  failed: number;
  results: BulkItemResult[];
}

/** A generic acknowledgement for endpoints whose only payload is "it worked". */
export interface AcknowledgementResponse {
  acknowledged: true;
}

/** §4.13 / §4.14 — one A-10 image quality check and its remediation string. */
export interface QualityCheckResult {
  check: string;
  passed: boolean;
  score?: number;
  /** Already user-safe copy telling the admin what to fix. */
  remediation?: string;
}
