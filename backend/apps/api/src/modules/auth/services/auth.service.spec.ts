import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { ErrorCode, Role, UserStatus, type AppException, type ICurrentUser } from '@library/common';
import { NotificationsService, TemplateId } from '@library/notifications';

import {
  createTestingModule,
  type TestHarness,
  type InMemoryRepository,
} from '../../../../test/fixtures';
import { FIXED_NOW, freezeClock, minutesFromFixedNow } from '../../../../test/setup/time';
import {
  AUTH_CONFIG,
  REVOKE_REASONS,
  TWOFA_MAX_CHALLENGE_ATTEMPTS,
  USER_DIRECTORY,
} from '../auth.constants';
import { AUTH_EVENTS } from '../auth.events';
import { AuthAttempt } from '../entities/auth-attempt.entity';
import { Session } from '../entities/session.entity';
import { VerificationToken } from '../entities/verification-token.entity';
import { AuthOutcome } from '../enums/auth-outcome.enum';
import { VerificationPurpose } from '../enums/verification-purpose.enum';
import {
  buildAuthUser,
  createFakeUserDirectory,
  createNotificationsDouble,
  testAuthConfig,
  type FakeUserDirectory,
} from '../testing/auth-fixtures';

import { AuthAttemptService } from './auth-attempt.service';
import { AuthService, type RequestFacts } from './auth.service';
import { CsrfService } from './csrf.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';
import { VerificationTokenService } from './verification-token.service';

import type { SignupDto } from '../dto/signup.dto';
import type { AuthUser } from '../interfaces/user-directory.interface';

const FACTS: RequestFacts = { ip: '203.0.113.7', userAgent: 'jest/drape-test' };
const PASSWORD = 'correct-horse-9!';

interface Suite {
  harness: TestHarness;
  service: AuthService;
  directory: FakeUserDirectory;
  sessions: InMemoryRepository<Session>;
  tokens: InMemoryRepository<VerificationToken>;
  attempts: InMemoryRepository<AuthAttempt>;
  notifications: ReturnType<typeof createNotificationsDouble>;
  emit: jest.Mock;
  passwords: PasswordService;
}

async function createSuite(): Promise<Suite> {
  const directory = createFakeUserDirectory();
  const notifications = createNotificationsDouble();
  const emit = jest.fn();

  const harness = await createTestingModule({
    providers: [
      AuthService,
      PasswordService,
      SessionService,
      CsrfService,
      TotpService,
      VerificationTokenService,
      AuthAttemptService,
    ],
    repositories: [Session, VerificationToken, AuthAttempt],
    overrides: [
      { token: AUTH_CONFIG, value: testAuthConfig() },
      { token: USER_DIRECTORY, value: directory },
      { token: NotificationsService, value: notifications },
      { token: EventEmitter2, value: { emit } },
    ],
  });

  return {
    harness,
    service: harness.get(AuthService),
    directory,
    sessions: harness.repository<Session>(Session),
    tokens: harness.repository<VerificationToken>(VerificationToken),
    attempts: harness.repository<AuthAttempt>(AuthAttempt),
    notifications,
    emit,
    passwords: harness.get(PasswordService),
  };
}

function signupPayload(overrides: Partial<SignupDto> = {}): SignupDto {
  return {
    name: 'Ayesha Khan',
    email: 'ayesha@example.invalid',
    password: PASSWORD,
    phone: '+923001234567',
    ...overrides,
  };
}

/** Serialises a thrown `AppException` the way the client would receive it. */
async function capture(action: Promise<unknown>): Promise<string> {
  try {
    await action;
    throw new Error('expected the call to reject');
  } catch (error) {
    const exception = error as AppException;
    return JSON.stringify({
      status: exception.getStatus(),
      ...exception.getAppPayload(),
    });
  }
}

describe('AuthService', () => {
  let suite: Suite;

  beforeEach(async () => {
    freezeClock(FIXED_NOW);
    suite = await createSuite();
  });

  afterEach(async () => {
    await suite.harness.close();
  });

  /* -------------------------------------------------------------------- */
  /* S-4 — signup creates Consumers, and nothing else                      */
  /* -------------------------------------------------------------------- */

  describe('signup (S-4, C-2)', () => {
    it('creates a CONSUMER', async () => {
      const result = await suite.service.signup(signupPayload(), FACTS);

      expect(result.body.role).toBe(Role.CONSUMER);
      expect(suite.directory.rows[0].role).toBe(Role.CONSUMER);
    });

    it('creates a CONSUMER when the payload asks for an admin, and logs the attempt', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const result = await suite.service.signup(signupPayload({ role: 'admin' }), FACTS);

      // 1. The account really is a consumer, in the response and in the store.
      expect(result.body.role).toBe(Role.CONSUMER);
      expect(suite.directory.rows).toHaveLength(1);
      expect(suite.directory.rows[0].role).toBe(Role.CONSUMER);
      expect(suite.directory.rows.some((user) => user.role === Role.ADMIN)).toBe(false);

      // 2. The attempt is audited, not rejected: SIGNUP_ROLE_IGNORED (§4.30).
      expect(suite.emit).toHaveBeenCalledWith(
        AUTH_EVENTS.SIGNUP_ROLE_IGNORED,
        expect.objectContaining({
          userId: result.body.id,
          requestedRole: 'admin',
          createdRole: Role.CONSUMER,
          ip: FACTS.ip,
        }),
      );

      // 3. And it is visible in the log before the audit module exists.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('role="admin"'));
    });

    it.each([['ADMIN'], ['Admin'], ['aDmIn'], ['  admin  '], ['ADMIN\n']])(
      'ignores role=%p however it is cased or padded',
      async (role) => {
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

        const result = await suite.service.signup(signupPayload({ role }), FACTS);

        expect(result.body.role).toBe(Role.CONSUMER);
      },
    );

    it('never even offers the seam a role to set', async () => {
      await suite.service.signup(signupPayload({ role: 'admin' }), FACTS);

      const [input] = suite.directory.createConsumer.mock.calls[0];
      expect(input).not.toHaveProperty('role');
    });

    it('does not audit anything when no role was sent', async () => {
      await suite.service.signup(signupPayload(), FACTS);

      expect(suite.emit).not.toHaveBeenCalledWith(
        AUTH_EVENTS.SIGNUP_ROLE_IGNORED,
        expect.anything(),
      );
    });

    it('signs the new consumer in and sends the verification email (C-3)', async () => {
      const result = await suite.service.signup(signupPayload(), FACTS);

      expect(result.issued?.session.role).toBe(Role.CONSUMER);
      expect(result.issued?.session.twofaPending).toBe(false);
      expect(suite.notifications.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({ template: TemplateId.VERIFY_EMAIL }),
      );
    });

    it('stores an Argon2id hash and never the password (S-6)', async () => {
      await suite.service.signup(signupPayload(), FACTS);

      const stored = suite.directory.rows[0].passwordHash;
      expect(stored.startsWith('$argon2id$')).toBe(true);
      await expect(suite.passwords.verify(stored, PASSWORD)).resolves.toBe(true);
      expect(JSON.stringify(suite.directory.rows)).not.toContain(PASSWORD);
    });

    it('rejects a password that fails the S-6 policy', async () => {
      await expect(
        suite.service.signup(signupPayload({ password: 'short1!' }), FACTS),
      ).rejects.toMatchObject({ errorCode: ErrorCode.PASSWORD_POLICY_VIOLATION });
      expect(suite.directory.rows).toHaveLength(0);
    });

    it('refuses a duplicate address and a duplicate phone number', async () => {
      await suite.service.signup(signupPayload(), FACTS);

      await expect(suite.service.signup(signupPayload(), FACTS)).rejects.toMatchObject({
        errorCode: ErrorCode.EMAIL_ALREADY_EXISTS,
      });
      await expect(
        suite.service.signup(signupPayload({ email: 'other@example.invalid' }), FACTS),
      ).rejects.toMatchObject({ errorCode: ErrorCode.PHONE_ALREADY_EXISTS });
    });
  });

  /* -------------------------------------------------------------------- */
  /* S-6 — nothing enumerates accounts                                     */
  /* -------------------------------------------------------------------- */

  describe('login (S-6)', () => {
    async function seedUser(overrides: Partial<AuthUser> = {}): Promise<AuthUser> {
      const user = buildAuthUser({
        email: 'ayesha@example.invalid',
        passwordHash: await suite.passwords.hash(PASSWORD),
        ...overrides,
      });
      suite.directory.rows.push(user);
      return user;
    }

    it('returns a byte-identical error for an unknown account and a wrong password', async () => {
      await seedUser();

      const unknownAccount = await capture(
        suite.service.login('nobody@example.invalid', PASSWORD, FACTS),
      );
      const wrongPassword = await capture(
        suite.service.login('ayesha@example.invalid', 'not-the-password-1!', FACTS),
      );

      expect(unknownAccount).toBe(wrongPassword);
      expect(JSON.parse(unknownAccount)).toMatchObject({
        errorCode: ErrorCode.INVALID_CREDENTIALS,
        status: 401,
      });
    });

    it('does the same Argon2 work when the account does not exist, so timing tells nothing', async () => {
      const verifyDummy = jest.spyOn(suite.passwords, 'verifyDummy');
      const verify = jest.spyOn(suite.passwords, 'verify');

      await capture(suite.service.login('nobody@example.invalid', PASSWORD, FACTS));

      expect(verifyDummy).toHaveBeenCalledTimes(1);
      // `verifyDummy` delegates to `verify` with a genuine Argon2id hash.
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0][0].startsWith('$argon2id$')).toBe(true);
    });

    it('records the failure against the address and the IP either way (S-6)', async () => {
      await seedUser();
      await capture(suite.service.login('nobody@example.invalid', PASSWORD, FACTS));
      await capture(suite.service.login('ayesha@example.invalid', 'wrong-one-1!', FACTS));

      expect(suite.attempts.$rows).toHaveLength(2);
      expect(
        suite.attempts.$rows.every(
          (row) => row.outcome === AuthOutcome.INVALID_CREDENTIALS && row.route === 'LOGIN',
        ),
      ).toBe(true);
    });

    it('signs a healthy consumer in and rotates nothing it should not', async () => {
      const user = await seedUser();

      const result = await suite.service.login(user.email, PASSWORD, FACTS);

      expect(result.body.twofaRequired).toBe(false);
      expect(result.body.user?.id).toBe(user.id);
      expect(result.issued?.session.userId).toBe(user.id);
      expect(user.failedLoginCount).toBe(0);
      expect(user.lastLoginAt).toEqual(FIXED_NOW);
    });

    it('clears a stale failure count on success', async () => {
      const user = await seedUser({ failedLoginCount: 3 });

      await suite.service.login(user.email, PASSWORD, FACTS);

      expect(user.failedLoginCount).toBe(0);
      expect(user.lockedUntil).toBeNull();
    });

    it('only discloses a suspension after the password is proved (A-19)', async () => {
      const user = await seedUser({ status: UserStatus.SUSPENDED });

      // Wrong password: the generic answer, with no hint the account is on hold.
      const wrong = await capture(suite.service.login(user.email, 'wrong-one-1!', FACTS));
      expect(JSON.parse(wrong)).toMatchObject({ errorCode: ErrorCode.INVALID_CREDENTIALS });

      // Right password: now it is safe to say.
      await expect(suite.service.login(user.email, PASSWORD, FACTS)).rejects.toMatchObject({
        errorCode: ErrorCode.ACCOUNT_SUSPENDED,
      });
    });

    it('refuses a deactivated account once the password is proved (A-2)', async () => {
      const user = await seedUser({ status: UserStatus.DEACTIVATED });

      await expect(suite.service.login(user.email, PASSWORD, FACTS)).rejects.toMatchObject({
        errorCode: ErrorCode.ACCOUNT_DEACTIVATED,
      });
    });

    /**
     * **C-38 — a deletion-pending account cannot be signed back into (H7).**
     *
     * `login` checked only the *status*, and status is a column an admin can move: suspend
     * takes a `DEACTIVATED` deletion-pending account to `SUSPENDED`, and unsuspend then
     * sets it `ACTIVE`. `AdminConsumersService` now refuses both halves of that, and this is
     * the second lock — `deletionRequestedAt` is the durable fact, and `changePassword` and
     * `setupTwoFactor` were already checking it while the front door was not.
     */
    it('refuses an account whose deletion has been requested, whatever its status', async () => {
      const user = await seedUser({
        status: UserStatus.ACTIVE,
        deletionRequestedAt: new Date('2026-08-01T00:00:00.000Z'),
      });

      await expect(suite.service.login(user.email, PASSWORD, FACTS)).rejects.toMatchObject({
        errorCode: ErrorCode.DELETION_IN_PROGRESS,
      });
    });

    it('holds an account with 2FA in twofaPending and returns nothing about it (S-8)', async () => {
      const user = await seedUser({ twofaEnabledAt: FIXED_NOW, twofaSecret: 'v1.a.b.c' });

      const result = await suite.service.login(user.email, PASSWORD, FACTS);

      expect(result.body.twofaRequired).toBe(true);
      expect(result.body.user).toBeNull();
      expect(result.issued?.session.twofaPending).toBe(true);
    });

    it('locks out after the threshold, with the same copy whoever is asking', async () => {
      await seedUser();

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await capture(suite.service.login('ayesha@example.invalid', 'wrong-one-1!', FACTS));
      }

      // `createdAt` is a @CreateDateColumn: PostgreSQL fills it, the in-memory
      // repository does not (it emulates a repository, not a database). Stamping it
      // is what the ORM would have done, and the lockout window is read from it.
      for (const row of suite.attempts.$rows) {
        row.createdAt ??= FIXED_NOW;
      }

      const known = await capture(suite.service.login('ayesha@example.invalid', PASSWORD, FACTS));
      const unknown = await capture(suite.service.login('nobody@example.invalid', PASSWORD, FACTS));

      expect(JSON.parse(known)).toMatchObject({ errorCode: ErrorCode.ACCOUNT_LOCKED });
      expect(known).toBe(unknown);
    });
  });

  describe('password reset (S-6)', () => {
    async function seedUser(overrides: Partial<AuthUser> = {}): Promise<AuthUser> {
      const user = buildAuthUser({
        email: 'ayesha@example.invalid',
        passwordHash: await suite.passwords.hash(PASSWORD),
        ...overrides,
      });
      suite.directory.rows.push(user);
      return user;
    }

    it('returns a byte-identical body for a known and an unknown address', async () => {
      await seedUser();

      const known = await suite.service.requestPasswordReset('ayesha@example.invalid', FACTS);
      const unknown = await suite.service.requestPasswordReset('nobody@example.invalid', FACTS);

      expect(JSON.stringify(known)).toBe(JSON.stringify(unknown));
      expect(known).toEqual({ accepted: true });
    });

    it('emails only the address that has an account', async () => {
      await seedUser();

      await suite.service.requestPasswordReset('nobody@example.invalid', FACTS);
      expect(suite.notifications.sendTemplatedEmail).not.toHaveBeenCalled();

      await suite.service.requestPasswordReset('ayesha@example.invalid', FACTS);
      expect(suite.notifications.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'ayesha@example.invalid',
          template: TemplateId.PASSWORD_RESET,
          props: expect.objectContaining({ expiresInMinutes: 30 }),
        }),
      );
    });

    it('does not wait for the mail server, so latency cannot leak either', async () => {
      await seedUser();
      let settle: (() => void) | undefined;
      suite.notifications.sendTemplatedEmail.mockReturnValueOnce(
        new Promise<{ ok: boolean }>((resolve) => {
          settle = (): void => resolve({ ok: true });
        }),
      );

      // Resolves while the send is still outstanding.
      await expect(
        suite.service.requestPasswordReset('ayesha@example.invalid', FACTS),
      ).resolves.toEqual({ accepted: true });

      settle?.();
    });

    it('issues a single-use token with the 30-minute TTL', async () => {
      const user = await seedUser();

      await suite.service.requestPasswordReset(user.email, FACTS);

      const [row] = suite.tokens.$rows;
      expect(row.purpose).toBe(VerificationPurpose.PASSWORD_RESET);
      expect(row.consumedAt).toBeNull();
      expect(row.expiresAt).toEqual(minutesFromFixedNow(30));
    });

    it('sends nothing for a suspended account, and still says the same thing', async () => {
      await seedUser({ status: UserStatus.SUSPENDED });

      const body = await suite.service.requestPasswordReset('ayesha@example.invalid', FACTS);

      expect(body).toEqual({ accepted: true });
      expect(suite.notifications.sendTemplatedEmail).not.toHaveBeenCalled();
    });

    it('consumes the token, sets the password and revokes every session', async () => {
      const user = await seedUser();
      const issued = await suite.service.requestPasswordReset(user.email, FACTS);
      expect(issued).toEqual({ accepted: true });

      const emailed = suite.notifications.sendTemplatedEmail.mock.calls[0][0] as {
        props: { resetUrl: string };
      };
      const token = new URL(emailed.props.resetUrl).searchParams.get('token') as string;

      // Two live sessions, both of which must die (S-6).
      const first = await suite.service.login(user.email, PASSWORD, FACTS);
      const second = await suite.service.login(user.email, PASSWORD, FACTS);

      await suite.service.resetPassword(token, 'a-brand-new-one-7!', FACTS);

      await expect(suite.passwords.verify(user.passwordHash, 'a-brand-new-one-7!')).resolves.toBe(
        true,
      );
      for (const sessionId of [first.issued?.session.id, second.issued?.session.id]) {
        const row = suite.sessions.$rows.find((candidate) => candidate.id === sessionId);
        expect(row?.revokedAt).toEqual(FIXED_NOW);
        expect(row?.revokedReason).toBe(REVOKE_REASONS.PASSWORD_CHANGED);
      }

      // Single use.
      await expect(
        suite.service.resetPassword(token, 'another-new-one-8!', FACTS),
      ).rejects.toMatchObject({ errorCode: ErrorCode.TOKEN_ALREADY_USED });
    });

    it('enforces the password policy on the new password', async () => {
      await expect(suite.service.resetPassword('whatever', 'weak', FACTS)).rejects.toMatchObject({
        errorCode: ErrorCode.PASSWORD_POLICY_VIOLATION,
      });
    });
  });

  /* -------------------------------------------------------------------- */
  /* Privilege changes rotate the session                                  */
  /* -------------------------------------------------------------------- */

  describe('changePassword (C-7)', () => {
    async function signedIn(): Promise<{ user: AuthUser; sessionId: string; token: string }> {
      const user = buildAuthUser({
        email: 'ayesha@example.invalid',
        passwordHash: await suite.passwords.hash(PASSWORD),
      });
      suite.directory.rows.push(user);
      const login = await suite.service.login(user.email, PASSWORD, FACTS);
      return {
        user,
        sessionId: login.issued?.session.id as string,
        token: login.issued?.token as string,
      };
    }

    function caller(user: AuthUser, sessionId: string): ICurrentUser {
      return {
        id: user.id,
        role: user.role,
        email: user.email,
        name: user.name,
        status: user.status,
        emailVerifiedAt: user.emailVerifiedAt,
        phoneVerifiedAt: user.phoneVerifiedAt,
        sessionId,
        locale: user.locale,
      };
    }

    it('rotates the session and revokes the others', async () => {
      const { user, sessionId } = await signedIn();
      const other = await suite.service.login(user.email, PASSWORD, FACTS);

      const result = await suite.service.changePassword(
        caller(user, sessionId),
        { currentPassword: PASSWORD, newPassword: 'a-brand-new-one-7!' },
        FACTS,
      );

      expect(result.issued?.session.id).not.toBe(sessionId);
      const rotated = suite.sessions.$rows.find((row) => row.id === sessionId);
      expect(rotated?.revokedReason).toBe(REVOKE_REASONS.ROTATED);
      const revokedOther = suite.sessions.$rows.find((row) => row.id === other.issued?.session.id);
      expect(revokedOther?.revokedReason).toBe(REVOKE_REASONS.PASSWORD_CHANGED);
    });

    it('refuses a wrong current password with the generic code', async () => {
      const { user, sessionId } = await signedIn();

      await expect(
        suite.service.changePassword(
          caller(user, sessionId),
          { currentPassword: 'not-it-1!', newPassword: 'a-brand-new-one-7!' },
          FACTS,
        ),
      ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_CREDENTIALS });
    });

    it('refuses once account deletion is under way (C-38)', async () => {
      const { user, sessionId } = await signedIn();
      user.deletionRequestedAt = FIXED_NOW;

      await expect(
        suite.service.changePassword(
          caller(user, sessionId),
          { currentPassword: PASSWORD, newPassword: 'a-brand-new-one-7!' },
          FACTS,
        ),
      ).rejects.toMatchObject({ errorCode: ErrorCode.DELETION_IN_PROGRESS });
    });
  });

  describe('two-factor completion (S-8)', () => {
    it('rotates the pending session and clears twofaPending', async () => {
      const totp = suite.harness.get<TotpService>(TotpService);
      const enrolment = totp.enrol('admin@example.invalid');
      const user = buildAuthUser({
        role: Role.ADMIN,
        email: 'admin@example.invalid',
        passwordHash: await suite.passwords.hash(PASSWORD),
        twofaSecret: enrolment.encryptedSecret,
        twofaEnabledAt: FIXED_NOW,
      });
      suite.directory.rows.push(user);

      const login = await suite.service.login(user.email, PASSWORD, FACTS);
      const pendingId = login.issued?.session.id as string;

      const { authenticator } = await import('otplib');
      const code = authenticator.clone({}).generate(enrolment.secret);

      const completed = await suite.service.completeTwoFactorChallenge(
        login.issued?.token,
        code,
        FACTS,
      );

      expect(completed.body.twofaRequired).toBe(false);
      expect(completed.body.user?.id).toBe(user.id);
      expect(completed.issued?.session.id).not.toBe(pendingId);
      expect(completed.issued?.session.twofaPending).toBe(false);
      expect(completed.issued?.session.twofaVerifiedAt).toEqual(FIXED_NOW);
      expect(suite.sessions.$rows.find((row) => row.id === pendingId)?.revokedReason).toBe(
        REVOKE_REASONS.ROTATED,
      );
    });

    it('rejects a wrong code with TWOFA_INVALID and records the attempt', async () => {
      const totp = suite.harness.get<TotpService>(TotpService);
      const enrolment = totp.enrol('admin@example.invalid');
      const user = buildAuthUser({
        role: Role.ADMIN,
        email: 'admin@example.invalid',
        passwordHash: await suite.passwords.hash(PASSWORD),
        twofaSecret: enrolment.encryptedSecret,
        twofaEnabledAt: FIXED_NOW,
      });
      suite.directory.rows.push(user);
      const login = await suite.service.login(user.email, PASSWORD, FACTS);

      await expect(
        suite.service.completeTwoFactorChallenge(login.issued?.token, '000000', FACTS),
      ).rejects.toMatchObject({ errorCode: ErrorCode.TWOFA_INVALID });
      expect(suite.attempts.$rows.some((row) => row.outcome === AuthOutcome.TWOFA_FAILED)).toBe(
        true,
      );
    });

    /* ---------------------------------------------------------------------------------------
     * S-6 — the second factor is a credential, so it gets a credential's backoff
     * ------------------------------------------------------------------------------------ */

    /**
     * `completeTwoFactorChallenge` recorded `TWOFA_FAILED` and never read it back, and
     * `assertNotLockedOut` was called on exactly one path: password login. The only limiter
     * left on the challenge was `@Throttle(5/60s)` — and because `UserThrottlerGuard` runs
     * *before* `SessionAuthGuard` on a `@Public()` route, its tracker is the **IP**. TOTP
     * tolerance is ±1 step, so three of a million codes are live at any instant; an attacker
     * holding a stolen password sprayed from a proxy pool with no backoff, no account lock and
     * nothing written anywhere a human would look, and the second factor fell inside a day.
     *
     * Two independent bounds now apply, and each of these tests fails without one of them.
     */
    describe('the challenge is rate-limited per account, not per address', () => {
      /** An enrolled admin, signed in as far as the pending session. */
      async function pendingAdmin(): Promise<{ user: AuthUser; token: string; sessionId: string }> {
        const totp = suite.harness.get<TotpService>(TotpService);
        const enrolment = totp.enrol('admin@example.invalid');
        const user = buildAuthUser({
          role: Role.ADMIN,
          email: 'admin@example.invalid',
          passwordHash: await suite.passwords.hash(PASSWORD),
          twofaSecret: enrolment.encryptedSecret,
          twofaEnabledAt: FIXED_NOW,
        });
        suite.directory.rows.push(user);

        const login = await suite.service.login(user.email, PASSWORD, FACTS);

        return {
          user,
          token: login.issued?.token as string,
          sessionId: login.issued?.session.id as string,
        };
      }

      /**
       * One wrong code, a second later.
       *
       * The clock moves because the lockout reads `auth_attempts.createdAt` newest-first;
       * a run of attempts sharing one timestamp has no "newest", which is a property of a
       * frozen clock and not of the code under test.
       */
      async function guessWrong(token: string | undefined, ip = FACTS.ip): Promise<string> {
        jest.setSystemTime(new Date(Date.now() + 1_000));
        return capture(
          suite.service.completeTwoFactorChallenge(token, '000000', {
            ip,
            userAgent: FACTS.userAgent,
          }),
        );
      }

      it(`revokes the pending session after ${TWOFA_MAX_CHALLENGE_ATTEMPTS} wrong codes`, async () => {
        const { token, sessionId } = await pendingAdmin();

        for (let attempt = 0; attempt < TWOFA_MAX_CHALLENGE_ATTEMPTS; attempt += 1) {
          expect(JSON.parse(await guessWrong(token))).toMatchObject({
            errorCode: ErrorCode.TWOFA_INVALID,
          });
        }

        const row = suite.sessions.$rows.find((candidate) => candidate.id === sessionId);
        expect(row?.revokedAt).not.toBeNull();
        expect(row?.revokedReason).toBe(REVOKE_REASONS.TWOFA_FAILED);
      });

      it('tells the attacker nothing — the cap is announced only to the operator', async () => {
        const { user, token, sessionId } = await pendingAdmin();

        for (let attempt = 0; attempt < TWOFA_MAX_CHALLENGE_ATTEMPTS; attempt += 1) {
          await guessWrong(token);
        }

        // Same code and same copy on the attempt that locked as on the first one.
        expect(suite.emit).toHaveBeenCalledWith(
          AUTH_EVENTS.TWOFA_CHALLENGE_LOCKED,
          expect.objectContaining({
            userId: user.id,
            sessionId,
            failureCount: TWOFA_MAX_CHALLENGE_ATTEMPTS,
          }),
        );
      });

      it('forces the password step again — the dead session cannot be challenged further', async () => {
        const { token } = await pendingAdmin();

        for (let attempt = 0; attempt < TWOFA_MAX_CHALLENGE_ATTEMPTS; attempt += 1) {
          await guessWrong(token);
        }

        expect(JSON.parse(await guessWrong(token))).toMatchObject({
          errorCode: ErrorCode.SESSION_INVALID,
        });
      });

      it('locks the account, so a fresh session from a new IP is refused too', async () => {
        const { user, token } = await pendingAdmin();

        for (let attempt = 0; attempt < TWOFA_MAX_CHALLENGE_ATTEMPTS; attempt += 1) {
          await guessWrong(token);
        }

        // A proxy rotation buys a new address and a new pending session. Neither helps:
        // the S-6 counter is keyed by the account, which is the thing being attacked.
        const sessions = suite.harness.get<SessionService>(SessionService);
        const fresh = await sessions.issue({
          user,
          ip: '198.51.100.9',
          userAgent: null,
          twofaPending: true,
          now: new Date(),
        });

        expect(JSON.parse(await guessWrong(fresh.token, '198.51.100.9'))).toMatchObject({
          errorCode: ErrorCode.ACCOUNT_LOCKED,
        });
      });

      it('leaves an honest first attempt alone', async () => {
        const { token } = await pendingAdmin();

        expect(JSON.parse(await guessWrong(token))).toMatchObject({
          errorCode: ErrorCode.TWOFA_INVALID,
        });
        expect(suite.emit).not.toHaveBeenCalledWith(
          AUTH_EVENTS.TWOFA_CHALLENGE_LOCKED,
          expect.anything(),
        );
      });

      it('applies the same cap to recovery codes, which are guessable too', async () => {
        const { token, sessionId } = await pendingAdmin();

        for (let attempt = 0; attempt < TWOFA_MAX_CHALLENGE_ATTEMPTS; attempt += 1) {
          jest.setSystemTime(new Date(Date.now() + 1_000));
          await capture(suite.service.completeRecovery(token, 'AAAA-BBBB-CCCC', FACTS));
        }

        const row = suite.sessions.$rows.find((candidate) => candidate.id === sessionId);
        expect(row?.revokedReason).toBe(REVOKE_REASONS.TWOFA_FAILED);
      });
    });

    it('refuses a challenge with no session cookie', async () => {
      await expect(
        suite.service.completeTwoFactorChallenge(undefined, '000000', FACTS),
      ).rejects.toMatchObject({ errorCode: ErrorCode.AUTH_REQUIRED });
    });

    it('refuses to re-run a challenge on a completed session', async () => {
      const user = buildAuthUser({
        email: 'ayesha@example.invalid',
        passwordHash: await suite.passwords.hash(PASSWORD),
      });
      suite.directory.rows.push(user);
      const login = await suite.service.login(user.email, PASSWORD, FACTS);

      await expect(
        suite.service.completeTwoFactorChallenge(login.issued?.token, '000000', FACTS),
      ).rejects.toMatchObject({ errorCode: ErrorCode.SESSION_INVALID });
    });
  });

  describe('disableTwoFactor (S-8)', () => {

    function callerFor(user: AuthUser): ICurrentUser {
      return {
        id: user.id,
        role: user.role,
        email: user.email,
        name: user.name,
        status: user.status,
        emailVerifiedAt: user.emailVerifiedAt,
        phoneVerifiedAt: user.phoneVerifiedAt,
        sessionId: 'session',
        locale: user.locale,
      };
    }

    /** An enrolled admin, plus a live code for the secret they actually hold. */
    async function seedEnrolledAdmin(): Promise<{ user: AuthUser; code: string }> {
      const totp = suite.harness.get<TotpService>(TotpService);
      const enrolment = totp.enrol('admin@example.invalid');
      const user = buildAuthUser({
        role: Role.ADMIN,
        email: 'admin@example.invalid',
        passwordHash: await suite.passwords.hash(PASSWORD),
        twofaSecret: enrolment.encryptedSecret,
        twofaEnabledAt: FIXED_NOW,
        twofaRecoveryCodes: ['hash'],
      });
      suite.directory.rows.push(user);

      const { authenticator } = await import('otplib');
      return { user, code: authenticator.clone({}).generate(enrolment.secret) };
    }

    it('turns it off for an admin once the password and the code both check out', async () => {
      const { user, code } = await seedEnrolledAdmin();

      await expect(
        suite.service.disableTwoFactor(callerFor(user), { currentPassword: PASSWORD, code }, FACTS),
      ).resolves.toBeDefined();

      expect(suite.directory.rows.find((row) => row.id === user.id)).toMatchObject({
        twofaEnabledAt: null,
        twofaSecret: null,
        twofaRecoveryCodes: null,
      });
    });

    it('refuses an admin holding the wrong password', async () => {
      const { user, code } = await seedEnrolledAdmin();

      await expect(
        suite.service.disableTwoFactor(
          callerFor(user),
          { currentPassword: 'not-the-password-1!', code },
          FACTS,
        ),
      ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_CREDENTIALS });
    });

    it('refuses an admin holding the wrong code', async () => {
      const { user } = await seedEnrolledAdmin();

      await expect(
        suite.service.disableTwoFactor(
          callerFor(user),
          { currentPassword: PASSWORD, code: '000000' },
          FACTS,
        ),
      ).rejects.toMatchObject({ errorCode: ErrorCode.TWOFA_INVALID });
    });
  });
});
