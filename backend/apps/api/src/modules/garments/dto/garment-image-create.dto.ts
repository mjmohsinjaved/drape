import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/** `storage-key.builder.ts` caps a key at 512 characters. */
const MAX_KEY_LENGTH = 512;

/** D-20 alt text — `garment_images.altText` is `varchar(255)` (§4.14). */
const MAX_ALT_TEXT_LENGTH = 255;

/** A gallery of more than this is a data-entry accident, not a catalogue. */
export const MAX_GALLERY_IMAGES = 60;

/**
 * `POST /admin/garments/:garmentId/images` — ARCHITECTURE §5.7, PRD A-9.
 *
 * The bytes are already in storage: the admin redeemed an upload ticket against
 * `PUT /files/upload/:ticket` (§3.5 step 2) and this is step 3, the finalise. Per-file progress
 * is a client concern (A-9), and it works because this endpoint takes **one** image — the
 * browser fires as many independent requests as there are files and renders a bar for each.
 *
 * `key` is the only thing the client may say about the object, and the service checks it names a
 * real object under this garment's own prefix before it writes a row. Width, height, byte size,
 * MIME type and hash are all measured server-side from the stored bytes; nothing the client
 * claims about the file is believed (§3.2 requirement 9).
 */
export class CreateGarmentImageDto {
  @ApiProperty({
    example:
      'garments/6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c/0c0a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b.jpg',
    description: 'The key returned by the upload-ticket redemption (§3.5 step 3).',
  })
  @IsString()
  @MaxLength(MAX_KEY_LENGTH)
  key: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Make this the try-on source — the file sent upstream as `garment_image` (A-9). Refused ' +
      'when the garment already has one; use POST /admin/garment-images/:imageId/tryon-source ' +
      'to replace it, so demoting the current source is always a deliberate act.',
  })
  @IsOptional()
  @IsBoolean()
  isTryOnSource?: boolean;

  @ApiPropertyOptional({
    maxLength: MAX_ALT_TEXT_LENGTH,
    description: 'Alt text for the catalog image (D-20). Describes the piece, not the photograph.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ALT_TEXT_LENGTH)
  altText?: string;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Gallery position. Defaults to the end of the gallery.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

/** `PATCH /admin/garment-images/:imageId` — alt text and position only (§5.7). */
export class UpdateGarmentImageDto {
  @ApiPropertyOptional({ maxLength: MAX_ALT_TEXT_LENGTH, nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ALT_TEXT_LENGTH)
  altText?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

/**
 * `POST /admin/garments/:garmentId/images/reorder` — persist gallery order (§5.7, A-9).
 *
 * The whole ordering, not a delta. A partial list would leave the unmentioned images at
 * positions that collide with the new ones, and "which of these two is third" is not a question
 * the catalog grid should have to answer. The service rejects a list that is not exactly the
 * garment's current image set.
 */
export class ReorderGarmentImagesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Every image id of this garment, in the order they should appear.',
  })
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(MAX_GALLERY_IMAGES)
  @IsUUID('4', { each: true })
  imageIds: string[];
}
