/**
 * ARCHITECTURE.md §5.17 `moderation` and abuse, §4.29 and §4.8.
 *
 * **Blurred thumbnails only.** `blurredThumbnailUrl` is the only image an admin may ever open
 * (A-34, S-10) — there is no field on any type in this file that resolves to a full-resolution
 * person photo. Every read of the list *and* every read of a blurred thumbnail writes
 * `MODERATION_ITEM_VIEWED` to `audit_log` (A-34, §9.3), so the UI must not prefetch these
 * speculatively.
 */

import type { IsoDateTime, PaginationQuery, Uuid } from './common';
import type {
  ModerationSource,
  ModerationState,
  PhotoModerationState,
} from './enums';

/** One row of `GET /admin/moderation` (ADMIN) — the queue of A-34. Also `GET .../:itemId` and the
 * `approve`/`reject` decision responses — all four routes share this one shape. */
export interface ModerationItem {
  id: Uuid;
  personPhotoId: Uuid | null;
  /** The account the photograph belongs to. Never her name or contact details. */
  userId: Uuid | null;
  /** The generation this item blocked, when one is waiting on the decision. */
  jobId: Uuid | null;
  source: ModerationSource;
  /** The upstream code or internal heuristic id. Not consumer-facing copy. */
  reasonCode: string;
  state: ModerationState;
  /** The **only** image an admin may open. Null when no derivative was produced. */
  blurredThumbnailUrl: string | null;
  /** The photograph's own state, which an approval or rejection writes through to. */
  photoState: PhotoModerationState | null;
  reviewedBy: Uuid | null;
  reviewedAt: IsoDateTime | null;
  decisionNote: string | null;
  createdAt: IsoDateTime;
  /** Hours this item has been waiting. Zero once it has been decided. */
  waitingHours: number;
}

/** `GET /admin/moderation` — oldest first by default (A-34, E-14). */
export interface ModerationListQuery extends PaginationQuery {
  sortBy?: 'createdAt' | 'reviewedAt' | 'state';
  /** Defaults to `PENDING` — the work queue. Pass a state to review past decisions. */
  state?: ModerationState;
  source?: ModerationSource;
}

/** `POST /admin/moderation/:itemId/approve` (ADMIN) — releases the photo for generation. */
export interface ApproveModerationItemRequest {
  /** Internal. Stored on the item and in the audit row; never shown to the consumer. */
  note?: string;
}

/**
 * `POST /admin/moderation/:itemId/reject` (ADMIN) — keeps it blocked. The consumer sees the
 * neutral `MODERATION_REJECTED` copy and no detail whatsoever.
 */
export interface RejectModerationItemRequest {
  note?: string;
}

/* --------------------------------------------------------------------- abuse */

/** `GET /admin/abuse` (ADMIN) — the whole window; not paginated. */
export interface AbuseListQuery {
  /** Window in hours, 1–168; defaults to 24 server-side. */
  windowHours?: number;
}

/**
 * One account on the A-35 list. Identified by `userId` alone — `auth_attempts` stores an
 * `emailHash` rather than an address precisely so this screen cannot leak one (§4.7, E-12).
 */
export interface AbuseAccount {
  /** Null when the failures never resolved to an account — a probe, not a consumer. */
  userId: Uuid | null;
  /** Failed authentication attempts in the window (§4.7). */
  authFailures: number;
  /** Failed generations in the window (§4.17). */
  generationFailures: number;
  /** Distinct source addresses the failures came from. A spread suggests a script. */
  distinctIps: number;
  lastFailureAt: IsoDateTime;
  /** Whether the account is already suspended (A-19). Suspension itself is `users`. */
  suspended: boolean;
}

/** `GET /admin/abuse` (ADMIN) — accounts hitting rate limits or repeated failures (A-35). */
export interface AbuseOverview {
  windowHours: number;
  windowStartedAt: IsoDateTime;
  accounts: AbuseAccount[];
  /** Failed authentication attempts across the platform in the window (E-14). */
  totalAuthFailures: number;
  /** Active IP or CIDR blocks (§4.8). */
  activeBlocks: number;
}

/** One row of `GET /admin/abuse/ip-blocks` (ADMIN) — §4.8. */
export interface IpBlock {
  id: Uuid;
  cidr: string;
  reason: string;
  createdBy: Uuid | null;
  /** Null means indefinite. */
  expiresAt: IsoDateTime | null;
  /** False once `expiresAt` has passed. Expired blocks are returned, not hidden. */
  active: boolean;
  createdAt: IsoDateTime;
}

/** `POST /admin/abuse/ip-blocks` (ADMIN) — A-35. A blocked caller receives `IP_BLOCKED`. */
export interface CreateIpBlockRequest {
  /** A single address or a CIDR range. */
  cidr: string;
  reason: string;
  expiresAt?: IsoDateTime;
}
