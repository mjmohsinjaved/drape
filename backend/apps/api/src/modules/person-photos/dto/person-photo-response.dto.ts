import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PhotoModerationState } from '../enums/photo-moderation-state.enum';

/**
 * One `person_photos` row, as its owner sees it (§4.16, §5.9).
 *
 * **There is no `storageKey` on this DTO, no `blurredThumbnailKey`, and no `hash`.**
 * §3.4: "A storage key must never cross the network boundary." What crosses is `url`,
 * already signed, already scoped to the owning user with `sub`, and already expiring
 * after 300 seconds. The hash is the §3.7 cache input and tells a client nothing it
 * can act on.
 *
 * There is also no admin-facing variant of this DTO, and no admin route that could
 * return one. That is S-10, and the absence is the enforcement.
 */
export class PersonPhotoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    description:
      'Signed, expiring URL scoped to the owning user (§3.4, TTL 300s). Another ' +
      "account's session cannot redeem it.",
  })
  url: string;

  @ApiProperty({ description: 'C-16 — exactly one of a consumer’s photos is active.' })
  isActive: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'daylight' })
  label: string | null;

  @ApiProperty({ enum: PhotoModerationState, enumName: 'PhotoModerationState' })
  moderationState: PhotoModerationState;

  @ApiProperty()
  width: number;

  @ApiProperty()
  height: number;

  @ApiProperty()
  byteSize: number;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType: string;

  @ApiProperty({ format: 'date-time' })
  uploadedAt: Date;

  @ApiProperty({
    format: 'date-time',
    description: 'When the §9.3 purge removes it — 30 days after the account was last active.',
  })
  purgeAfter: Date;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}
