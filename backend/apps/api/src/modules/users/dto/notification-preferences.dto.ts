import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsBoolean, IsOptional } from 'class-validator';

import type { NotificationPreferences } from '../entities/consumer-profile.entity';

/**
 * The C-7 defaults, applied when `consumer_profiles.notificationPreferences` is the
 * empty `jsonb` object the column defaults to.
 *
 * Marketing is **off** by default and the two transactional ones are on. That is a
 * consent decision, not a product preference: `emailOnNewArrivals` is promotional,
 * and defaulting a promotional channel to on is opt-out marketing.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: Readonly<NotificationPreferences> = {
  emailOnResultReady: true,
  emailOnEnquiryUpdate: true,
  emailOnNewArrivals: false,
  smsOnEnquiryUpdate: false,
};

/** `GET /me/notification-preferences` (C-7). */
export class NotificationPreferencesResponseDto implements NotificationPreferences {
  @ApiProperty({ description: 'Email when a try-on finishes (C-19).' })
  emailOnResultReady: boolean;

  @ApiProperty({ description: 'Email when an enquiry changes status.' })
  emailOnEnquiryUpdate: boolean;

  @ApiProperty({ description: 'Promotional. Off unless explicitly turned on.' })
  emailOnNewArrivals: boolean;

  @ApiProperty({ description: 'SMS when an enquiry changes status.' })
  smsOnEnquiryUpdate: boolean;
}

/**
 * `PATCH /me/notification-preferences` (C-7).
 *
 * Every field is optional and only the ones present are written, so a client that
 * knows about three toggles cannot silently reset a fourth it has never heard of.
 */
export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailOnResultReady?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailOnEnquiryUpdate?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailOnNewArrivals?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  smsOnEnquiryUpdate?: boolean;
}
