import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { MAX_KEY_LENGTH } from '@library/storage';

import { MAX_PHOTO_LABEL_LENGTH } from '../constants/person-photo.constants';

/**
 * `POST /person-photos` — step 3 of the §3.5 upload dance.
 *
 * The client has already asked for an upload ticket, streamed the bytes to
 * `PUT /files/upload/:ticket` and been handed back the key the object now occupies.
 * All it does here is name that key.
 *
 * `key` is validated for **shape** only. Everything that matters about it —
 * that it exists, that it sits under this consumer's own `person-photos/<userId>/`
 * prefix, what its real dimensions, format, byte size and sha256 are — is re-derived
 * server-side from the stored bytes. Nothing the client says about the file is
 * trusted (§3.5 step 3, C-14).
 */
export class CreatePersonPhotoDto {
  @ApiProperty({
    description:
      'The storage key returned by the redeemed upload ticket. Must sit under the ' +
      "caller's own person-photos prefix; ownership is re-checked server-side.",
    example:
      'person-photos/6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c/0c0a1b2c-3d4e-4f50-a617-283940516273.jpg',
    maxLength: MAX_KEY_LENGTH,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_KEY_LENGTH)
  key: string;

  @ApiPropertyOptional({
    description: 'Her own name for this photo, e.g. "daylight" (C-16).',
    maxLength: MAX_PHOTO_LABEL_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PHOTO_LABEL_LENGTH)
  label?: string;

  @ApiPropertyOptional({
    description:
      'Make this the active photo straight away (C-16). Defaults to true for her ' +
      'first photo and false afterwards, so an upload never silently changes which ' +
      'photo her next try-on uses.',
  })
  @IsOptional()
  @IsBoolean()
  activate?: boolean;
}
