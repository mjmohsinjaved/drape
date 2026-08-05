import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AuthException,
  ConflictException,
  ErrorCode,
  ForbiddenException,
  isAdmin,
  Locale,
  NotFoundException,
  UserStatus,
  ValidationException,
  type ICurrentUser,
} from '@library/common';
import { NotificationsService, TemplateId } from '@library/notifications';
import type { SendResult } from '@library/notifications';

import { AUTH_CONFIG, AUTH_ROUTES, REVOKE_REASONS, USER_DIRECTORY } from '../auth.constants';
import { AUTH_EVENTS } from '../auth.events';
import { AuthOutcome } from '../enums/auth-outcome.enum';
import { VerificationPurpose } from '../enums/verification-purpose.enum';
import { toAuthUserDto, toNotificationLocale, toSessionSummaryDto } from '../mappers/auth.mapper';

import { AuthAttemptService } from './auth-attempt.service';
import { PasswordService } from './password.service';
import { SessionService, type IssuedSession } from './session.service';
import { TotpService } from './totp.service';
import { VerificationTokenService } from './verification-token.service';

import type { AuthConfig } from '../config/auth.config';
import type {
  AuthAcknowledgementDto,
  AuthUserDto,
  LoginResponseDto,
  SessionSummaryDto,
  TwoFactorEnabledDto,
  TwoFactorSetupDto,
} from '../dto/auth-response.dto';
import type { ChangePasswordDto } from '../dto/password.dto';
import type { SignupDto } from '../dto/signup.dto';
import type { DisableTwoFactorDto } from '../dto/two-factor.dto';
import type { Session } from '../entities/session.entity';
import type { AuthUser, UserDirectory } from '../interfaces/user-directory.interface';

/** Facts about the request, taken from Express — never from the body (S-3). */
export interface RequestFacts {
  readonly ip: string;
  readonly userAgent: string | null;
}

/** A response that also has to set or clear cookies. */
export interface AuthResult<T> {
  readonly body: T;
  /** Present when a new session was minted: the controller writes both cookies. */
  readonly issued?: IssuedSession;
  /** True when the controller should clear both cookies. */
  readonly clearCookies?: boolean;
}

/**
 * The one acknowledgement returned by every enumeration-sensitive endpoint.
 *
 * Frozen so no code path can accidentally decorate it for one branch and not the
 * other — the S-6 guarantee is that the bytes are identical, and a shared frozen
 * object makes that structural rather than a promise.
 */
const GENERIC_ACKNOWLEDGEMENT: Readonly<AuthAcknowledgementDto> = Object.freeze({
  accepted: true,
});

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * The `auth` feature service — ARCHITECTURE §5.1, PRD S-1 … S-8, C-2, C-3, C-7.
 *
 * ### The three rules that shape this file
 *
 * 1. **Signup cannot produce an admin (S-4).** The only account-creating call
 *    available here is `UserDirectory.createConsumer`, whose input type has no role
 *    field. A `role` in the payload is stripped and audit-logged, never rejected and
 *    never read.
 * 2. **Nothing enumerates accounts (S-6).** Login and password reset return the same
 *    bytes for a known and an unknown address, and the absent-account branch runs a
 *    real Argon2 verification against a dummy hash so the timing matches too.
 * 3. **The session id rotates on every privilege change.** Login, 2FA completion and
 *    password change all mint a new row and retire the old one, and password change,
 *    deactivation and suspension revoke every other session (A-2, A-19).
 *
 * No method here logs a password, a token or an OTP (E-12). Audit rows are written
 * by the `audit` module's `@OnEvent` listener from the events emitted here, never
 * inline (§2.9 rule 4).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
    private readonly passwordService: PasswordService,
    private readonly sessionService: SessionService,
    private readonly totpService: TotpService,
    private readonly tokens: VerificationTokenService,
    private readonly attempts: AuthAttemptService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* Signup (S-4, C-2)                                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * Creates a **Consumer** account. There is no code path here, or below here, that
   * can produce an admin (S-4): admins arrive only from the seed script or from an
   * invitation (S-5), which is the `invites` module's endpoint, not this one.
   */
  async signup(dto: SignupDto, facts: RequestFacts): Promise<AuthResult<AuthUserDto>> {
    const now = new Date();
    const email = dto.email.trim().toLowerCase();

    this.passwordService.assertMeetsPolicy(dto.password);

    const existing = await this.users.findByEmail(email);
    if (existing !== null) {
      await this.attempts.record({
        email,
        userId: null,
        ip: facts.ip,
        userAgent: facts.userAgent,
        outcome: AuthOutcome.INVALID_CREDENTIALS,
        route: AUTH_ROUTES.SIGNUP,
      });
      // Signup is not enumeration-sensitive in the same way login is: the form has
      // to tell the visitor the address is taken, or she cannot get past it. The
      // §5.1 contract carries `EMAIL_ALREADY_EXISTS` for exactly this.
      throw new ConflictException(ErrorCode.EMAIL_ALREADY_EXISTS);
    }

    if (await this.users.existsByPhone(dto.phone)) {
      throw new ConflictException(ErrorCode.PHONE_ALREADY_EXISTS);
    }

    const user = await this.users.createConsumer({
      email,
      name: dto.name.trim(),
      passwordHash: await this.passwordService.hash(dto.password),
      phone: dto.phone,
      locale: dto.locale ?? Locale.EN,
    });

    // S-4: "A role passed in the signup payload is ignored and logged." Logged, not
    // rejected — and logged *after* the consumer exists, so the audit row can point
    // at a real account.
    if (typeof dto.role === 'string' && dto.role.trim().length > 0) {
      this.recordIgnoredSignupRole(user, dto.role.trim(), facts, now);
    }

    await this.attempts.record({
      email,
      userId: user.id,
      ip: facts.ip,
      userAgent: facts.userAgent,
      outcome: AuthOutcome.SUCCESS,
      route: AUTH_ROUTES.SIGNUP,
    });

    this.events.emit(AUTH_EVENTS.SIGNED_UP, {
      userId: user.id,
      role: user.role,
      ip: facts.ip,
      userAgent: facts.userAgent,
      occurredAt: now,
      locale: user.locale,
    });

    await this.dispatchEmailVerification(user, facts, now);

    // A brand-new consumer is signed in straight away: C-2 asks for four fields and
    // then gets out of the way. Email verification gates the first generation (C-3),
    // not the session.
    const issued = await this.sessionService.issue({
      user,
      ip: facts.ip,
      userAgent: facts.userAgent,
      twofaPending: false,
      now,
    });

    return { body: toAuthUserDto(user), issued };
  }

  /* ---------------------------------------------------------------------- */
  /* Login (S-1, S-6, S-7, S-8)                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Authenticates an email and password.
   *
   * Every failure below throws the **same** `INVALID_CREDENTIALS` with the same
   * message, and the "no such account" branch performs a real Argon2 verification
   * against a dummy hash, so neither the response nor the time taken distinguishes
   * an unknown address from a wrong password (S-6).
   */
  async login(
    email: string,
    password: string,
    facts: RequestFacts,
  ): Promise<AuthResult<LoginResponseDto>> {
    const now = new Date();
    const normalisedEmail = email.trim().toLowerCase();

    // Lockout is checked first and its copy is identical for a real and an unknown
    // address, so it cannot be used as an oracle either.
    await this.attempts.assertNotLockedOut(
      normalisedEmail,
      facts.ip,
      now,
      this.config.lockoutThreshold,
      this.config.lockoutMaxMinutes,
    );

    const user = await this.users.findByEmail(normalisedEmail);

    const passwordMatches =
      user === null
        ? await this.passwordService.verifyDummy(password)
        : await this.passwordService.verify(user.passwordHash, password);

    if (user === null || !passwordMatches) {
      await this.recordFailedLogin(normalisedEmail, user, facts);
      throw new AuthException(ErrorCode.INVALID_CREDENTIALS);
    }

    // Only now — once the caller has proved they hold the password — is it safe to
    // say anything about the account's state. Saying it earlier would turn the login
    // form into a directory of suspended accounts.
    this.assertAccountUsable(user);

    const twofaRequired = user.twofaEnabledAt !== null;

    const issued = await this.sessionService.issue({
      user,
      ip: facts.ip,
      userAgent: facts.userAgent,
      twofaPending: twofaRequired,
      now,
    });

    await this.users.update(user.id, {
      lastLoginAt: now,
      lastActiveAt: now,
      failedLoginCount: 0,
      lockedUntil: null,
    });

    await this.attempts.record({
      email: normalisedEmail,
      userId: user.id,
      ip: facts.ip,
      userAgent: facts.userAgent,
      outcome: AuthOutcome.SUCCESS,
      route: AUTH_ROUTES.LOGIN,
    });

    if (isAdmin(user.role) && !twofaRequired) {
      // S-8 makes 2FA mandatory for admins. The API cannot refuse the session
      // outright — an admin with no second factor yet (the E-4 seed, or an invite
      // accepted moments ago) would have no way to enrol one. `GET /auth/me` reports
      // `twofaEnabled: false`, the console forces the enrolment screen, and
      // `POST /auth/2fa/disable` refuses admins outright, so the state is reachable
      // but not sustainable.
      this.logger.warn(`admin ${user.id} signed in without a second factor enrolled (S-8)`);
    }

    this.events.emit(AUTH_EVENTS.LOGGED_IN, {
      userId: user.id,
      role: user.role,
      ip: facts.ip,
      userAgent: facts.userAgent,
      occurredAt: now,
      sessionId: issued.session.id,
      twofaRequired,
    });

    return {
      // Nothing about the account is returned until the second factor is done.
      body: { user: twofaRequired ? null : toAuthUserDto(user), twofaRequired },
      issued,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Two-factor challenge (S-8)                                              */
  /* ---------------------------------------------------------------------- */

  /** Completes a `twofaPending` session with a TOTP code. */
  async completeTwoFactorChallenge(
    sessionToken: string | undefined,
    code: string,
    facts: RequestFacts,
  ): Promise<AuthResult<LoginResponseDto>> {
    const { session, user, now } = await this.loadPendingSession(sessionToken);

    if (!this.totpService.verifyEncrypted(user.twofaSecret, code)) {
      await this.attempts.record({
        email: user.email,
        userId: user.id,
        ip: facts.ip,
        userAgent: facts.userAgent,
        outcome: AuthOutcome.TWOFA_FAILED,
        route: AUTH_ROUTES.TWOFA,
      });
      throw new AuthException(ErrorCode.TWOFA_INVALID);
    }

    return this.completePendingSession(session, user, facts, now);
  }

  /** Completes a `twofaPending` session with a single-use recovery code. */
  async completeRecovery(
    sessionToken: string | undefined,
    recoveryCode: string,
    facts: RequestFacts,
  ): Promise<AuthResult<LoginResponseDto>> {
    const { session, user, now } = await this.loadPendingSession(sessionToken);

    const stored = user.twofaRecoveryCodes ?? [];
    const index = await this.totpService.findRecoveryCodeIndex(stored, recoveryCode);

    if (index === -1) {
      await this.attempts.record({
        email: user.email,
        userId: user.id,
        ip: facts.ip,
        userAgent: facts.userAgent,
        outcome: AuthOutcome.TWOFA_FAILED,
        route: AUTH_ROUTES.TWOFA,
      });
      throw new AuthException(ErrorCode.TWOFA_INVALID);
    }

    // Single use: the hash is dropped before the session is completed, so a replay
    // of the same code cannot win a race with the first use.
    const remaining = stored.filter((_hash, position) => position !== index);
    await this.users.update(user.id, { twofaRecoveryCodes: remaining });

    return this.completePendingSession(session, user, facts, now);
  }

  /* ---------------------------------------------------------------------- */
  /* Session lifecycle                                                       */
  /* ---------------------------------------------------------------------- */

  /** `GET /auth/me` — PRD B-10. The single role-resolution call. */
  async me(caller: ICurrentUser): Promise<AuthUserDto> {
    const user = await this.requireUser(caller.id);
    return toAuthUserDto(user);
  }

  /** `POST /auth/logout` — revokes this session only. */
  async logout(caller: ICurrentUser): Promise<AuthResult<AuthAcknowledgementDto>> {
    const now = new Date();
    const session = await this.sessionService.findById(caller.sessionId);
    if (session !== null) {
      await this.sessionService.revoke(session, REVOKE_REASONS.LOGOUT, now);
    }
    return { body: GENERIC_ACKNOWLEDGEMENT, clearCookies: true };
  }

  /** `GET /auth/sessions` — the caller's live sessions. */
  async listSessions(caller: ICurrentUser): Promise<SessionSummaryDto[]> {
    const sessions = await this.sessionService.listActive(caller.id, new Date());
    return sessions.map((session) => toSessionSummaryDto(session, caller.sessionId));
  }

  /**
   * `DELETE /auth/sessions/:sessionId` — revokes one of the caller's own sessions.
   *
   * Ownership is checked here, in the service, on the row (§2.7, §9.2). A session
   * belonging to someone else is reported as not found, never as forbidden, so the
   * endpoint cannot be used to probe for session ids.
   */
  async revokeSession(
    caller: ICurrentUser,
    sessionId: string,
  ): Promise<AuthResult<AuthAcknowledgementDto>> {
    const now = new Date();
    const session = await this.sessionService.findById(sessionId);

    if (session === null || session.userId !== caller.id) {
      throw new NotFoundException(ErrorCode.RESOURCE_NOT_FOUND);
    }

    await this.sessionService.revoke(session, REVOKE_REASONS.LOGOUT, now);

    return {
      body: GENERIC_ACKNOWLEDGEMENT,
      // Revoking the session you are holding is a logout.
      clearCookies: session.id === caller.sessionId,
    };
  }

  /** `DELETE /auth/sessions` — revokes every session except this one (§5.1). */
  async revokeOtherSessions(
    caller: ICurrentUser,
    facts: RequestFacts,
  ): Promise<AuthAcknowledgementDto> {
    const now = new Date();
    const revoked = await this.sessionService.revokeAllForUser(
      caller.id,
      REVOKE_REASONS.LOGOUT_ALL,
      now,
      { exceptSessionId: caller.sessionId },
    );

    this.events.emit(AUTH_EVENTS.SESSIONS_REVOKED, {
      userId: caller.id,
      role: caller.role,
      ip: facts.ip,
      userAgent: facts.userAgent,
      occurredAt: now,
      reason: REVOKE_REASONS.LOGOUT_ALL,
      revokedCount: revoked,
    });

    return GENERIC_ACKNOWLEDGEMENT;
  }

  /* ---------------------------------------------------------------------- */
  /* Passwords (S-6, C-7)                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * `POST /auth/password/forgot`.
   *
   * **Always 200, always the same body.** Whether the address has an account decides
   * only whether an email leaves the building — never what the caller is told (S-6).
   */
  async requestPasswordReset(email: string, facts: RequestFacts): Promise<AuthAcknowledgementDto> {
    const now = new Date();
    const normalisedEmail = email.trim().toLowerCase();
    const user = await this.users.findByEmail(normalisedEmail);

    await this.attempts.record({
      email: normalisedEmail,
      userId: user?.id ?? null,
      ip: facts.ip,
      userAgent: facts.userAgent,
      outcome: AuthOutcome.SUCCESS,
      route: AUTH_ROUTES.PASSWORD_RESET,
    });

    if (user !== null && user.status === UserStatus.ACTIVE) {
      const issued = await this.tokens.issue({
        userId: user.id,
        purpose: VerificationPurpose.PASSWORD_RESET,
        destination: user.email,
        expiresAt: new Date(now.getTime() + this.config.passwordResetTtlMinutes * MINUTE_MS),
        ip: facts.ip,
      });

      this.dispatchEmail(
        this.notifications.sendTemplatedEmail({
          to: user.email,
          template: TemplateId.PASSWORD_RESET,
          props: {
            resetUrl: this.buildWebUrl('/reset-password', issued.token),
            expiresInMinutes: this.config.passwordResetTtlMinutes,
          },
          locale: toNotificationLocale(user.locale),
        }),
        'password reset',
      );

      this.events.emit(AUTH_EVENTS.PASSWORD_RESET_REQUESTED, {
        userId: user.id,
        role: user.role,
        ip: facts.ip,
        userAgent: facts.userAgent,
        occurredAt: now,
      });
    }

    // The send is deliberately *not* awaited: waiting for SMTP only when the account
    // exists would reintroduce, as latency, exactly the oracle the identical body
    // closes (S-6).
    return GENERIC_ACKNOWLEDGEMENT;
  }

  /**
   * `POST /auth/password/reset` — consumes the single-use 30-minute token, sets the
   * new password and revokes **every** session (S-6).
   */
  async resetPassword(
    token: string,
    newPassword: string,
    facts: RequestFacts,
  ): Promise<AuthAcknowledgementDto> {
    const now = new Date();
    this.passwordService.assertMeetsPolicy(newPassword, 'password');

    const row = await this.tokens.consume(token, VerificationPurpose.PASSWORD_RESET, now);
    if (row.userId === null) {
      throw new ValidationException(ErrorCode.TOKEN_INVALID);
    }

    const user = await this.requireUser(row.userId);
    this.assertAccountUsable(user);

    await this.users.update(user.id, {
      passwordHash: await this.passwordService.hash(newPassword),
      failedLoginCount: 0,
      lockedUntil: null,
    });

    await this.sessionService.revokeAllForUser(user.id, REVOKE_REASONS.PASSWORD_CHANGED, now);

    this.events.emit(AUTH_EVENTS.PASSWORD_CHANGED, {
      userId: user.id,
      role: user.role,
      ip: facts.ip,
      userAgent: facts.userAgent,
      occurredAt: now,
    });

    return GENERIC_ACKNOWLEDGEMENT;
  }

  /**
   * `POST /auth/password/change` — C-7.
   *
   * Rotates the caller's session (a password change is a privilege change) and
   * revokes every other one, so a device that learned the old password loses access
   * immediately.
   */
  async changePassword(
    caller: ICurrentUser,
    dto: ChangePasswordDto,
    facts: RequestFacts,
  ): Promise<AuthResult<AuthAcknowledgementDto>> {
    const now = new Date();
    const user = await this.requireUser(caller.id);
    this.assertAccountUsable(user);
    this.assertNotBeingDeleted(user);

    if (!(await this.passwordService.verify(user.passwordHash, dto.currentPassword))) {
      throw new AuthException(ErrorCode.INVALID_CREDENTIALS);
    }
    this.passwordService.assertMeetsPolicy(dto.newPassword, 'newPassword');

    await this.users.update(user.id, {
      passwordHash: await this.passwordService.hash(dto.newPassword),
      failedLoginCount: 0,
      lockedUntil: null,
    });

    await this.sessionService.revokeAllForUser(user.id, REVOKE_REASONS.PASSWORD_CHANGED, now, {
      exceptSessionId: caller.sessionId,
    });

    const current = await this.sessionService.findById(caller.sessionId);
    const issued =
      current === null
        ? await this.sessionService.issue({
            user,
            ip: facts.ip,
            userAgent: facts.userAgent,
            twofaPending: false,
            now,
          })
        : await this.sessionService.rotate(current, {
            user,
            ip: facts.ip,
            userAgent: facts.userAgent,
            now,
          });

    this.events.emit(AUTH_EVENTS.PASSWORD_CHANGED, {
      userId: user.id,
      role: user.role,
      ip: facts.ip,
      userAgent: facts.userAgent,
      occurredAt: now,
    });

    return { body: GENERIC_ACKNOWLEDGEMENT, issued };
  }

  /* ---------------------------------------------------------------------- */
  /* Email and phone verification (C-3)                                      */
  /* ---------------------------------------------------------------------- */

  /** `POST /auth/email/verify/request` — re-sends the verification link. */
  async requestEmailVerification(
    caller: ICurrentUser,
    facts: RequestFacts,
  ): Promise<AuthAcknowledgementDto> {
    const now = new Date();
    const user = await this.requireUser(caller.id);

    if (user.emailVerifiedAt === null) {
      await this.dispatchEmailVerification(user, facts, now);
    }

    // Identical either way: whether the address is already confirmed is not
    // something this endpoint needs to disclose.
    return GENERIC_ACKNOWLEDGEMENT;
  }

  /** `POST /auth/email/verify/confirm` — consumes the token and stamps the column. */
  async confirmEmailVerification(
    token: string,
    facts: RequestFacts,
  ): Promise<AuthAcknowledgementDto> {
    const now = new Date();
    const row = await this.tokens.consume(token, VerificationPurpose.EMAIL_VERIFICATION, now);
    if (row.userId === null) {
      throw new ValidationException(ErrorCode.TOKEN_INVALID);
    }

    const user = await this.requireUser(row.userId);
    if (user.emailVerifiedAt === null) {
      await this.users.update(user.id, { emailVerifiedAt: now });
      this.events.emit(AUTH_EVENTS.EMAIL_VERIFIED, {
        userId: user.id,
        role: user.role,
        ip: facts.ip,
        userAgent: facts.userAgent,
        occurredAt: now,
      });
    }

    return GENERIC_ACKNOWLEDGEMENT;
  }

  /** `POST /auth/phone/otp/request` — C-3, required before an enquiry. */
  async requestPhoneOtp(
    caller: ICurrentUser,
    phone: string | undefined,
    facts: RequestFacts,
  ): Promise<AuthAcknowledgementDto> {
    const now = new Date();
    const user = await this.requireUser(caller.id);
    this.assertAccountUsable(user);

    const destination = phone ?? user.phone;
    if (destination === null || destination === undefined) {
      throw new ValidationException(ErrorCode.VALIDATION_ERROR, {
        errors: [{ field: 'phone', message: 'Add a phone number first.' }],
      });
    }

    if (destination !== user.phone) {
      if (await this.users.existsByPhone(destination)) {
        throw new ConflictException(ErrorCode.PHONE_ALREADY_EXISTS);
      }
      // Changing the number un-verifies it: the new one has proved nothing yet.
      await this.users.update(user.id, { phone: destination, phoneVerifiedAt: null });
    }

    const issued = await this.tokens.issue({
      userId: user.id,
      purpose: VerificationPurpose.PHONE_OTP,
      destination,
      expiresAt: new Date(now.getTime() + this.config.otpTtlSeconds * 1000),
      ip: facts.ip,
      withCode: true,
    });

    if (issued.code !== null) {
      this.dispatchEmail(
        this.notifications.sendTemplatedSms({
          to: destination,
          template: TemplateId.OTP_SMS,
          props: {
            code: issued.code,
            expiresInMinutes: Math.max(1, Math.round(this.config.otpTtlSeconds / 60)),
          },
          locale: toNotificationLocale(user.locale),
        }),
        'phone OTP',
      );
    }

    await this.attempts.record({
      email: user.email,
      userId: user.id,
      ip: facts.ip,
      userAgent: facts.userAgent,
      outcome: AuthOutcome.SUCCESS,
      route: AUTH_ROUTES.OTP,
    });

    return GENERIC_ACKNOWLEDGEMENT;
  }

  /** `POST /auth/phone/otp/verify` — stamps `phoneVerifiedAt` (C-3). */
  async verifyPhoneOtp(
    caller: ICurrentUser,
    code: string,
    facts: RequestFacts,
  ): Promise<AuthAcknowledgementDto> {
    const now = new Date();
    const user = await this.requireUser(caller.id);
    this.assertAccountUsable(user);

    try {
      await this.tokens.verifyOtp(user.id, code, now);
    } catch (error) {
      await this.attempts.record({
        email: user.email,
        userId: user.id,
        ip: facts.ip,
        userAgent: facts.userAgent,
        outcome: AuthOutcome.INVALID_CREDENTIALS,
        route: AUTH_ROUTES.OTP,
      });
      throw error;
    }

    await this.users.update(user.id, { phoneVerifiedAt: now });

    this.events.emit(AUTH_EVENTS.PHONE_VERIFIED, {
      userId: user.id,
      role: user.role,
      ip: facts.ip,
      userAgent: facts.userAgent,
      occurredAt: now,
    });

    return GENERIC_ACKNOWLEDGEMENT;
  }

  /* ---------------------------------------------------------------------- */
  /* Two-factor enrolment (S-8, C-7)                                         */
  /* ---------------------------------------------------------------------- */

  /**
   * `POST /auth/2fa/setup` — mints a secret and the provisioning URI.
   *
   * The ciphertext is stored immediately but `twofaEnabledAt` stays null, so 2FA is
   * not in force until a live code confirms the phone actually holds the secret.
   * Re-running setup before confirming simply replaces the pending secret.
   */
  async setupTwoFactor(caller: ICurrentUser): Promise<TwoFactorSetupDto> {
    const user = await this.requireUser(caller.id);
    this.assertAccountUsable(user);
    this.assertNotBeingDeleted(user);

    if (user.twofaEnabledAt !== null) {
      throw new ConflictException(ErrorCode.TWOFA_ALREADY_ENABLED);
    }

    const enrolment = this.totpService.enrol(user.email);
    await this.users.update(user.id, { twofaSecret: enrolment.encryptedSecret });

    return { secret: enrolment.secret, provisioningUri: enrolment.provisioningUri };
  }

  /** `POST /auth/2fa/enable` — confirms a code and returns the recovery codes once. */
  async enableTwoFactor(
    caller: ICurrentUser,
    code: string,
    facts: RequestFacts,
  ): Promise<TwoFactorEnabledDto> {
    const now = new Date();
    const user = await this.requireUser(caller.id);
    this.assertAccountUsable(user);

    if (user.twofaEnabledAt !== null) {
      throw new ConflictException(ErrorCode.TWOFA_ALREADY_ENABLED);
    }
    if (!this.totpService.verifyEncrypted(user.twofaSecret, code)) {
      await this.attempts.record({
        email: user.email,
        userId: user.id,
        ip: facts.ip,
        userAgent: facts.userAgent,
        outcome: AuthOutcome.TWOFA_FAILED,
        route: AUTH_ROUTES.TWOFA,
      });
      throw new AuthException(ErrorCode.TWOFA_INVALID);
    }

    const recovery = await this.totpService.generateRecoveryCodes();
    await this.users.update(user.id, {
      twofaEnabledAt: now,
      twofaRecoveryCodes: [...recovery.hashes],
    });

    this.events.emit(AUTH_EVENTS.TWOFA_ENABLED, {
      userId: user.id,
      role: user.role,
      ip: facts.ip,
      userAgent: facts.userAgent,
      occurredAt: now,
    });

    // Returned exactly once. Only the hashes were stored, so there is no second
    // chance to see these and no way for an operator to recover them later.
    return { recoveryCodes: [...recovery.codes] };
  }

  /**
   * `POST /auth/2fa/disable` — **rejected for admins** (S-8).
   *
   * "2FA mandatory for Admin, optional for Consumer." An admin asking to turn it off
   * gets `TWOFA_REQUIRED_FOR_ROLE`, before the password is even checked: there is no
   * credential that makes this allowed, so there is nothing to verify.
   */
  async disableTwoFactor(
    caller: ICurrentUser,
    dto: DisableTwoFactorDto,
    facts: RequestFacts,
  ): Promise<AuthAcknowledgementDto> {
    const now = new Date();
    const user = await this.requireUser(caller.id);

    if (isAdmin(user.role)) {
      throw new ForbiddenException(ErrorCode.TWOFA_REQUIRED_FOR_ROLE);
    }

    this.assertAccountUsable(user);

    if (!(await this.passwordService.verify(user.passwordHash, dto.currentPassword))) {
      throw new AuthException(ErrorCode.INVALID_CREDENTIALS);
    }
    if (!this.totpService.verifyEncrypted(user.twofaSecret, dto.code)) {
      throw new AuthException(ErrorCode.TWOFA_INVALID);
    }

    await this.users.update(user.id, {
      twofaSecret: null,
      twofaEnabledAt: null,
      twofaRecoveryCodes: null,
    });

    this.events.emit(AUTH_EVENTS.TWOFA_DISABLED, {
      userId: user.id,
      role: user.role,
      ip: facts.ip,
      userAgent: facts.userAgent,
      occurredAt: now,
    });

    return GENERIC_ACKNOWLEDGEMENT;
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Loads the `twofaPending` session a challenge refers to.
   *
   * The route is `@Public()`, so `SessionAuthGuard` has deliberately *not* populated
   * `request.user` — a pending session is not an authenticated caller. The cookie is
   * read here instead.
   */
  private async loadPendingSession(
    sessionToken: string | undefined,
  ): Promise<{ session: Session; user: AuthUser; now: Date }> {
    const now = new Date();
    if (sessionToken === undefined) {
      throw new AuthException(ErrorCode.AUTH_REQUIRED);
    }

    const session = await this.sessionService.findByToken(sessionToken);
    if (session === null || session.revokedAt !== null) {
      throw new AuthException(ErrorCode.SESSION_INVALID);
    }
    if (this.sessionService.isExpired(session, now)) {
      throw new AuthException(ErrorCode.SESSION_EXPIRED);
    }
    if (!session.twofaPending) {
      // Nothing to complete. Reported as an invalid session rather than "already
      // done", so a replayed challenge reveals nothing.
      throw new AuthException(ErrorCode.SESSION_INVALID);
    }

    const user = await this.requireUser(session.userId);
    this.assertAccountUsable(user);

    return { session, user, now };
  }

  /** Rotates a completed pending session — the second privilege change of a login. */
  private async completePendingSession(
    session: Session,
    user: AuthUser,
    facts: RequestFacts,
    now: Date,
  ): Promise<AuthResult<LoginResponseDto>> {
    const issued = await this.sessionService.rotate(session, {
      user,
      ip: facts.ip,
      userAgent: facts.userAgent,
      now,
    });
    await this.sessionService.markTwoFactorVerified(issued.session, now);

    await this.users.update(user.id, { lastLoginAt: now, lastActiveAt: now });

    await this.attempts.record({
      email: user.email,
      userId: user.id,
      ip: facts.ip,
      userAgent: facts.userAgent,
      outcome: AuthOutcome.SUCCESS,
      route: AUTH_ROUTES.TWOFA,
    });

    return { body: { user: toAuthUserDto(user), twofaRequired: false }, issued };
  }

  private async recordFailedLogin(
    email: string,
    user: AuthUser | null,
    facts: RequestFacts,
  ): Promise<void> {
    await this.attempts.record({
      email,
      userId: user?.id ?? null,
      ip: facts.ip,
      userAgent: facts.userAgent,
      outcome: AuthOutcome.INVALID_CREDENTIALS,
      route: AUTH_ROUTES.LOGIN,
    });

    if (user !== null) {
      // `users.failedLoginCount` mirrors the append-only ledger so an admin can see
      // the state on the account row (A-2). The ledger stays authoritative.
      await this.users.update(user.id, { failedLoginCount: user.failedLoginCount + 1 });
    }
  }

  /**
   * @throws `ACCOUNT_SUSPENDED` (A-19) or `ACCOUNT_DEACTIVATED` (A-2).
   *
   * Never called before a credential has been verified — see `login`.
   */
  private assertAccountUsable(user: AuthUser): void {
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException(ErrorCode.ACCOUNT_SUSPENDED);
    }
    if (user.status === UserStatus.DEACTIVATED) {
      throw new ForbiddenException(ErrorCode.ACCOUNT_DEACTIVATED);
    }
  }

  /** C-38: once deletion is under way nothing more about the account changes. */
  private assertNotBeingDeleted(user: AuthUser): void {
    if (user.deletionRequestedAt !== null) {
      throw new ConflictException(ErrorCode.DELETION_IN_PROGRESS);
    }
  }

  private async requireUser(userId: string): Promise<AuthUser> {
    const user = await this.users.findById(userId);
    if (user === null) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }
    return user;
  }

  private async dispatchEmailVerification(
    user: AuthUser,
    facts: RequestFacts,
    now: Date,
  ): Promise<void> {
    const issued = await this.tokens.issue({
      userId: user.id,
      purpose: VerificationPurpose.EMAIL_VERIFICATION,
      destination: user.email,
      expiresAt: new Date(now.getTime() + this.config.emailVerifyTtlHours * HOUR_MS),
      ip: facts.ip,
    });

    this.dispatchEmail(
      this.notifications.sendTemplatedEmail({
        to: user.email,
        template: TemplateId.VERIFY_EMAIL,
        props: {
          verifyUrl: this.buildWebUrl('/verify-email', issued.token),
          expiresInHours: this.config.emailVerifyTtlHours,
        },
        locale: toNotificationLocale(user.locale),
      }),
      'email verification',
    );
  }

  /**
   * Fire-and-forget delivery.
   *
   * `NotificationsService` never rejects — a provider outage resolves to a failed
   * `SendResult` — so this cannot become an unhandled rejection. Not awaiting it is
   * the point: no endpoint's latency may depend on whether a message was sent, and
   * no sign-in may fail because a mail server was slow (E-11).
   */
  private dispatchEmail(sending: Promise<SendResult>, description: string): void {
    void sending.then((result) => {
      if (!result.ok) {
        this.logger.warn(`${description} could not be delivered`);
      }
    });
  }

  /** Builds a link into the web app. Never a bare token in a query the logs would keep. */
  private buildWebUrl(path: string, token: string): string {
    return `${this.config.webUrl}${path}?token=${encodeURIComponent(token)}`;
  }

  /**
   * S-4. Emitted so the `audit` module writes `SIGNUP_ROLE_IGNORED`, and logged at
   * `warn` so the attempt is visible even before that listener exists. The value is
   * echoed verbatim — it is a client-supplied string, and the audit trail is worth
   * more than tidiness — but it is never used to decide anything.
   */
  private recordIgnoredSignupRole(
    user: AuthUser,
    requestedRole: string,
    facts: RequestFacts,
    now: Date,
  ): void {
    this.logger.warn(
      `signup payload carried role="${requestedRole}"; ignored — account ${user.id} created as ${user.role} (S-4)`,
    );
    this.events.emit(AUTH_EVENTS.SIGNUP_ROLE_IGNORED, {
      userId: user.id,
      role: user.role,
      ip: facts.ip,
      userAgent: facts.userAgent,
      occurredAt: now,
      requestedRole,
      createdRole: user.role,
    });
  }
}
