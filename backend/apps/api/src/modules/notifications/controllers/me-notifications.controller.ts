import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardResponses,
  CurrentUser,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';

import { NotificationIdParamDto, NotificationQueryDto } from '../dto/notification-query.dto';
import {
  NotificationCountResponseDto,
  NotificationResponseDto,
} from '../dto/notification-response.dto';
import { NotificationsInboxService } from '../services/notifications-inbox.service';

/**
 * The in-app notification store — PRD A-25, ARCHITECTURE §5.2, §4.32.
 *
 * **Every handler is `@Roles(Role.ADMIN, Role.CONSUMER)`** — `ANY` in the §5.2 table.
 * Both roles receive notifications: a consumer hears that her render is ready, an
 * operator hears that the budget is spent.
 *
 * There is no admin route here and there must not be one. A notification is addressed
 * to an account, the account is resolved from the session, and there is no parameter
 * on any of these routes that names a user. That is what keeps an operator out of a
 * consumer's inbox (S-10, §9.2) — not a check, but the absence of anything to check.
 */
@ApiTags('Notifications')
@Controller('me/notifications')
export class MeNotificationsController {
  constructor(private readonly inbox: NotificationsInboxService) {}

  @Get()
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ResponseMessage('Notifications retrieved successfully')
  @ApiOperation({
    summary: 'In-app notifications (`channel = IN_APP`) for the caller (A-25, §5.2)',
    description:
      'Projected from `notifications_outbox`; §4.32 makes those rows the in-app store and ' +
      'there is no second table. Copy is rendered from `@library/notifications` at read ' +
      "time in the caller's locale, so it has already passed the §9.4 check.",
  })
  @ApiOkResponse({ type: [NotificationResponseDto] })
  @ApiStandardResponses()
  list(
    @CurrentUser() user: ICurrentUser,
    @Query() query: NotificationQueryDto,
  ): Promise<IPaginated<NotificationResponseDto>> {
    return this.inbox.list(user, query);
  }

  @Get('count')
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ResponseMessage('Notification counts retrieved successfully')
  @ApiOperation({
    summary: 'Unread and total in-app notification counts — the badge (A-25)',
    description:
      'Two indexed `COUNT`s against `IDX_notifications_outbox_recipient_read`, so the badge ' +
      'never loads a row it does not display.',
  })
  @ApiOkResponse({ type: NotificationCountResponseDto })
  @ApiStandardResponses()
  counts(@CurrentUser() user: ICurrentUser): Promise<NotificationCountResponseDto> {
    return this.inbox.counts(user);
  }

  @Post(':notificationId/read')
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ResponseMessage('Notification marked read')
  @ApiOperation({
    summary: 'Mark one notification read (§5.2)',
    description:
      'The ownership predicate is in the `WHERE` clause of the update, not checked after a ' +
      'load (§9.2). Marking an already-read notification read again is a no-op, not a ' +
      'conflict — a double tap is not an error.',
  })
  @ApiOkResponse({ type: NotificationResponseDto })
  @ApiStandardResponses({ notFound: true })
  markRead(
    @CurrentUser() user: ICurrentUser,
    @Param() params: NotificationIdParamDto,
  ): Promise<NotificationResponseDto> {
    return this.inbox.markRead(user, params.notificationId);
  }

  @Post('read-all')
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ResponseMessage('All notifications marked read')
  @ApiOperation({
    summary: 'Mark every in-app notification read (§5.2)',
    description: 'Returns the settled counts, so the badge clears in one round trip.',
  })
  @ApiOkResponse({ type: NotificationCountResponseDto })
  @ApiStandardResponses()
  markAllRead(@CurrentUser() user: ICurrentUser): Promise<NotificationCountResponseDto> {
    return this.inbox.markAllRead(user);
  }
}
