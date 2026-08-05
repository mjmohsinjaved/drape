import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  CSRF_HEADER_NAME,
  CurrentUser,
  Public,
  readCookie,
  ResponseMessage,
  Role,
  Roles,
  SkipCsrf,
  type ICurrentUser,
} from '@library/common';

import { AUTH_CONFIG } from '../auth.constants';
import {
  AuthAcknowledgementDto,
  AuthUserDto,
  CsrfTokenDto,
  LoginResponseDto,
  SessionSummaryDto,
  TwoFactorEnabledDto,
  TwoFactorSetupDto,
} from '../dto/auth-response.dto';
import { LoginDto } from '../dto/login.dto';
import { ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto } from '../dto/password.dto';
import { SessionIdParamDto } from '../dto/session-id-param.dto';
import { SignupDto } from '../dto/signup.dto';
import { DisableTwoFactorDto, TwoFactorCodeDto, TwoFactorRecoveryDto } from '../dto/two-factor.dto';
import { ConfirmEmailDto, RequestPhoneOtpDto, VerifyPhoneOtpDto } from '../dto/verification.dto';
import { AuthService, type AuthResult } from '../services/auth.service';
import { CsrfService } from '../services/csrf.service';
import { SessionService } from '../services/session.service';

import { requestFacts as facts, type AuthRequest } from './request-facts';

import type { AuthConfig } from '../config/auth.config';
import type { CookieWritingResponse } from '../services/csrf.service';

/** Per-route throttles from ARCHITECTURE §5.22. */
const THROTTLE_CREDENTIALS = { default: { limit: 5, ttl: 60_000 } };
const THROTTLE_RECOVERY = { default: { limit: 3, ttl: 60_000 } };
/** The §5.22 global default, stated explicitly because §2.6 requires it on @Public(). */
const THROTTLE_DEFAULT = { default: { limit: 100, ttl: 60_000 } };

/**
 * `auth` — ARCHITECTURE §5.1.
 *
 * Controllers validate and delegate (§2.9 rule 1): every decision below is
 * `AuthService`'s, and the only work done here is turning a `RequestFacts` out of
 * Express and turning an `AuthResult` into cookies.
 *
 * **Every handler carries exactly one `@Roles(...)`**, and every `@Public()` one
 * carries `@Roles(Role.PUBLIC)` plus an explicit `@Throttle()` (§2.6, B-5).
 *
 * `@SkipCsrf()` appears on exactly two handlers — login and signup — which is the
 * whole permitted budget (§2.6): neither caller can hold a session-bound CSRF secret
 * yet, because the session they would bind to does not exist until the call
 * succeeds.
 */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly csrfService: CsrfService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* CSRF                                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * `GET /auth/csrf` — issues the readable double-submit cookie and returns the
   * matching token (B-8).
   *
   * When the caller already has a session the token is bound to that session's
   * `csrfSecret`; before sign-in it is bound to the anonymous scope, which is what
   * the login and signup forms use.
   */
  @Get('csrf')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle(THROTTLE_DEFAULT)
  @ResponseMessage('CSRF token issued')
  @ApiOperation({ summary: 'Issue the CSRF cookie and its matching token' })
  @ApiOkResponse({ type: CsrfTokenDto })
  async issueCsrfToken(
    @CurrentUser() caller: ICurrentUser | undefined,
    @Res({ passthrough: true }) response: CookieWritingResponse,
  ): Promise<CsrfTokenDto> {
    const session =
      caller === undefined ? null : await this.sessionService.findById(caller.sessionId);
    const token = this.csrfService.issueToken(session?.csrfSecret ?? null);
    this.csrfService.writeCookie(response, token);

    return {
      csrfToken: token,
      cookieName: this.config.csrfCookieName,
      headerName: CSRF_HEADER_NAME,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Signup and login                                                        */
  /* ---------------------------------------------------------------------- */

  /**
   * `POST /auth/signup` — creates a **Consumer** account (S-4).
   *
   * A `role` in the payload is stripped and audit-logged, never rejected.
   */
  @Post('signup')
  @Public()
  @Roles(Role.PUBLIC)
  // Permitted use 1 of 2 (§2.6): the caller has no session, so there is no
  // session-bound CSRF secret to verify against. The rate limit and the §8.4 bot
  // check are what protect this route.
  @SkipCsrf()
  @Throttle(THROTTLE_CREDENTIALS)
  @ResponseMessage('Account created')
  @ApiOperation({ summary: 'Create a Consumer account' })
  @ApiCreatedResponse({ type: AuthUserDto })
  async signup(
    @Body() dto: SignupDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: CookieWritingResponse,
  ): Promise<AuthUserDto> {
    return this.withCookies(await this.authService.signup(dto, facts(request)), response);
  }

  /** `POST /auth/login` — S-1, S-6. Generic failure copy; sets `drape.sid`. */
  @Post('login')
  @Public()
  @Roles(Role.PUBLIC)
  // Permitted use 2 of 2 (§2.6). Same reason as signup.
  @SkipCsrf()
  @Throttle(THROTTLE_CREDENTIALS)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed in')
  @ApiOperation({ summary: 'Authenticate with an email and password' })
  @ApiOkResponse({ type: LoginResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: CookieWritingResponse,
  ): Promise<LoginResponseDto> {
    return this.withCookies(
      await this.authService.login(dto.email, dto.password, facts(request)),
      response,
    );
  }

  /**
   * `POST /auth/2fa/challenge` — completes a `twofaPending` session (S-8).
   *
   * `@Public()` because a pending session is *not* an authenticated caller: guard 3
   * rejects it with `TWOFA_REQUIRED` everywhere else, so this handler reads the
   * cookie itself.
   */
  @Post('2fa/challenge')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle(THROTTLE_CREDENTIALS)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed in')
  @ApiOperation({ summary: 'Complete a two-factor challenge with a TOTP code' })
  @ApiOkResponse({ type: LoginResponseDto })
  async challengeTwoFactor(
    @Body() dto: TwoFactorCodeDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: CookieWritingResponse,
  ): Promise<LoginResponseDto> {
    return this.withCookies(
      await this.authService.completeTwoFactorChallenge(
        this.readSessionCookie(request),
        dto.code,
        facts(request),
      ),
      response,
    );
  }

  /** `POST /auth/2fa/recovery` — completes a challenge with a single-use code (S-8). */
  @Post('2fa/recovery')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle(THROTTLE_CREDENTIALS)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed in')
  @ApiOperation({ summary: 'Complete a two-factor challenge with a recovery code' })
  @ApiOkResponse({ type: LoginResponseDto })
  async challengeRecovery(
    @Body() dto: TwoFactorRecoveryDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: CookieWritingResponse,
  ): Promise<LoginResponseDto> {
    return this.withCookies(
      await this.authService.completeRecovery(
        this.readSessionCookie(request),
        dto.recoveryCode,
        facts(request),
      ),
      response,
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Session lifecycle                                                       */
  /* ---------------------------------------------------------------------- */

  /** `GET /auth/me` — PRD B-10. The single role-resolution call. */
  @Get('me')
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ApiCookieAuth()
  @ResponseMessage('Session resolved')
  @ApiOperation({ summary: 'The signed-in caller' })
  @ApiOkResponse({ type: AuthUserDto })
  async me(@CurrentUser() caller: ICurrentUser): Promise<AuthUserDto> {
    return this.authService.me(caller);
  }

  /** `POST /auth/logout` — revokes this session and clears both cookies. */
  @Post('logout')
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed out')
  @ApiOperation({ summary: 'Revoke the current session' })
  @ApiOkResponse({ type: AuthAcknowledgementDto })
  async logout(
    @CurrentUser() caller: ICurrentUser,
    @Res({ passthrough: true }) response: CookieWritingResponse,
  ): Promise<AuthAcknowledgementDto> {
    return this.withCookies(await this.authService.logout(caller), response);
  }

  /** `GET /auth/sessions` — the caller's live sessions. */
  @Get('sessions')
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ApiCookieAuth()
  @ResponseMessage('Sessions retrieved')
  @ApiOperation({ summary: "List the caller's active sessions" })
  @ApiOkResponse({ type: [SessionSummaryDto] })
  async listSessions(@CurrentUser() caller: ICurrentUser): Promise<SessionSummaryDto[]> {
    return this.authService.listSessions(caller);
  }

  /** `DELETE /auth/sessions/:sessionId` — revokes one of the caller's own sessions. */
  @Delete('sessions/:sessionId')
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Session revoked')
  @ApiOperation({ summary: 'Revoke one session' })
  @ApiOkResponse({ type: AuthAcknowledgementDto })
  async revokeSession(
    @Param() params: SessionIdParamDto,
    @CurrentUser() caller: ICurrentUser,
    @Res({ passthrough: true }) response: CookieWritingResponse,
  ): Promise<AuthAcknowledgementDto> {
    return this.withCookies(
      await this.authService.revokeSession(caller, params.sessionId),
      response,
    );
  }

  /** `DELETE /auth/sessions` — revokes every session except this one (§5.1). */
  @Delete('sessions')
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Other sessions revoked')
  @ApiOperation({ summary: 'Revoke every other session' })
  @ApiOkResponse({ type: AuthAcknowledgementDto })
  async revokeOtherSessions(
    @CurrentUser() caller: ICurrentUser,
    @Req() request: AuthRequest,
  ): Promise<AuthAcknowledgementDto> {
    return this.authService.revokeOtherSessions(caller, facts(request));
  }

  /* ---------------------------------------------------------------------- */
  /* Passwords                                                               */
  /* ---------------------------------------------------------------------- */

  /** `POST /auth/password/forgot` — always 200, always the same body (S-6). */
  @Post('password/forgot')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle(THROTTLE_RECOVERY)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('If that address has an account, a reset link is on its way.')
  @ApiOperation({ summary: 'Request a password-reset link' })
  @ApiOkResponse({ type: AuthAcknowledgementDto })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: AuthRequest,
  ): Promise<AuthAcknowledgementDto> {
    return this.authService.requestPasswordReset(dto.email, facts(request));
  }

  /** `POST /auth/password/reset` — single-use token, 30-minute TTL (S-6). */
  @Post('password/reset')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle(THROTTLE_RECOVERY)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Password updated')
  @ApiOperation({ summary: 'Consume a reset token and set a new password' })
  @ApiOkResponse({ type: AuthAcknowledgementDto })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() request: AuthRequest,
  ): Promise<AuthAcknowledgementDto> {
    return this.authService.resetPassword(dto.token, dto.password, facts(request));
  }

  /** `POST /auth/password/change` — C-7. Rotates this session, revokes the others. */
  @Post('password/change')
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Password updated')
  @ApiOperation({ summary: 'Change the password using the current one' })
  @ApiOkResponse({ type: AuthAcknowledgementDto })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() caller: ICurrentUser,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: CookieWritingResponse,
  ): Promise<AuthAcknowledgementDto> {
    return this.withCookies(
      await this.authService.changePassword(caller, dto, facts(request)),
      response,
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Email and phone verification (C-3)                                      */
  /* ---------------------------------------------------------------------- */

  /** `POST /auth/email/verify/request` — re-send the verification email. */
  @Post('email/verify/request')
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ApiCookieAuth()
  @Throttle(THROTTLE_RECOVERY)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Verification email sent')
  @ApiOperation({ summary: 'Re-send the email-verification link' })
  @ApiOkResponse({ type: AuthAcknowledgementDto })
  async requestEmailVerification(
    @CurrentUser() caller: ICurrentUser,
    @Req() request: AuthRequest,
  ): Promise<AuthAcknowledgementDto> {
    return this.authService.requestEmailVerification(caller, facts(request));
  }

  /** `POST /auth/email/verify/confirm` — consume an email-verification token. */
  @Post('email/verify/confirm')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle(THROTTLE_RECOVERY)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Email confirmed')
  @ApiOperation({ summary: 'Confirm an email address' })
  @ApiOkResponse({ type: AuthAcknowledgementDto })
  async confirmEmail(
    @Body() dto: ConfirmEmailDto,
    @Req() request: AuthRequest,
  ): Promise<AuthAcknowledgementDto> {
    return this.authService.confirmEmailVerification(dto.token, facts(request));
  }

  /** `POST /auth/phone/otp/request` — C-3, required before an enquiry. */
  @Post('phone/otp/request')
  @Roles(Role.CONSUMER)
  @ApiCookieAuth()
  @Throttle(THROTTLE_RECOVERY)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Code sent')
  @ApiOperation({ summary: 'Send a phone OTP' })
  @ApiOkResponse({ type: AuthAcknowledgementDto })
  async requestPhoneOtp(
    @Body() dto: RequestPhoneOtpDto,
    @CurrentUser() caller: ICurrentUser,
    @Req() request: AuthRequest,
  ): Promise<AuthAcknowledgementDto> {
    return this.authService.requestPhoneOtp(caller, dto.phone, facts(request));
  }

  /** `POST /auth/phone/otp/verify` — stamps `phoneVerifiedAt` (C-3). */
  @Post('phone/otp/verify')
  @Roles(Role.CONSUMER)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Phone number confirmed')
  @ApiOperation({ summary: 'Verify a phone OTP' })
  @ApiOkResponse({ type: AuthAcknowledgementDto })
  async verifyPhoneOtp(
    @Body() dto: VerifyPhoneOtpDto,
    @CurrentUser() caller: ICurrentUser,
    @Req() request: AuthRequest,
  ): Promise<AuthAcknowledgementDto> {
    return this.authService.verifyPhoneOtp(caller, dto.code, facts(request));
  }

  /* ---------------------------------------------------------------------- */
  /* Two-factor enrolment (S-8)                                              */
  /* ---------------------------------------------------------------------- */

  /** `POST /auth/2fa/setup` — returns a TOTP secret and provisioning URI. */
  @Post('2fa/setup')
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Two-factor setup started')
  @ApiOperation({ summary: 'Begin two-factor enrolment' })
  @ApiOkResponse({ type: TwoFactorSetupDto })
  async setupTwoFactor(@CurrentUser() caller: ICurrentUser): Promise<TwoFactorSetupDto> {
    return this.authService.setupTwoFactor(caller);
  }

  /** `POST /auth/2fa/enable` — confirms a code and returns the recovery codes once. */
  @Post('2fa/enable')
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Two-factor authentication is on')
  @ApiOperation({ summary: 'Confirm a code and enable two-factor authentication' })
  @ApiOkResponse({ type: TwoFactorEnabledDto })
  @ApiBody({ type: TwoFactorCodeDto })
  async enableTwoFactor(
    @Body() dto: TwoFactorCodeDto,
    @CurrentUser() caller: ICurrentUser,
    @Req() request: AuthRequest,
  ): Promise<TwoFactorEnabledDto> {
    return this.authService.enableTwoFactor(caller, dto.code, facts(request));
  }

  /** `POST /auth/2fa/disable` — rejected for admins (S-8). */
  @Post('2fa/disable')
  @Roles(Role.ADMIN, Role.CONSUMER)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Two-factor authentication is off')
  @ApiOperation({ summary: 'Disable two-factor authentication (Consumers only)' })
  @ApiOkResponse({ type: AuthAcknowledgementDto })
  async disableTwoFactor(
    @Body() dto: DisableTwoFactorDto,
    @CurrentUser() caller: ICurrentUser,
    @Req() request: AuthRequest,
  ): Promise<AuthAcknowledgementDto> {
    return this.authService.disableTwoFactor(caller, dto, facts(request));
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Applies an `AuthResult`'s cookie side effects and returns its body.
   *
   * Every response that mints a session writes **both** cookies: the session cookie
   * and a CSRF token freshly bound to it. An unrotated CSRF cookie would stop
   * verifying the moment the session id changed.
   */
  private withCookies<T>(result: AuthResult<T>, response: CookieWritingResponse): T {
    if (result.issued !== undefined) {
      this.sessionService.writeAuthCookies(response, result.issued);
    } else if (result.clearCookies === true) {
      this.sessionService.clearAuthCookies(response);
    }
    return result.body;
  }

  private readSessionCookie(request: AuthRequest): string | undefined {
    return readCookie(request, this.config.sessionCookieName);
  }
}
