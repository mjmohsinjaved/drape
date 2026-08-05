import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  ApiStandardResponses,
  CurrentUser,
  Public,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';

import { CreateInviteDto } from '../dto/create-invite.dto';
import { InviteIdParamDto, InviteTokenParamDto } from '../dto/invite-params.dto';
import { InviteQueryDto } from '../dto/invite-query.dto';
import { InviteResponseDto, InviteTokenPreviewResponseDto } from '../dto/invite-response.dto';
import { InvitesService } from '../services/invites.service';

/** The public token lookup is a guessing surface, so it gets its own explicit limit (§2.6, §5.22). */
const PUBLIC_TOKEN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Admin invitations — ARCHITECTURE §5.3, PRD S-5.
 *
 * ### The role contract
 *
 * The four management routes are `@Roles(Role.ADMIN)`. There is **no** route on this
 * controller a consumer can use to create an invite, and `CreateInviteDto` has no
 * `role` field — the invited role is read from S-5 in the service, not from a
 * request body. `invites.controller.spec.ts` asserts a consumer session is refused
 * on every one of them (S-11, E-7).
 *
 * `GET /invites/token/:token` is `@Public()` because the person holding the emailed
 * link has no account yet, and cannot get one until it answers. It carries
 * `@Roles(Role.PUBLIC)` and an explicit `@Throttle()`, both required by §2.6, and it
 * consumes nothing.
 *
 * ### The route that is deliberately not here
 *
 * `POST /invites/token/:token/accept`. §5.3 lists it under this path, but what it
 * does is create an account: hash a password to the S-6 policy, open a session,
 * force S-8 two-factor setup. That is `auth`'s work, and `auth` owns the route. It
 * calls `InvitesService.consumeToken(rawToken, newUserId, { manager })` from inside
 * its own transaction — see `interfaces/invite-acceptance.interface.ts`.
 */
@ApiTags('Invites')
@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ResponseMessage('Invites retrieved successfully')
  @ApiOperation({
    summary: 'List invites (S-5)',
    description:
      'Status is derived from `consumedAt`, `expiresAt` and `deletedAt` — the table has no ' +
      'status column (§4.9).',
  })
  @ApiOkResponse({ type: [InviteResponseDto] })
  @ApiStandardResponses()
  list(@Query() query: InviteQueryDto): Promise<IPaginated<InviteResponseDto>> {
    return this.invites.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.ADMIN)
  @ResponseMessage('Invitation sent')
  @ApiOperation({ summary: 'Invite an admin by email; sends a single-use token (S-5, A-2)' })
  @ApiOkResponse({ type: InviteResponseDto })
  @ApiStandardResponses({ conflict: true })
  create(
    @CurrentUser() actor: ICurrentUser,
    @Body() dto: CreateInviteDto,
  ): Promise<InviteResponseDto> {
    return this.invites.create(actor, dto);
  }

  @Post(':inviteId/resend')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  @ResponseMessage('Invitation resent')
  @ApiOperation({
    summary: 'Re-issue the token and reset the expiry',
    description:
      'A new token. The original was never stored — only its digest — so the previous link ' +
      'stops working as soon as this succeeds.',
  })
  @ApiOkResponse({ type: InviteResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  resend(
    @CurrentUser() actor: ICurrentUser,
    @Param() params: InviteIdParamDto,
  ): Promise<InviteResponseDto> {
    return this.invites.resend(actor, params.inviteId);
  }

  @Delete(':inviteId')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  @ResponseMessage('Invitation revoked')
  @ApiOperation({ summary: 'Revoke a pending invite' })
  @ApiOkResponse({ type: InviteResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  revoke(
    @CurrentUser() actor: ICurrentUser,
    @Param() params: InviteIdParamDto,
  ): Promise<InviteResponseDto> {
    return this.invites.revoke(actor, params.inviteId);
  }

  @Get('token/:token')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle(PUBLIC_TOKEN_THROTTLE)
  @ResponseMessage('Invitation is valid')
  @ApiOperation({
    summary: 'Validate a token and return `{ email, role, expiresAt }` for the acceptance form',
    description:
      'Read-only: the token is not consumed, so the form can be reloaded. An unknown token, a ' +
      'revoked one and an expired one are reported separately to the invited person and ' +
      'reveal nothing about which addresses have been invited.',
  })
  @ApiOkResponse({ type: InviteTokenPreviewResponseDto })
  @ApiStandardResponses({ auth: false, notFound: true, conflict: true })
  previewToken(@Param() params: InviteTokenParamDto): Promise<InviteTokenPreviewResponseDto> {
    return this.invites.previewToken(params.token);
  }
}
