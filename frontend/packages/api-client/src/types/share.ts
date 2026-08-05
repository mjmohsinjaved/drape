/**
 * ARCHITECTURE.md §5.14 `share` — the owner's half. The recipient's half is `votes.ts`.
 *
 * §4.21: a share view resolves the owner's **live** shortlist and returns only
 * `{ garment title, category, price if public, render url }` per item. It never returns her photo,
 * her other renders, her name, her contact details, her notes, or any other consumer's data
 * (C-33). There is no snapshot table — revoking the link is the control.
 */

import type { IsoDateTime, Uuid } from './common';
import type { Reaction } from './enums';

/**
 * One of her share links — `GET /share-links`, `POST /share-links` (C-34). A flat array, not
 * paginated.
 */
export interface ShareLink {
  id: Uuid;
  label: string | null;
  /**
   * The full shareable URL, including the token. `share_links.tokenHash` stores a digest, so this
   * is populated **only** on the `POST` response that created the link — every other read gets
   * `null`, because the API could not reproduce it even if asked.
   */
  url: string | null;
  /** Created at now + 30 days (C-34). */
  expiresAt: IsoDateTime;
  revokedAt: IsoDateTime | null;
  /** True while the link still opens: not revoked, not past its expiry. */
  active: boolean;
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
  /** Her own name for the link, so she can tell two of them apart. Never shown to recipients. */
  label?: string;
}

/**
 * Same shape as {@link ShareLink} — `url` (with the raw token) is populated only in this response;
 * copy it now, because it cannot be shown again (§4.21).
 */
export type CreateShareLinkResponse = ShareLink;

/**
 * A reaction, as its own visitor sees it — the row shape of `GET /share-links/:shareLinkId/votes`
 * (CONSUMER), which returns a **flat array**, not grouped by garment.
 */
export interface ShareLinkVote {
  id: Uuid;
  garmentId: Uuid;
  reaction: Reaction;
  comment: string | null;
  createdAt: IsoDateTime;
  /** The name the visitor typed. No account is required to vote (C-33). */
  voterLabel: string;
  garmentTitle: string;
}
