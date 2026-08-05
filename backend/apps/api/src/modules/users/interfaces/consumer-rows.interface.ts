import type { ConsumerProfile } from '../entities/consumer-profile.entity';
import type { User } from '../entities/user.entity';

/**
 * The row shapes `ConsumerQueryService` returns.
 *
 * They live in their own file so the mappers can name them without importing the
 * service, and the service never imports a mapper — `import/no-cycle` stays quiet
 * and the dependency runs one way: query → row → mapper → DTO.
 *
 * These are **partial** entities by construction. Every admin-facing query selects
 * an explicit column allow-list (`consumer-visibility.constant.ts`), so the fields
 * these rows do not mention were never read out of the database.
 */

/** The three A-16 counts, derived per page rather than stored. */
export interface ConsumerAggregates {
  /** `SUM(-delta)` over `quota_ledger` for the current period, `GENERATION_CONSUMED` only. */
  readonly generationsThisMonth: number;
  /** Loves and maybes. `NOT_FOR_ME` is excluded (§4.20). */
  readonly shortlistSize: number;
  readonly enquiryCount: number;
}

/** One consumer in the A-16 list: the account row plus its derived counts. */
export interface ConsumerListRow {
  readonly user: User;
  readonly aggregates: ConsumerAggregates;
}

/** Everything `GET /admin/consumers/:userId` needs (A-17). */
export interface ConsumerDetailRow {
  readonly user: User;
  /** Null when she has never been prompted for the C-2 fields. */
  readonly profile: ConsumerProfile | null;
  readonly aggregates: ConsumerAggregates;
  readonly enquiries: readonly ConsumerEnquiryRow[];
}

/** One enquiry in the A-17 history. */
export interface ConsumerEnquiryRow {
  readonly id: string;
  readonly reference: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly firstRespondedAt: Date | null;
  readonly closedAt: Date | null;
  readonly totalValueSnapshot: number | null;
}

/**
 * One render an admin may see (S-10).
 *
 * `storageKey` and `thumbnailKey` are on this row because the mapper needs them to
 * mint a signed URL — and they stop here. §3.4: "a storage key must never cross the
 * network boundary", so no response DTO in this module has a field for one.
 */
export interface AdminRenderRow {
  readonly id: string;
  readonly createdAt: Date;
  readonly storageKey: string;
  readonly thumbnailKey: string | null;
  readonly garmentTitleSnapshot: string;
  readonly garmentCategorySnapshot: string;
  readonly garmentPriceSnapshot: number | null;
  readonly garmentCurrencySnapshot: string;
  readonly width: number;
  readonly height: number;
  /** The enquiry that authorises this render to be visible at all (§4.24). */
  readonly enquiryId: string;
  readonly enquiryReference: string;
}

/** One shortlisted garment as an admin sees it (A-17). No render, by design. */
export interface AdminShortlistRow {
  readonly id: string;
  readonly garmentId: string;
  readonly verdict: string;
  readonly rank: number | null;
  readonly note: string | null;
  readonly verdictAt: Date;
  readonly garmentTitle: string;
  readonly garmentSku: string;
  readonly garmentPrice: number | null;
  readonly garmentCurrency: string;
}
