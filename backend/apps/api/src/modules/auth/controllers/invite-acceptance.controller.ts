import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ApiStandardResponses, Public, ResponseMessage, Role, Roles } from '@library/common';

import { InviteTokenParamDto } from '@api/modules/invites/dto/invite-params.dto';

import { AcceptInviteDto } from '../dto/accept-invite.dto';
import { AuthUserDto } from '../dto/auth-response.dto';
import { InviteAcceptanceService } from '../services/invite-acceptance.service';
import { SessionService } from '../services/session.service';

import { requestFacts, type AuthRequest } from './request-facts';

import type { CookieWritingResponse } from '../services/csrf.service';

/**
 * Acceptance is a guessing surface, like the token preview it follows, so it carries
 * its own explicit limit rather than the §5.22 global default (§2.6).
 */
const ACCEPT_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

/**
 * `POST /invites/token/:token/accept` — ARCHITECTURE §5.3, PRD S-5.
 *
 * ### Why an `auth` controller is mounted on the `invites` path
 *
 * §5.3 puts the route there, and `invites.controller.ts` deliberately leaves it out:
 * accepting an invitation creates an account — S-6 password policy, Argon2id hash,
 * a session, S-8 enrolment next — and none of that belongs in the module whose job is
 * to decide whether a token is still good. Nest routes by path, not by module, so the
 * two controllers coexist on `/invites` with no overlap.
 *
 * ### Guards
 *
 * `@Public()` because the person holding the emailed link has no account yet — that
 * is the point of the link. `@Roles(Role.PUBLIC)` and an explicit `@Throttle()`
 * accompany it, both required by §2.6.
 *
 * **No `@SkipCsrf()`.** The §2.6 budget is two handlers — login and signup — and both
 * are already spent. This one does not need it: the acceptance form calls
 * `GET /auth/csrf` first and gets an anonymous-scope token, exactly as the login form
 * does before it has a session.
 */
@ApiTags('Invites')
@Controller('invites')
export class InviteAcceptanceController {
  constructor(
    private readonly acceptance: InviteAcceptanceService,
    private readonly sessionService: SessionService,
  ) {}

  @Post('token/:token/accept')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle(ACCEPT_THROTTLE)
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Account created')
  @ApiOperation({
    summary: 'Create the admin account behind an invitation (S-5)',
    description:
      'The email and the role come from the invite row, never from the request body. The ' +
      'token is single-use and is burned in the same transaction as the account insert. ' +
      'Two-factor setup is forced immediately afterwards (S-8).',
  })
  @ApiCreatedResponse({ type: AuthUserDto })
  @ApiStandardResponses({ auth: false, notFound: true, conflict: true })
  async accept(
    @Param() params: InviteTokenParamDto,
    @Body() dto: AcceptInviteDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: CookieWritingResponse,
  ): Promise<AuthUserDto> {
    const result = await this.acceptance.accept(params.token, dto, requestFacts(request));

    // A session and a CSRF token bound to it, together — the new admin is signed in
    // and can reach `/auth/2fa/setup` without a second round trip through login.
    if (result.issued !== undefined) {
      this.sessionService.writeAuthCookies(response, result.issued);
    }

    return result.body;
  }
}
