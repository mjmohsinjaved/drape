import { ApiProperty } from '@nestjs/swagger';

import { IsString, IsUUID, Length, Matches } from 'class-validator';

import { SHARE_TOKEN_BYTES } from '../constants/share.constants';

/** base64url of 32 bytes is exactly 43 characters, with no padding. */
const TOKEN_LENGTH = Math.ceil((SHARE_TOKEN_BYTES * 4) / 3);

/**
 * The `:shareLinkId` parameter of the owner's routes (§5.14).
 *
 * A valid uuid proves nothing about who may revoke the link. `ShareLinksService`
 * re-reads the row and compares `userId` (§9.2).
 */
export class ShareLinkParamDto {
  @ApiProperty({ format: 'uuid', example: '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c' })
  @IsUUID()
  shareLinkId: string;
}

/**
 * The `:token` parameter of the public routes.
 *
 * Shape-validated before it reaches the database — a token of the wrong length or
 * alphabet is not a link that ever existed, and hashing arbitrary user input to probe
 * a unique index is work this endpoint should not do on request. The validation
 * failure and the "no such link" answer are both neutral, so this narrows the surface
 * without opening an oracle.
 */
export class ShareTokenParamDto {
  @ApiProperty({
    minLength: TOKEN_LENGTH,
    maxLength: TOKEN_LENGTH,
    description: 'The opaque link token. 256 bits of CSPRNG output, base64url encoded.',
  })
  @IsString()
  @Length(TOKEN_LENGTH, TOKEN_LENGTH)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'This link isn’t available.' })
  token: string;
}
