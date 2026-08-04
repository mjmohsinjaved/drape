/**
 * ARCHITECTURE.md §5.3 `invites`.
 *
 * Admin accounts exist only by invitation (S-5). There is no code path where `/auth/signup` can
 * produce `role = ADMIN` (S-4), so this module is the only way a second admin comes into being.
 */

import type { IsoDateTime, SearchablePaginationQuery, Uuid } from './common';
import type { Role } from './enums';

/** One row of `GET /invites` (ADMIN) — pending and consumed invites. */
export interface InviteListItem {
  id: Uuid;
  email: string;
  role: Role;
  status: InviteStatus;
  expiresAt: IsoDateTime;
  consumedAt: IsoDateTime | null;
  invitedByName: string;
  consumedByUserId: Uuid | null;
  createdAt: IsoDateTime;
}

/** Derived server-side from `consumedAt` / `expiresAt`; there is no status column (§4.9). */
export const INVITE_STATUSES = ['PENDING', 'CONSUMED', 'EXPIRED', 'REVOKED'] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export interface InviteListQuery extends SearchablePaginationQuery {
  status?: InviteStatus;
  sortBy?: 'createdAt' | 'expiresAt' | 'email';
}

/** `POST /invites` (ADMIN). `role` is always `ADMIN` in V1 (S-5). */
export interface CreateInviteRequest {
  email: string;
  role?: Role;
}

/**
 * `POST /invites` / `POST /invites/:inviteId/resend` (ADMIN). The token itself is emailed and is
 * never returned to the browser — only its hash is stored (§4.9).
 */
export type CreateInviteResponse = InviteListItem;

/**
 * `GET /invites/token/:token` (PUBLIC) — validates the token and returns just enough to render
 * the acceptance form. An invalid, expired or consumed token is `INVITE_NOT_FOUND`,
 * `INVITE_EXPIRED` or `INVITE_ALREADY_CONSUMED`.
 */
export interface InviteTokenPreview {
  email: string;
  role: Role;
  expiresAt: IsoDateTime;
  invitedByName: string;
}

/** `POST /invites/token/:token/accept` (PUBLIC). 2FA setup is forced immediately after (S-8). */
export interface AcceptInviteRequest {
  name: string;
  password: string;
  phone?: string;
}

export interface AcceptInviteResponse {
  userId: Uuid;
  email: string;
  role: Role;
  /** Always true for an admin: S-8 makes 2FA mandatory before the account is usable. */
  twofaSetupRequired: boolean;
}
