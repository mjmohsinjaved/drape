import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ApiStandardResponses, Public, ResponseMessage, Role, Roles } from '@library/common';

import { CastVoteDto } from '../dto/cast-vote.dto';
import { ShareTokenParamDto } from '../dto/share-params.dto';
import { SharedShortlistResponseDto } from '../dto/shared-shortlist-response.dto';
import { VoteResponseDto } from '../dto/vote-response.dto';
import { PublicShareService } from '../services/public-share.service';
import { ShareTokenService } from '../services/share-token.service';

import type { VisitorContext } from '../services/public-share.service';
import type { VoterCookieOptions } from '../services/share-token.service';

/** The slice of the Express request this controller reads. Nothing authorising. */
export interface VisitorRequest {
  cookies?: Record<string, string | undefined>;
}

/** The slice of the Express response this controller writes. */
export interface VisitorResponse {
  cookie(name: string, value: string, options: VoterCookieOptions): unknown;
}

/**
 * The recipient view — ARCHITECTURE §5.14, PRD C-33, C-34.
 *
 * > C-33: "Share link requiring no account from recipients."
 *
 * So **every handler here is `@Public()` + `@Roles(Role.PUBLIC)` + an explicit
 * `@Throttle()`**, exactly as §2.6 requires. `@Public()` bypasses `SessionAuthGuard`
 * and nothing else: CSRF and the throttler still run, and the vote route carries the
 * §5.22 limit of 10 per minute per IP — hard, because it is an unauthenticated write.
 *
 * The vote route is a POST, so `CsrfGuard` applies to it like any other mutation. That
 * is deliberate and it costs a recipient nothing: the web app fetches `GET /auth/csrf`
 * — itself public — before posting. `@SkipCsrf()` is permitted only where the
 * credential is in the URL rather than in an ambient cookie (§2.6), and this is not
 * such a route.
 *
 * ### The visitor cookie
 *
 * A first-party cookie carrying 256 random bits identifies a returning visitor, so
 * they see the reactions they already left and cannot comment twice on one piece. Its
 * sha256 is what `votes.voterFingerprint` stores (§4.22); the raw value never leaves
 * the browser. It is `httpOnly` — no script needs to read it — and `sameSite: 'lax'`,
 * because arriving from WhatsApp is a top-level navigation and `strict` would drop the
 * cookie on the way in.
 *
 * ### What these routes cannot return
 *
 * Her photo, any render not on this shortlist, and her contact details. That is
 * enforced in `queries/public-share.scope.ts`, which is the only query builder in the
 * module, and asserted by the spec beside it.
 */
@ApiTags('Share')
@Controller('share')
export class PublicShareController {
  constructor(
    private readonly share: PublicShareService,
    private readonly tokens: ShareTokenService,
  ) {}

  @Get(':token')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  @ResponseMessage('Shortlist retrieved successfully')
  @ApiOperation({
    summary: 'The recipient view: renders only, no photo, no contact details (C-33)',
    description:
      'A revoked link, an expired link and a link that never existed all answer ' +
      'SHARE_LINK_NOT_FOUND — there is no way to tell them apart from outside (C-34, S-9).',
  })
  @ApiOkResponse({ type: SharedShortlistResponseDto })
  @ApiStandardResponses({ auth: false, notFound: true })
  async view(
    @Param() params: ShareTokenParamDto,
    @Req() request: VisitorRequest,
    @Res({ passthrough: true }) response: VisitorResponse,
  ): Promise<SharedShortlistResponseDto> {
    const result = await this.share.view(params.token, this.readVoterCookie(request));
    this.writeVoterCookie(response, result.visitor);
    return result.shortlist;
  }

  @Get(':token/votes')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  @ResponseMessage('Reactions retrieved successfully')
  @ApiOperation({
    summary: 'The reactions this visitor already left under this link (§5.14)',
    description: 'Scoped to the caller’s own cookie. One recipient never sees another’s comment.',
  })
  @ApiOkResponse({ type: [VoteResponseDto] })
  @ApiStandardResponses({ auth: false, notFound: true })
  ownVotes(
    @Param() params: ShareTokenParamDto,
    @Req() request: VisitorRequest,
  ): Promise<VoteResponseDto[]> {
    return this.share.ownVotes(params.token, this.readVoterCookie(request));
  }

  /** §5.22: 10 / 60 s per IP. An unauthenticated write gets the hard limit. */
  @Post(':token/votes')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ResponseMessage('Reaction saved')
  @ApiOperation({
    summary: 'React, and leave one comment per item (C-33)',
    description:
      'Changing a reaction updates the existing row. A second comment on the same ' +
      'piece by the same visitor is VOTE_ALREADY_CAST (§4.22).',
  })
  @ApiCreatedResponse({ type: VoteResponseDto })
  @ApiStandardResponses({ auth: false, notFound: true, conflict: true })
  async castVote(
    @Param() params: ShareTokenParamDto,
    @Body() dto: CastVoteDto,
    @Req() request: VisitorRequest,
    @Res({ passthrough: true }) response: VisitorResponse,
  ): Promise<VoteResponseDto> {
    const result = await this.share.castVote(params.token, dto, this.readVoterCookie(request));
    this.writeVoterCookie(response, result.visitor);
    return result.vote;
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                              */
  /* ---------------------------------------------------------------------- */

  private readVoterCookie(request: VisitorRequest): string | undefined {
    return request.cookies?.[this.tokens.voterCookieName];
  }

  /** Written only for a visitor who arrived without one, so an existing id is stable. */
  private writeVoterCookie(response: VisitorResponse, visitor: VisitorContext): void {
    if (!visitor.isNewVisitor) {
      return;
    }
    response.cookie(
      this.tokens.voterCookieName,
      visitor.voterToken,
      this.tokens.voterCookieOptions(),
    );
  }
}
