import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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

import { ModerationItemResponseDto } from '../dto/moderation-item-response.dto';
import { ModerationItemParamDto, ModerationQueryDto } from '../dto/moderation-query.dto';
import { ReviewModerationItemDto } from '../dto/review-moderation.dto';
import { ModerationQueueService } from '../services/moderation-queue.service';

/**
 * The A-34 moderation queue — ARCHITECTURE §5.17.
 *
 * **Every handler is `@Roles(Role.ADMIN)`, and that is the whole of the access model.**
 * A-34 says "Admin only"; there is no consumer-facing view of this table, no public
 * route, and nothing here that takes a user id from the caller.
 *
 * ### The one place S-10 bends, and exactly how far
 *
 * PRD S-10 is absolute: "Admins cannot view consumer photos." The sentence continues —
 * "…plus **blurred thumbnails in the moderation queue**" — and these four routes are
 * that exception and the only one. What makes it safe is not a rule written down here:
 * it is that `ModerationQueueService` reads `person_photos` through an explicit column
 * list with no `storageKey` in it, so the original is not merely withheld, it is never
 * loaded. The blurred derivative it does serve is signed to the reviewing admin's own
 * id (§3.4) and its issue is written to `audit_log` before this controller answers
 * (A-34, §9.3).
 */
@ApiTags('Moderation')
@Controller('admin/moderation')
export class AdminModerationController {
  constructor(private readonly queue: ModerationQueueService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ResponseMessage('Moderation queue retrieved successfully')
  @ApiOperation({
    summary: 'Queue of flagged photos, blurred thumbnails only. Every call audit-logged (A-34)',
    description:
      'Defaults to `PENDING`, **oldest first** — every waiting item is an account that ' +
      'cannot generate until somebody decides. The `MODERATION_QUEUE_VIEWED` audit row is ' +
      'written and awaited before the rows are returned (§4.29, §9.3): a view that could ' +
      'succeed while its audit row failed would not be an audited view.',
  })
  @ApiOkResponse({ type: [ModerationItemResponseDto] })
  @ApiStandardResponses()
  list(
    @CurrentUser() admin: ICurrentUser,
    @Query() query: ModerationQueryDto,
  ): Promise<IPaginated<ModerationItemResponseDto>> {
    return this.queue.list(admin, query);
  }

  @Get(':itemId')
  @Roles(Role.ADMIN)
  @ResponseMessage('Moderation item retrieved successfully')
  @ApiOperation({
    summary: 'One item. Audit-logged (A-34)',
    description:
      'Hands over a signed URL for the **blurred** 160px derivative, scoped to the calling ' +
      "admin's own id (§3.4). Writes `MODERATION_ITEM_VIEWED`. The original photograph is " +
      'not addressable from this response and its storage key is never read (S-10).',
  })
  @ApiOkResponse({ type: ModerationItemResponseDto })
  @ApiStandardResponses({ notFound: true })
  findOne(
    @CurrentUser() admin: ICurrentUser,
    @Param() params: ModerationItemParamDto,
  ): Promise<ModerationItemResponseDto> {
    return this.queue.findOne(admin, params.itemId);
  }

  @Post(':itemId/approve')
  @Roles(Role.ADMIN)
  @ResponseMessage('Photo approved')
  @ApiOperation({
    summary: 'Release the photo for generation (§5.17)',
    description:
      'Decides the item and writes `person_photos.moderationState = APPROVED` in one ' +
      'transaction (§2.9 rule 3), so a generation can no longer be refused with ' +
      '`PHOTO_BLOCKED_BY_MODERATION`. Refused with `MODERATION_ALREADY_REVIEWED` if ' +
      'another admin got there first.',
  })
  @ApiOkResponse({ type: ModerationItemResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  approve(
    @CurrentUser() admin: ICurrentUser,
    @Param() params: ModerationItemParamDto,
    @Body() dto: ReviewModerationItemDto,
  ): Promise<ModerationItemResponseDto> {
    return this.queue.approve(admin, params.itemId, dto);
  }

  @Post(':itemId/reject')
  @Roles(Role.ADMIN)
  @ResponseMessage('Photo kept blocked')
  @ApiOperation({
    summary: 'Keep it blocked; the consumer sees the neutral message (§5.17)',
    description:
      'Writes `person_photos.moderationState = BLOCKED` and fails any generation still ' +
      'waiting on the decision with `MODERATION_REJECTED`. The consumer is not written ' +
      'to: the neutral §8.3 message reaches her on the generation path, where she was ' +
      "going to act anyway. The reviewer's note is internal (A-24's principle).",
  })
  @ApiOkResponse({ type: ModerationItemResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  reject(
    @CurrentUser() admin: ICurrentUser,
    @Param() params: ModerationItemParamDto,
    @Body() dto: ReviewModerationItemDto,
  ): Promise<ModerationItemResponseDto> {
    return this.queue.reject(admin, params.itemId, dto);
  }
}
