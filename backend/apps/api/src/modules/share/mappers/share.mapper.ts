import { ShareLinkResponseDto } from '../dto/share-link-response.dto';
import { SharedGarmentDto } from '../dto/shared-shortlist-response.dto';
import { ShareLinkVoteDto, VoteResponseDto } from '../dto/vote-response.dto';

import type { ShareLink } from '../entities/share-link.entity';
import type { Vote } from '../entities/vote.entity';
import type { SharedShortlistRow } from '../queries/public-share.scope';

/** Issues a signed, expiring URL for a storage key (§3.4). */
export type SignThumbnailUrl = (storageKey: string) => string;

/** Everything the recipient projection needs that is not on the raw row. */
export interface SharedGarmentContext {
  /** A-30 `catalog.showPricesPublicly`. False hides price *and* currency entirely. */
  readonly showPrices: boolean;
  readonly sign: SignThumbnailUrl;
  /** The reaction this visitor already left on this piece, if any. Never another's. */
  readonly ownVote: Vote | undefined;
}

/**
 * A raw share row → the recipient DTO (C-33, §4.21).
 *
 * The input type is `SharedShortlistRow`, which is the exact set of columns the share
 * query selects. There is no photo, no full render and no owner on it — so this
 * function could not leak one if it tried, which is the property worth having in the
 * one mapper that serves people with no account.
 *
 * `getRawMany` hands `decimal` back as a string, so the price is parsed here rather
 * than trusted; a `null` price stays `null` rather than becoming `0`, because a piece
 * with no price is not a free one.
 */
export function toSharedGarment(
  row: SharedShortlistRow,
  context: SharedGarmentContext,
): SharedGarmentDto {
  const dto = new SharedGarmentDto();

  dto.itemId = row.itemId;
  dto.garmentId = row.garmentId;
  dto.title = row.garmentTitle;
  dto.slug = row.garmentSlug;
  dto.category = row.categoryName;
  // A-30: while prices are hidden they are absent, not zero and not "—". A currency
  // on its own would still tell a recipient what the studio deals in.
  dto.price = context.showPrices && row.garmentPrice !== null ? Number(row.garmentPrice) : null;
  dto.currency = context.showPrices ? row.garmentCurrency : null;
  dto.rank = row.rank;
  dto.renderUrl = row.renderThumbnailKey === null ? null : context.sign(row.renderThumbnailKey);
  dto.myReaction = context.ownVote?.reaction ?? null;
  dto.myComment = context.ownVote?.comment ?? null;

  return dto;
}

/** Everything the owner's link projection needs that is not on the row. */
export interface ShareLinkContext {
  /** The full URL. Present only in the response that created the link. */
  readonly url: string | null;
  readonly voteCount: number;
  readonly now: Date;
}

/** `share_links` row → the owner's §5.14 view (C-34). */
export function toShareLinkResponse(
  link: ShareLink,
  context: ShareLinkContext,
): ShareLinkResponseDto {
  const dto = new ShareLinkResponseDto();

  dto.id = link.id;
  dto.label = link.label;
  dto.url = context.url;
  dto.expiresAt = link.expiresAt;
  dto.revokedAt = link.revokedAt;
  dto.active = isLinkActive(link, context.now);
  dto.viewCount = link.viewCount;
  dto.lastViewedAt = link.lastViewedAt;
  dto.voteCount = context.voteCount;
  dto.createdAt = link.createdAt;

  return dto;
}

/**
 * Whether a link still opens.
 *
 * The owner is told which of revoked and expired applies, because it is her link and
 * she needs to know whether to revoke or to reissue. A *recipient* is told neither —
 * `PublicShareService` answers `SHARE_LINK_NOT_FOUND` for revoked, expired and never
 * existed alike, so a guessed token learns nothing from the difference (C-34, S-9).
 */
export function isLinkActive(link: ShareLink, now: Date): boolean {
  // `== null` covers both: a loaded row has `null`, an instance that has just been
  // created and not yet reloaded has no value for the column at all.
  return (
    link.deletedAt == null && link.revokedAt == null && link.expiresAt.getTime() > now.getTime()
  );
}

/** A vote as its own author sees it. */
export function toVoteResponse(vote: Vote): VoteResponseDto {
  const dto = new VoteResponseDto();
  dto.id = vote.id;
  dto.garmentId = vote.garmentId;
  dto.reaction = vote.reaction;
  dto.comment = vote.comment;
  dto.createdAt = vote.createdAt;
  return dto;
}

/** A vote as the owner sees it: with the visitor's label and the piece it is about. */
export function toShareLinkVote(vote: Vote, garmentTitle: string): ShareLinkVoteDto {
  const dto = new ShareLinkVoteDto();
  dto.id = vote.id;
  dto.garmentId = vote.garmentId;
  dto.reaction = vote.reaction;
  dto.comment = vote.comment;
  dto.createdAt = vote.createdAt;
  dto.voterLabel = vote.voterLabel;
  dto.garmentTitle = garmentTitle;
  return dto;
}
