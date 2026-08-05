import { ApiProperty } from '@nestjs/swagger';

import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * `base64url(payload).base64url(signature)` — ARCHITECTURE §3.4 / §3.5.
 *
 * The pattern is the first of several gates, not the important one: it costs nothing and it
 * turns a token shaped like `../../etc/passwd` into a 400 before any service sees it. What
 * actually protects the store is that the payload is HMAC-verified, the key inside it is
 * re-validated against `isValidStorageKey`, and the driver resolves every path against the root
 * and refuses anything that escapes (§3.2 requirements 2 and 3).
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** `splitToken` in `SignedUrlService` refuses anything longer. */
const MAX_TOKEN_LENGTH = 4096;

export class FileTokenParamDto {
  @ApiProperty({ description: 'An opaque, short-lived, HMAC-signed download token (§3.4).' })
  @IsString()
  @MinLength(3)
  @MaxLength(MAX_TOKEN_LENGTH)
  @Matches(TOKEN_PATTERN, { message: 'That link isn’t valid.' })
  token: string;
}

export class UploadTicketParamDto {
  @ApiProperty({ description: 'An opaque, short-lived, HMAC-signed upload ticket (§3.5).' })
  @IsString()
  @MinLength(3)
  @MaxLength(MAX_TOKEN_LENGTH)
  @Matches(TOKEN_PATTERN, { message: 'That upload link isn’t valid. Start the upload again.' })
  ticket: string;
}
