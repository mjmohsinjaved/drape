/**
 * ARCHITECTURE.md §5.14 `share` — the owner's half. The recipient's half is `votes.ts`.
 *
 * §4.21: a share view resolves the owner's **live** shortlist and returns only
 * `{ garment title, category, price if public, render url }` per item. It never returns her photo,
 * her other renders, her name, her contact details, her notes, or any other consumer's data
 * (C-33). There is no snapshot table — revoking the link is the control.
 */

import type { IsoDateTime, SignedFileUrl, Uuid } from './common';
import type { Reaction } from './enums';

/** One row of `GET /share-links` (CONSUMER) — her links with view counts and expiry (C-34). */
export interface ShareLink {
  id: Uuid;
  label: string | null;
  /** The full shareable URL. The raw token is returned only at creation. */
  url: string;
  expiresAt: IsoDateTime;
  revokedAt: IsoDateTime | null;
  viewCount: number;
  lastViewedAt: IsoDateTime | null;
  /** Reactions left under this link, so the list can show "3 replies" without a second call. */
  voteCount: number;
  createdAt: IsoDateTime;
}

/**
 * `POST /share-links` (CONSUMER) — creates a 30-day link. Blocked with `SHARING_DISABLED` when
 * `sharing.enabled` is false (A-30), and `SHORTLIST_EMPTY` when there is nothing to share.
 */
export interface CreateShareLinkRequest {
  label?: string | null;
}

/** The only response that carries the raw token — it is hashed at rest (§4.21). */
export interface CreateShareLinkResponse extends ShareLink {
  token: string;
}

/** `DELETE /share-links/:shareLinkId` (CONSUMER) — revokes immediately (C-34). */
export interface RevokeShareLinkResponse {
  shareLinkId: Uuid;
  revokedAt: IsoDateTime;
}

/** `GET /share-links/:shareLinkId/votes` (CONSUMER) — reactions and comments from her recipients. */
export interface ShareLinkVotesResponse {
  shareLinkId: Uuid;
  items: ShareLinkVoteGroup[];
}

/** Votes grouped by the garment they were left on, so the owner reads them item by item. */
export interface ShareLinkVoteGroup {
  garmentId: Uuid;
  garmentTitle: string;
  thumbnail: SignedFileUrl | null;
  hearts: number;
  unsure: number;
  no: number;
  votes: ShareLinkVote[];
}

export interface ShareLinkVote {
  id: Uuid;
  /** The name the visitor typed. No account is required to vote (C-33). */
  voterLabel: string;
  reaction: Reaction;
  comment: string | null;
  createdAt: IsoDateTime;
}
