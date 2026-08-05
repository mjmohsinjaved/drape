import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsBoolean } from 'class-validator';

/** `PUT /settings/preview` — turn preview mode on or off for the calling admin (A-31). */
export class SetPreviewModeDto {
  @ApiProperty({
    description: 'True to view the consumer experience without spending generations.',
  })
  @IsBoolean()
  enabled: boolean;
}

/**
 * A-31 preview mode, as the admin screen and the W3 try-on path both read it.
 *
 * Scoped to **one admin**, not to the platform: turning it on must not change what a
 * consumer sees, and two admins must be able to disagree about whether they are
 * previewing. It is therefore session-lifetime state, not a `settings` row — the
 * registry in `settings-keys.constant.ts` is closed and correctly has no key for it.
 */
export class PreviewModeResponseDto {
  @ApiProperty()
  enabled: boolean;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description: 'When the flag lapses on its own. Null when preview mode is off.',
  })
  expiresAt: Date | null;
}
