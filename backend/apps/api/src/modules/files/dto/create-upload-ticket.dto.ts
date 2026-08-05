import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

import { ALLOWED_UPLOAD_MIME_TYPES } from '@library/storage';

import { UploadPurpose } from '../enums/upload-purpose.enum';

/**
 * `POST /api/v1/files/upload-ticket` — ARCHITECTURE §3.5 step 1.
 *
 * The client declares **what it is about to upload**, never where it should go: there is no
 * `key` field and no `filename` field on this DTO by design. The server builds the key from the
 * purpose and the owner (§3.3), so a client cannot choose a prefix, cannot overwrite an existing
 * object, and cannot smuggle a path through a filename.
 *
 * `byteSize` is a *request*, not a promise. It lets the server hand back a ticket sized to the
 * file so an oversized upload is refused before a byte moves — but the ceiling on the ticket is
 * the lower of this and the purpose's limit, and the redemption enforces it again while
 * streaming (§3.5 step 2).
 */
export class CreateUploadTicketDto {
  @ApiProperty({ enum: UploadPurpose, enumName: 'UploadPurpose' })
  @IsEnum(UploadPurpose)
  purpose: UploadPurpose;

  @ApiProperty({
    enum: ALLOWED_UPLOAD_MIME_TYPES,
    example: 'image/jpeg',
    description:
      'The container format the client intends to send. Checked against the magic bytes on ' +
      'redemption — a mismatch is refused (§3.2 requirement 9).',
  })
  @IsIn([...ALLOWED_UPLOAD_MIME_TYPES])
  contentType: string;

  @ApiProperty({
    minimum: 1,
    example: 2_400_000,
    description: 'Intended size in bytes. The issued ceiling is the lower of this and the limit.',
  })
  @IsInt()
  @Min(1)
  byteSize: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The garment or category the object belongs to. Required for GARMENT_IMAGE and ' +
      'CATEGORY_COVER, ignored for PERSON_PHOTO — a person photo is always filed under the ' +
      "caller's own id (PRD §9.2).",
  })
  @IsOptional()
  @IsUUID()
  ownerId?: string;
}
