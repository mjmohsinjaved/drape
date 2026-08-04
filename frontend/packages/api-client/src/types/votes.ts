/**
 * ARCHITECTURE.md §5.14 — the PUBLIC recipient view and voting, and §4.22.
 *
 * These three routes are the only ones a person with no Drape account ever calls. Everything here
 * is deliberately minimal: **renders only, no photo, no contact details, no other renders** (C-33).
 * `POST /share/:token/votes` is throttled hard (10 / 60 s per IP, §5.22).
 */

import type { IsoDateTime, Uuid } from './common';
import type { Reaction } from './enums';

/**
 * `GET /share/:token` (PUBLIC) — the recipient view. An unknown, revoked or expired token is
 * `SHARE_LINK_NOT_FOUND`, `SHARE_LINK_REVOKED` or `SHARE_LINK_EXPIRED`.
 */
export interface SharedShortlistView {
  /** The label the owner gave the link ("Ammi", "Sisters"), or null. Never her name (C-33). */
  label: string | null;
  expiresAt: IsoDateTime;
  brandName: string;
  items: SharedShortlistItem[];
}

/** One item of the shared view. Resolved live from the owner's shortlist (§4.21). */
export interface SharedShortlistItem {
  garmentId: Uuid;
  garmentTitle: string;
  categoryName: string;
  /** Null when `catalog.showPricesPublicly` is false (A-30). */
  price: number | null;
  currency: string;
  /** Signed URL for the render. There is no path from this route to her photo. */
  renderUrl: string;
  rank: number;
}

/**
 * `POST /share/:token/votes` (PUBLIC) — react, and leave **one** comment per item. A second
 * comment on the same item by the same visitor is `VOTE_ALREADY_CAST`; changing the reaction
 * updates the existing row (§4.22).
 *
 * The voter fingerprint is derived server-side from a first-party cookie and is never sent by the
 * client.
 */
export interface CastVoteRequest {
  garmentId: Uuid;
  reaction: Reaction;
  /** The name the visitor types. Required once, remembered by the cookie afterwards. */
  voterLabel: string;
  comment?: string | null;
}

export interface CastVoteResponse {
  garmentId: Uuid;
  reaction: Reaction;
  comment: string | null;
  createdAt: IsoDateTime;
}

/**
 * `GET /share/:token/votes` (PUBLIC) — the reactions already left under this link, **scoped to
 * this visitor's fingerprint**, so a recipient sees their own and no one else's.
 */
export interface MyVotesOnShareResponse {
  voterLabel: string | null;
  votes: MyVoteOnShare[];
}

export interface MyVoteOnShare {
  garmentId: Uuid;
  reaction: Reaction;
  comment: string | null;
  createdAt: IsoDateTime;
}
