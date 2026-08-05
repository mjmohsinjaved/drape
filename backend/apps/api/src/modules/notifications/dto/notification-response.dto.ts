import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Locale } from '@api/modules/users/enums/locale.enum';

import { NotificationChannel } from '../enums/notification-channel.enum';

/**
 * One in-app notification — PRD A-25 (the in-app half), ARCHITECTURE §4.32.
 *
 * §4.32: "`channel = IN_APP` rows are the in-app notification store — there is no
 * second table." So this DTO is a projection of a `notifications_outbox` row, with
 * two deliberate omissions:
 *
 *  - **no `payload`.** The raw template variables are an internal contract between the
 *    enqueuing module and the copy in `@library/notifications`; handing them to the
 *    browser would let a screen compose its own wording and quietly bypass the §9.4
 *    shortlisting check that the template has already passed.
 *  - **no `recipientAddress`, no `lastError`, no `attempts`.** An address on a response
 *    is an address in a log (E-12), and delivery mechanics are an operator's business.
 *
 * `title` and `body` are rendered from the registry at read time in the caller's
 * locale, so a consumer who switches to Urdu sees her existing notifications in Urdu
 * rather than in whatever locale they were enqueued under.
 */
export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    enum: NotificationChannel,
    enumName: 'NotificationChannel',
    example: NotificationChannel.IN_APP,
    description: 'Always `IN_APP` on this route — the other channels are not a store.',
  })
  channel: NotificationChannel;

  @ApiProperty({
    example: 'RENDER_READY',
    description: 'The `@library/notifications` template id this row was written against.',
  })
  template: string;

  @ApiProperty({ enum: Locale, enumName: 'Locale', example: Locale.EN })
  locale: Locale;

  @ApiProperty({ example: 'Your try-on is ready' })
  title: string;

  @ApiProperty({ example: 'Open it to add it to your shortlist.' })
  body: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Where the notification points, when its template carries an action link.',
  })
  actionUrl: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'Null until she opens it (A-25).',
  })
  readAt: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}

/** The unread badge, and what `POST /me/notifications/read-all` reports back. */
export class NotificationCountResponseDto {
  @ApiProperty({ example: 3, description: 'In-app notifications the caller has not opened.' })
  unread: number;

  @ApiProperty({ example: 12, description: 'In-app notifications she holds in total.' })
  total: number;
}
