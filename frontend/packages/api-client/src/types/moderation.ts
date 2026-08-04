/**
 * ARCHITECTURE.md §5.17 `moderation` and abuse, §4.29 and §4.8.
 *
 * **Blurred thumbnails only.** `blurredThumbnailKey` is the only image an admin may ever open
 * (A-34, S-10) — there is no field on any type in this file that resolves to a full-resolution
 * person photo. Every read of the list *and* every read of a blurred thumbnail writes
 * `MODERATION_ITEM_VIEWED` to `audit_log` (A-34, §9.3), so the UI must not prefetch these
 * speculatively.
 */

import {
  type IsoDateTime,
  type PaginationQuery,
  type SearchablePaginationQuery,
  type SignedFileUrl,
  type Uuid,
} from './common';
import { type ModerationSource, type ModerationState } from './enums';

/** One row of `GET /admin/moderation` (ADMIN) — the queue of A-34. */
export interface ModerationItem {
  id: Uuid;
  source: ModerationSource;
  /** The upstream code or internal heuristic id. Not consumer-facing copy. */
  reasonCode: string;
  state: ModerationState;
  /** The **only** image an admin may open. Null when no derivative was produced. */
  blurredThumbnail: SignedFileUrl | null;
  /** Present so the queue can group by account; carries no photo (S-10). */
  userId: Uuid | null;
  jobId: Uuid | null;
  reviewedById: Uuid | null;
  reviewedByName: string | null;
  reviewedAt: IsoDateTime | null;
  decisionNote: string | null;
  createdAt: IsoDateTime;
}

export interface ModerationListQuery extends PaginationQuery {
  state?: ModerationState;
  source?: ModerationSource;
  userId?: Uuid;
}

/** `POST /admin/moderation/:itemId/approve` (ADMIN) — releases the photo for generation. */
export interface ApproveModerationItemRequest {
  decisionNote?: string;
}

/**
 * `POST /admin/moderation/:itemId/reject` (ADMIN) — keeps it blocked. The consumer sees the
 * neutral `MODERATION_REJECTED` copy and no detail whatsoever.
 */
export interface RejectModerationItemRequest {
  decisionNote?: string;
}

/** Reviewing an item twice is `MODERATION_ALREADY_REVIEWED`. */
export interface ModerationDecisionResponse {
  id: Uuid;
  state: Exclude<ModerationState, 'PENDING'>;
  reviewedAt: IsoDateTime;
  pendingCount: number;
}

/* --------------------------------------------------------------------- abuse */

/** One row of `GET /admin/abuse` (ADMIN) — accounts hitting rate limits or repeated failures (A-35). */
export interface AbuseSignal {
  userId: Uuid | null;
  userName: string | null;
  userEmail: string | null;
  /** Present when the signal is IP-shaped rather than account-shaped. */
  ip: string | null;
  rateLimitHits: number;
  failedLogins: number;
  failedGenerations: number;
  moderationFlags: number;
  lastSeenAt: IsoDateTime;
  /** True when an `ip_blocks` row already covers this address. */
  blocked: boolean;
}

export interface AbuseListQuery extends SearchablePaginationQuery {
  /** Window in hours; defaults to 24 server-side. */
  windowHours?: number;
}

/** One row of `GET /admin/abuse/ip-blocks` (ADMIN) — §4.8. */
export interface IpBlock {
  id: Uuid;
  cidr: string;
  reason: string;
  createdById: Uuid | null;
  createdByName: string | null;
  /** Null means indefinite. */
  expiresAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** `POST /admin/abuse/ip-blocks` (ADMIN) — A-35. A blocked caller receives `IP_BLOCKED`. */
export interface CreateIpBlockRequest {
  /** A single address or a CIDR range. */
  cidr: string;
  reason: string;
  expiresAt?: IsoDateTime | null;
}
