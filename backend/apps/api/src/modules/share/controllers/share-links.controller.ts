import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  ApiStandardResponses,
  CurrentUser,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
} from '@library/common';

import { CreateShareLinkDto } from '../dto/create-share-link.dto';
import { ShareLinkResponseDto } from '../dto/share-link-response.dto';
import { ShareLinkParamDto } from '../dto/share-params.dto';
import { ShareLinkVoteDto } from '../dto/vote-response.dto';
import { ShareLinksService } from '../services/share-links.service';

/**
 * The owner's share links — ARCHITECTURE §5.14, PRD C-33, C-34.
 *
 * **Every handler is `@Roles(Role.CONSUMER)`.** The public half of sharing lives in
 * `public-share.controller.ts`; keeping the two in separate files means the routes
 * that require a session and the routes that deliberately do not can never be confused
 * for one another during a review.
 *
 * Ownership is checked in the service on every route, and a cross-account request
 * receives the masked `SHARE_LINK_NOT_FOUND` (§2.4, S-9, E-7).
 */
@ApiTags('Share')
@Controller('share-links')
export class ShareLinksController {
  constructor(private readonly shareLinks: ShareLinksService) {}

  @Get()
  @Roles(Role.CONSUMER)
  @ResponseMessage('Share links retrieved successfully')
  @ApiOperation({
    summary: 'Her share links with view counts and expiry (C-34)',
    description:
      'The link itself is never re-issued: the token is stored hashed, so `url` is ' +
      'null on every response except the one that created it.',
  })
  @ApiOkResponse({ type: [ShareLinkResponseDto] })
  @ApiStandardResponses()
  list(@CurrentUser() user: ICurrentUser): Promise<ShareLinkResponseDto[]> {
    return this.shareLinks.list(user);
  }

  @Post()
  @Roles(Role.CONSUMER)
  @ResponseMessage('Share link created')
  @ApiOperation({
    summary: 'Create a 30-day link (C-33, C-34)',
    description:
      'Blocked while `sharing.enabled` is off (A-30). The response carries the full ' +
      'link once — copy it now, because it cannot be shown again.',
  })
  @ApiCreatedResponse({ type: ShareLinkResponseDto })
  @ApiStandardResponses()
  create(
    @Body() dto: CreateShareLinkDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<ShareLinkResponseDto> {
    return this.shareLinks.create(user, dto);
  }

  @Get(':shareLinkId/votes')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Reactions retrieved successfully')
  @ApiOperation({ summary: 'Reactions and comments left by her recipients (§5.14)' })
  @ApiOkResponse({ type: [ShareLinkVoteDto] })
  @ApiStandardResponses({ notFound: true })
  votes(
    @Param() params: ShareLinkParamDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<ShareLinkVoteDto[]> {
    return this.shareLinks.listVotes(user, params.shareLinkId);
  }

  @Delete(':shareLinkId')
  @Roles(Role.CONSUMER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke immediately (C-34)',
    description:
      'Takes effect on the next request. There is no snapshot to outlive it — the ' +
      'recipient view resolves her live shortlist (§4.21).',
  })
  @ApiNoContentResponse()
  @ApiStandardResponses({ notFound: true })
  revoke(@Param() params: ShareLinkParamDto, @CurrentUser() user: ICurrentUser): Promise<void> {
    return this.shareLinks.revoke(user, params.shareLinkId);
  }
}
