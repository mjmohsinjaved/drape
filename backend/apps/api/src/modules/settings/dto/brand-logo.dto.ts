import { ApiProperty } from '@nestjs/swagger';

import { IsString, Matches, MaxLength } from 'class-validator';

/** `brand/<uuid>.<ext>` — the only prefix a brand asset may live under (§3.3). */
const BRAND_KEY_PATTERN = /^brand\/[a-z0-9][a-z0-9\-/]*\.[a-z0-9]{2,5}$/;

/** `storage-key.builder.ts` caps a key at 512 characters. */
const MAX_KEY_LENGTH = 512;

/**
 * `POST /settings/brand/logo` (§5.4) — finalise a brand-asset upload.
 *
 * The bytes never pass through this endpoint. The admin redeems an upload ticket
 * against `PUT /files/upload/:ticket` (§3.5) and then posts the resulting key here;
 * the service confirms the object actually exists under `brand/` before it lets the
 * key into `settings`, so a guessed or forged key sets nothing.
 */
export class SetBrandLogoDto {
  @ApiProperty({
    example: 'brand/0c0a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b.png',
    description: 'The storage key returned by the upload ticket redemption.',
  })
  @IsString()
  @MaxLength(MAX_KEY_LENGTH)
  @Matches(BRAND_KEY_PATTERN, { message: 'A brand asset must live under the brand/ prefix.' })
  key: string;
}
