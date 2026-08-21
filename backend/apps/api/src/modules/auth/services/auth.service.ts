import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AuthException,
  ConflictException,
  ErrorCode,
  ForbiddenException,
  Locale,
  NotFoundException,
  UserStatus,
  ValidationException,
  type ICurrentUser,
} from '@library/common';
import { NotificationsService, TemplateId } from '@library/notifications';
import type { SendResult } from '@library/notifications';

import { SettingsService } from '@api/modules/settings/services/settings.service';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import {
  AUTH_CONFIG,
  AUTH_ROUTES,
  REVOKE_REASONS,
  TWOFA_MAX_CHALLENGE_ATTEMPTS,
  USER_DIRECTORY,
} from '../auth.constants';
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

export interface RequestFacts {
  readonly ip: string;
  readonly userAgent: string | null;
}

export interface AuthResult<T> {
  readonly body: T;
  readonly issued?: IssuedSession;
  readonly clearCookies?: boolean;
}

const GENERIC_ACKNOWLEDGEMENT: Readonly<AuthAcknowledgementDto> = Object.freeze({
  accepted: true,
});

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

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
    private readonly settings: SettingsService,
  ) {}

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
      throw new ConflictException(ErrorCode.EMAIL_ALREADY_EXISTS);
    }

    if (await this.users.existsByPhone(dto.phone)) {
      throw new ConflictException(ErrorCode.PHONE_ALREADY_EXISTS);
    }

    const requiresApproval = await this.settings.getBoolean(
      SETTINGS_KEYS.AUTH_REQUIRE_ADMIN_APPROVAL,
    );

    const user = await this.users.createConsumer({
      email,
      name: dto.name.trim(),
      passwordHash: await this.passwordService.hash(dto.password),
      phone: dto.phone,
      locale: dto.locale ?? Locale.EN,
      status: requiresApproval ? UserStatus.PENDING_APPROVAL : UserStatus.ACTIVE,
    });

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

    if (requiresApproval) {
      return { body: toAuthUserDto(user) };
    }

    const issued = await this.sessionService.issue({
      user,
      ip: facts.ip,
      userAgent: facts.userAgent,
      twofaPending: false,
      now,
    });

    return { body: toAuthUserDto(user), issued };
  }

  async login(
    email: string,
    password: string,
    facts: RequestFacts,
  ): Promise<AuthResult<LoginResponseDto>> {
    const now = new Date();
    const normalisedEmail = email.trim().toLowerCase();

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

    this.assertAccountUsable(user);
    this.assertNotBeingDeleted(user);

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
      body: { user: twofaRequired ? null : toAuthUserDto(user), twofaRequired },
      issued,
    };
  }

  async completeTwoFactorChallenge(
    sessionToken: string | undefined,
    code: string,
    facts: RequestFacts,
  ): Promise<AuthResult<LoginResponseDto>> {
    const { session, user, now } = await this.loadPendingSession(sessionToken, facts);

    if (!this.totpService.verifyEncrypted(user.twofaSecret, code)) {
      await this.recordChallengeFailure(session, user, facts, now);
      throw new AuthException(ErrorCode.TWOFA_INVALID);
    }

    return this.completePendingSession(session, user, facts, now);
  }

  async completeRecovery(
    sessionToken: string | undefined,
    recoveryCode: string,
    facts: RequestFacts,
  ): Promise<AuthResult<LoginResponseDto>> {
    const { session, user, now } = await this.loadPendingSession(sessionToken, facts);

    const stored = user.twofaRecoveryCodes ?? [];
    const index = await this.totpService.findRecoveryCodeIndex(stored, recoveryCode);

    if (index === -1) {
      await this.recordChallengeFailure(session, user, facts, now);
      throw new AuthException(ErrorCode.TWOFA_INVALID);
    }

    const remaining = stored.filter((_hash, position) => position !== index);
    await this.users.update(user.id, { twofaRecoveryCodes: remaining });

    return this.completePendingSession(session, user, facts, now);
  }

  async me(caller: ICurrentUser): Promise<AuthUserDto> {
    const user = await this.requireUser(caller.id);
    return toAuthUserDto(user);
  }

  async logout(caller: ICurrentUser): Promise<AuthResult<AuthAcknowledgementDto>> {
    const now = new Date();
    const session = await this.sessionService.findById(caller.sessionId);
    if (session !== null) {
      await this.sessionService.revoke(session, REVOKE_REASONS.LOGOUT, now);
    }
    return { body: GENERIC_ACKNOWLEDGEMENT, clearCookies: true };
  }

  async listSessions(caller: ICurrentUser): Promise<SessionSummaryDto[]> {
    const sessions = await this.sessionService.listActive(caller.id, new Date());
    return sessions.map((session) => toSessionSummaryDto(session, caller.sessionId));
  }

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
      clearCookies: session.id === caller.sessionId,
    };
  }

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

    return GENERIC_ACKNOWLEDGEMENT;
  }

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

  async requestEmailVerification(
    caller: ICurrentUser,
    facts: RequestFacts,
  ): Promise<AuthAcknowledgementDto> {
    const now = new Date();
    const user = await this.requireUser(caller.id);

    if (user.emailVerifiedAt === null) {
      await this.dispatchEmailVerification(user, facts, now);
    }

    return GENERIC_ACKNOWLEDGEMENT;
  }

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

    return { recoveryCodes: [...recovery.codes] };
  }

  async disableTwoFactor(
    caller: ICurrentUser,
    dto: DisableTwoFactorDto,
    facts: RequestFacts,
  ): Promise<AuthAcknowledgementDto> {
    const now = new Date();
    const user = await this.requireUser(caller.id);

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

  private async loadPendingSession(
    sessionToken: string | undefined,
    facts: RequestFacts,
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
      throw new AuthException(ErrorCode.SESSION_INVALID);
    }

    const user = await this.requireUser(session.userId);
    this.assertAccountUsable(user);

    await this.attempts.assertNotLockedOut(
      user.email,
      facts.ip,
      now,
      this.config.lockoutThreshold,
      this.config.lockoutMaxMinutes,
    );

    return { session, user, now };
  }

  private async recordChallengeFailure(
    session: Session,
    user: AuthUser,
    facts: RequestFacts,
    now: Date,
  ): Promise<void> {
    await this.attempts.record({
      email: user.email,
      userId: user.id,
      ip: facts.ip,
      userAgent: facts.userAgent,
      outcome: AuthOutcome.TWOFA_FAILED,
      route: AUTH_ROUTES.TWOFA,
    });

    const failures = await this.attempts.countTwoFactorFailures(user.email, now);
    if (failures < TWOFA_MAX_CHALLENGE_ATTEMPTS) {
      return;
    }

    await this.sessionService.revoke(session, REVOKE_REASONS.TWOFA_FAILED, now);

    this.logger.warn(
      `two-factor challenge failed ${failures} times for user ${user.id}; pending session revoked (S-6, S-8)`,
    );
    this.events.emit(AUTH_EVENTS.TWOFA_CHALLENGE_LOCKED, {
      userId: user.id,
      role: user.role,
      ip: facts.ip,
      userAgent: facts.userAgent,
      occurredAt: now,
      failureCount: failures,
      sessionId: session.id,
    });
  }

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
      await this.users.update(user.id, { failedLoginCount: user.failedLoginCount + 1 });
    }
  }

  private assertAccountUsable(user: AuthUser): void {
    if (user.status === UserStatus.PENDING_APPROVAL) {
      throw new ForbiddenException(ErrorCode.ACCOUNT_PENDING_APPROVAL);
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException(ErrorCode.ACCOUNT_SUSPENDED);
    }
    if (user.status === UserStatus.DEACTIVATED) {
      throw new ForbiddenException(ErrorCode.ACCOUNT_DEACTIVATED);
    }
  }

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

  private dispatchEmail(sending: Promise<SendResult>, description: string): void {
    void sending.then((result) => {
      if (!result.ok) {
        this.logger.warn(`${description} could not be delivered`);
      }
    });
  }

  private buildWebUrl(path: string, token: string): string {
    return `${this.config.webUrl}${path}?token=${encodeURIComponent(token)}`;
  }

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
