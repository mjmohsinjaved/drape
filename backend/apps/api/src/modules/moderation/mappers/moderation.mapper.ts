import { MILLISECONDS_PER_HOUR } from '@library/common';

import type { PhotoModerationState } from '@api/modules/person-photos/enums/photo-moderation-state.enum';

import { IpBlockResponseDto } from '../dto/abuse.dto';
import { ModerationItemResponseDto } from '../dto/moderation-item-response.dto';
import { ModerationState } from '../enums/moderation-state.enum';

import type { IpBlock } from '../entities/ip-block.entity';
import type { ModerationItem } from '../entities/moderation-item.entity';

/**
 * Signs a **blurred** thumbnail key for one admin — §3.4, A-34.
 *
 * Passed in rather than reached for, so the mapper stays a pure function of its inputs
 * and a test can prove what is in the DTO without a storage service. The signature is
 * `(key, adminId)` and never `(key)`: §3.4 makes `sub` required for
 * `thumbnails/person-blurred/**`, and it is the **reviewing admin's** id — a token
 * issued without one would be a token anybody could redeem.
 */
export type SignBlurredThumbnail = (key: string, adminId: string) => string;

/** The subset of `person_photos` the queue is permitted to have loaded. No `storageKey`. */
export interface ModerationPhotoFacts {
  readonly moderationState: PhotoModerationState;
  readonly blurredThumbnailKey: string | null;
}

/**
 * One queue row as an admin sees it (A-34).
 *
 * The thumbnail key comes from `moderation_items.blurredThumbnailKey` first — §4.29
 * calls it "the only image an admin may open" — and falls back to the one recorded on
 * the photograph, which is the same derivative under a different owner. If neither
 * exists the url is `null` and the screen shows a placeholder. It never falls back to
 * the original, because the original is not in `facts` and cannot be (S-10).
 */
export function toModerationItemResponse(
  item: ModerationItem,
  facts: ModerationPhotoFacts | null,
  adminId: string,
  sign: SignBlurredThumbnail,
  now: Date = new Date(),
): ModerationItemResponseDto {
  const key = item.blurredThumbnailKey ?? facts?.blurredThumbnailKey ?? null;

  const dto = new ModerationItemResponseDto();
  dto.id = item.id;
  dto.personPhotoId = item.personPhotoId;
  dto.userId = item.userId;
  dto.jobId = item.jobId;
  dto.source = item.source;
  dto.reasonCode = item.reasonCode;
  dto.state = item.state;
  dto.blurredThumbnailUrl = key === null ? null : sign(key, adminId);
  dto.photoState = facts?.moderationState ?? null;
  dto.reviewedBy = item.reviewedBy;
  dto.reviewedAt = item.reviewedAt;
  dto.decisionNote = item.decisionNote;
  dto.createdAt = item.createdAt;
  dto.waitingHours =
    item.state === ModerationState.PENDING
      ? Math.round(((now.getTime() - item.createdAt.getTime()) / MILLISECONDS_PER_HOUR) * 10) / 10
      : 0;
  return dto;
}

/** One `ip_blocks` row (§4.8). `active` is derived, never stored. */
export function toIpBlockResponse(block: IpBlock, now: Date = new Date()): IpBlockResponseDto {
  const dto = new IpBlockResponseDto();
  dto.id = block.id;
  dto.cidr = block.cidr;
  dto.reason = block.reason;
  dto.createdBy = block.createdBy;
  dto.expiresAt = block.expiresAt;
  dto.active = block.expiresAt === null || block.expiresAt.getTime() > now.getTime();
  dto.createdAt = block.createdAt;
  return dto;
}
