import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Repository } from 'typeorm';

import {
  ErrorCode,
  NotFoundException,
  paginate,
  paginationSkip,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';
import {
  isTemplateId,
  NotificationsService,
  type NotificationLocale,
  TemplateId,
} from '@library/notifications';

import { Locale } from '@api/modules/users/enums/locale.enum';

import { NotificationCountResponseDto } from '../dto/notification-response.dto';
import { NotificationOutboxEntry } from '../entities/notification-outbox-entry.entity';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { NotificationStatus } from '../enums/notification-status.enum';
import {
  leadLineOf,
  toNotificationResponse,
  type RenderedNotificationCopy,
} from '../mappers/notification.mapper';
import { storedProps } from '../utils/outbox-payload';

import type { NotificationQueryDto } from '../dto/notification-query.dto';
import type { NotificationResponseDto } from '../dto/notification-response.dto';

/**
 * **The in-app half of A-25 — ARCHITECTURE §4.32, §5.2.**
 *
 * > "`channel = IN_APP` rows are the in-app notification store — there is no second
 * > table."
 *
 * So this service is a reader over `notifications_outbox`, narrowed three ways and
 * never fewer:
 *
 *  1. `recipientUserId` = the caller's id, taken from the session and never from the
 *     query string (§9.2). There is no code path here that accepts a user id;
 *  2. `channel = IN_APP`. An email row is a delivery record, not a notification she
 *     holds, and showing her one would show her the mechanics of her own inbox;
 *  3. `status = SENT`. A `PENDING` row has not been delivered yet and a `FAILED` one
 *     never was — neither is something she has been told.
 *
 * ### Copy is rendered at read time, in her locale
 *
 * The row stores template variables, not sentences (§4.32: "template variables only").
 * Rendering on read means a consumer who switches to Urdu sees the notifications she
 * already had in Urdu, and it means the §9.4 shortlisting check applies to every
 * string she reads — because every string she reads came out of the registry, where
 * that check was done.
 */
@Injectable()
export class NotificationsInboxService {
  private readonly logger = new Logger(NotificationsInboxService.name);

  constructor(
    @InjectRepository(NotificationOutboxEntry)
    private readonly outbox: Repository<NotificationOutboxEntry>,
    private readonly notifications: NotificationsService,
  ) {}

  /** `GET /me/notifications` (A-25, §5.2). */
  async list(
    user: ICurrentUser,
    query: NotificationQueryDto,
  ): Promise<IPaginated<NotificationResponseDto>> {
    const [rows, total] = await this.outbox.findAndCount({
      where: {
        recipientUserId: user.id,
        channel: NotificationChannel.IN_APP,
        status: NotificationStatus.SENT,
        ...(query.unreadOnly ? { readAt: IsNull() } : {}),
      },
      // `sortBy` came through `@IsIn(NOTIFICATION_SORT_KEYS)`, so this index is over an
      // allow-listed key and never over client-supplied text (§2.8).
      order: { [query.sortBy]: query.sortOrder, id: query.sortOrder },
      skip: paginationSkip(query),
      take: query.limit,
    });

    const locale = user.locale === Locale.UR ? 'UR' : 'EN';
    const items = rows.map((row) => toNotificationResponse(row, this.copyFor(row, locale)));

    return paginate(items, query, total);
  }

  /** The badge. One `COUNT` each, both indexed by `IDX_notifications_outbox_recipient_read`. */
  async counts(user: ICurrentUser): Promise<NotificationCountResponseDto> {
    const base = {
      recipientUserId: user.id,
      channel: NotificationChannel.IN_APP,
      status: NotificationStatus.SENT,
    } as const;

    const [unread, total] = await Promise.all([
      this.outbox.count({ where: { ...base, readAt: IsNull() } }),
      this.outbox.count({ where: base }),
    ]);

    const dto = new NotificationCountResponseDto();
    dto.unread = unread;
    dto.total = total;
    return dto;
  }

  /**
   * `POST /me/notifications/:notificationId/read`.
   *
   * The ownership predicate is in the `WHERE` clause of the update, not checked after
   * a load, so there is no branch in which another account's row has been written to
   * (§9.2). Marking an already-read notification read again is a no-op rather than a
   * conflict — a double tap is not an error.
   */
  async markRead(user: ICurrentUser, notificationId: string): Promise<NotificationResponseDto> {
    const result = await this.outbox.update(
      {
        id: notificationId,
        recipientUserId: user.id,
        channel: NotificationChannel.IN_APP,
        readAt: IsNull(),
      },
      { readAt: new Date() },
    );

    const row = await this.outbox.findOne({
      where: {
        id: notificationId,
        recipientUserId: user.id,
        channel: NotificationChannel.IN_APP,
      },
    });

    if (row === null) {
      // A `RESOURCE_NOT_FOUND` either way: an id belonging to another account and an
      // id that never existed must be indistinguishable from outside (S-9).
      throw new NotFoundException(ErrorCode.RESOURCE_NOT_FOUND, { details: { notificationId } });
    }

    if ((result.affected ?? 0) === 0) {
      this.logger.debug('Notification was already marked read; nothing to do.');
    }

    const locale = user.locale === Locale.UR ? 'UR' : 'EN';
    return toNotificationResponse(row, this.copyFor(row, locale));
  }

  /** `POST /me/notifications/read-all`. Returns the counts, so the badge settles in one round trip. */
  async markAllRead(user: ICurrentUser): Promise<NotificationCountResponseDto> {
    await this.outbox.update(
      {
        recipientUserId: user.id,
        channel: NotificationChannel.IN_APP,
        status: NotificationStatus.SENT,
        readAt: IsNull(),
      },
      { readAt: new Date() },
    );

    return this.counts(user);
  }

  /**
   * Removes every in-app notification belonging to an account.
   *
   * Called by `retention` on account deletion (C-38): "everything belonging to an
   * account is removed" (§9.3), and a notification addressed to her is hers. A hard
   * delete, not a soft one — a soft-deleted row still holds her `recipientUserId` and
   * her template variables, which is exactly what deletion is supposed to remove.
   */
  async purgeForUser(userId: string): Promise<number> {
    const result = await this.outbox.delete({ recipientUserId: userId });
    return result.affected ?? 0;
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * Renders one row's copy, and never throws.
   *
   * A template that was retired between the enqueue and the read, or a payload that no
   * longer fits it, must not blank a consumer's whole notification list. The row is
   * shown with its template id as the title — visibly wrong, visibly present, and
   * loudly logged — rather than the list failing with a 500.
   */
  private copyFor(
    entry: NotificationOutboxEntry,
    locale: NotificationLocale,
  ): RenderedNotificationCopy {
    if (!isTemplateId(entry.template)) {
      this.logger.error(
        `In-app notification ${entry.id} names template "${entry.template}", which is not in ` +
          'the registry. It is shown untranslated rather than breaking her list.',
      );
      return { title: entry.template, body: '' };
    }

    try {
      const rendered = this.notifications.renderTemplate<TemplateId>({
        template: entry.template,
        props: storedProps(entry.payload),
        locale,
      });
      return { title: rendered.subject, body: leadLineOf(rendered.text, rendered.subject) };
    } catch (error: unknown) {
      this.logger.error(
        `In-app notification ${entry.id} could not be rendered: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return { title: entry.template, body: '' };
    }
  }
}
