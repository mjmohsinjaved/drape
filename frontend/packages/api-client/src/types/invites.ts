/**
 * ARCHITECTURE.md §5.3 `invites`.
 *
 * Admin accounts exist only by invitation (S-5). There is no code path where `/auth/signup` can
 * produce `role = ADMIN` (S-4), so this module is the only way a second admin comes into being.
 *
 * Written against `modules/invites/dto/**` and `modules/auth/dto/accept-invite.dto.ts` — the
 * acceptance route is served by an `auth` controller mounted on the `/invites` path.
 */

import type { SessionUser } from './auth';
import type { IsoDateTime, SearchablePaginationQuery, Uuid } from './common';
import type { Locale, Role } from './enums';

/**
 * One row of `GET /invites` (ADMIN).
 *
 * **No token and no token hash.** The raw token lives only as long as it takes to render the
 * email, and the hash is credential-equivalent, so neither is ever sent to a browser. An admin
 * who loses the email uses `POST /invites/:inviteId/resend`, which issues a new one.
 *
 * `invitedBy` is the **id** of the admin who sent it, not a display name — resolving the name is
 * the console's job, not this row's.
 */
export interface InviteListItem {
  id: Uuid;
  email: string;
  role: Role;
  status: InviteStatus;
  expiresAt: IsoDateTime;
  consumedAt: IsoDateTime | null;
  invitedBy: Uuid;
  /** The account created by accepting it. */
  consumedByUserId: Uuid | null;
  createdAt: IsoDateTime;
}

/** Derived server-side from `consumedAt` / `expiresAt` / `deletedAt`; there is no status column (§4.9). */
export const INVITE_STATUSES = ['PENDING', 'CONSUMED', 'EXPIRED', 'REVOKED'] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

/** Sortable columns for `GET /invites` (§2.8). All are real `invites` columns — `status` is not. */
export const INVITE_SORTABLE_COLUMNS = ['createdAt', 'expiresAt', 'email', 'consumedAt'] as const;
export type InviteSortColumn = (typeof INVITE_SORTABLE_COLUMNS)[number];

export interface InviteListQuery extends SearchablePaginationQuery {
  status?: InviteStatus;
  sortBy?: InviteSortColumn;
}

/**
 * `POST /invites` (ADMIN).
 *
 * **There is no `role` field, and there will not be one.** Every invite is `ADMIN`; a role in the
 * payload would be the one place in the system where a request body chooses a privilege level
 * (S-4, S-5).
 */
export interface CreateInviteRequest {
  email: string;
}

/** `POST /invites`, `POST /invites/:inviteId/resend` and `DELETE /invites/:inviteId` (ADMIN). */
export type InviteResponse = InviteListItem;

/**
 * `GET /invites/token/:token` (PUBLIC) — three facts and nothing more: which address, what role,
 * when it lapses. It reveals nothing about who sent it, so there is no `invitedByName`.
 *
 * An invalid, expired or consumed token is `INVITE_NOT_FOUND`, `INVITE_EXPIRED` or
 * `INVITE_ALREADY_CONSUMED`.
 */
export interface InviteTokenPreview {
  email: string;
  role: Role;
  expiresAt: IsoDateTime;
}

/**
 * `POST /invites/token/:token/accept` (PUBLIC). 2FA setup is forced immediately after (S-8).
 *
 * The email and the role come from the invite row — there is no field here that could carry
 * either, which is what makes the escalation impossible rather than merely unlikely (S-4, S-5).
 * The DTO takes `locale` and has no `phone`; the global pipe rejects anything undeclared.
 */
export interface AcceptInviteRequest {
  name: string;
  password: string;
  locale?: Locale;
}

/** Acceptance answers the created admin directly, and signs them in on the same response. */
export type AcceptInviteResponse = SessionUser;
