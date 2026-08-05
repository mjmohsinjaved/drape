import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PhotoModerationState } from '@api/modules/person-photos/enums/photo-moderation-state.enum';

import { ModerationSource } from '../enums/moderation-source.enum';
import { ModerationState } from '../enums/moderation-state.enum';

/**
 * One row of the A-34 queue — ARCHITECTURE §4.29, §5.17.
 *
 * ### What is on this DTO, and what can never be
 *
 * `blurredThumbnailUrl` is a signed URL for
 * `thumbnails/person-blurred/<uuid>-160.webp`, scoped by §3.4 to **the reviewing
 * admin's own id**. There is no field here for the original photograph, and there is
 * no code path that could populate one: the service that builds this DTO selects an
 * explicit column list from `person_photos` that excludes `storageKey`
 * (`MODERATION_PHOTO_COLUMNS`), so the key never reaches memory, let alone a response.
 * S-10 is not a filter applied on the way out — it is a column that was never read.
 *
 * The consumer is identified by `userId` alone. No name, no email, no phone: a
 * moderator is deciding about an image, and A-16 already defines the one screen where
 * an admin may see who a consumer is. A `null` url means the blurred derivative could
 * not be produced at upload time; the screen shows a placeholder and the item is still
 * decidable, because the reason code — not the picture — is what flagged it.
 */
export class ModerationItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  personPhotoId: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'uuid',
    description: 'The account the photograph belongs to. Never her name or contact details.',
  })
  userId: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'uuid',
    description: 'The generation this item blocked, when one is waiting on the decision.',
  })
  jobId: string | null;

  @ApiProperty({ enum: ModerationSource, enumName: 'ModerationSource' })
  source: ModerationSource;

  @ApiProperty({
    example: 'UPSTREAM_NSFW',
    description: 'Upstream code or internal heuristic id (§4.29). Never free text from a consumer.',
  })
  reasonCode: string;

  @ApiProperty({ enum: ModerationState, enumName: 'ModerationState' })
  state: ModerationState;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Signed URL for the **blurred** 160px derivative, scoped to the reviewing admin ' +
      '(§3.4, A-34). Null when no blurred derivative exists. The original is never ' +
      'addressable from this response (S-10).',
  })
  blurredThumbnailUrl: string | null;

  @ApiPropertyOptional({
    enum: PhotoModerationState,
    enumName: 'PhotoModerationState',
    nullable: true,
    description: "The photograph's own state, which an approval or rejection writes through to.",
  })
  photoState: PhotoModerationState | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  reviewedBy: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  reviewedAt: Date | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  decisionNote: string | null;

  @ApiProperty({ format: 'date-time', description: 'When it was flagged — the queue sorts on it.' })
  createdAt: Date;

  @ApiProperty({
    example: 4.5,
    description: 'Hours this item has been waiting. Zero once it has been decided.',
  })
  waitingHours: number;
}
