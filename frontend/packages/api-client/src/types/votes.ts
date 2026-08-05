/**
 * ARCHITECTURE.md §5.14 — the PUBLIC recipient view and voting, and §4.22.
 *
 * These three routes are the only ones a person with no Drape account ever calls. Everything here
 * is deliberately minimal: **renders only, no photo, no contact details, no other renders** (C-33).
 * `POST /share/:token/votes` is throttled hard (10 / 60 s per IP, §5.22).
 */

import type { IsoDateTime, Uuid } from './common';
import type { Reaction } from './enums';

/** One item of the shared view — resolved live from the owner's shortlist (§4.21). */
export interface SharedShortlistItem {
  itemId: Uuid;
  garmentId: Uuid;
  title: string;
  slug: string;
  category: string | null;
  /** Omitted entirely while `catalog.showPricesPublicly` is off (A-30). */
  price: number | null;
  currency: string | null;
  /** Her drag-to-rank position, 1 first. */
  rank: number | null;
  /**
   * Signed, expiring URL for the render thumbnail (§3.4). Never the full render — a `renders/**`
   * URL is scoped to its owner's session, which a recipient does not have.
   */
  renderUrl: string | null;
  /** The reaction this visitor already left on this piece, if any. */
  myReaction: Reaction | null;
  /** The comment this visitor already left. Never another visitor's (recipients cannot see each other's notes). */
  myComment: string | null;
}

/**
 * `GET /share/:token` (PUBLIC) — the recipient view. An unknown, revoked or expired token is all
 * `SHARE_LINK_NOT_FOUND` — there is no way to tell them apart from outside (C-34, S-9).
 */
export interface SharedShortlistView {
  items: SharedShortlistItem[];
  itemCount: number;
  /** When the link stops working (C-34). */
  expiresAt: IsoDateTime;
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
  comment?: string;
}

export interface CastVoteResponse {
  id: Uuid;
  garmentId: Uuid;
  reaction: Reaction;
  comment: string | null;
  createdAt: IsoDateTime;
}

/**
 * `GET /share/:token/votes` (PUBLIC) — the row shape of the reactions already left under this
 * link, **scoped to this visitor's fingerprint** (a flat array, not wrapped), so a recipient sees
 * their own and no one else's.
 */
export interface MyVoteOnShare {
  id: Uuid;
  garmentId: Uuid;
  reaction: Reaction;
  comment: string | null;
  createdAt: IsoDateTime;
}
