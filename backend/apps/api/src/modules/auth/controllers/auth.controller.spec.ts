import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { CSRF_HEADER_NAME, Role } from '@library/common';
import { NotificationsService } from '@library/notifications';

import { SettingsService } from '@api/modules/settings/services/settings.service';

import { createTestingModule, type TestHarness } from '../../../../test/fixtures';
import { FIXED_NOW, freezeClock } from '../../../../test/setup/time';
import { AUTH_CONFIG, USER_DIRECTORY } from '../auth.constants';
import { AUTH_EVENTS } from '../auth.events';
import { AuthAttempt } from '../entities/auth-attempt.entity';
import { Session } from '../entities/session.entity';
import { VerificationToken } from '../entities/verification-token.entity';
import { AuthAttemptService } from '../services/auth-attempt.service';
import { AuthService } from '../services/auth.service';
import { CsrfService } from '../services/csrf.service';
import { PasswordService } from '../services/password.service';
import { SessionService } from '../services/session.service';
import { TotpService } from '../services/totp.service';
import { VerificationTokenService } from '../services/verification-token.service';
import {
  createCookieRecorder,
  createFakeUserDirectory,
  createNotificationsDouble,
  testAuthConfig,
  type CookieRecorder,
  type FakeUserDirectory,
} from '../testing/auth-fixtures';

import { AuthController } from './auth.controller';

import type { SignupDto } from '../dto/signup.dto';

const REQUEST = { ip: '203.0.113.7', headers: { 'user-agent': 'jest/drape-test' } };

function signupPayload(overrides: Partial<SignupDto> = {}): SignupDto {
  return {
    name: 'Ayesha Khan',
    email: 'ayesha@example.invalid',
    password: 'correct-horse-9!',
    phone: '+923001234567',
    ...overrides,
  };
}

describe('AuthController', () => {
  let harness: TestHarness;
  let controller: AuthController;
  let directory: FakeUserDirectory;
  let response: CookieRecorder;
  let emit: jest.Mock;

  beforeEach(async () => {
    freezeClock(FIXED_NOW);
    directory = createFakeUserDirectory();
    response = createCookieRecorder();
    emit = jest.fn();

    harness = await createTestingModule({
      controllers: [AuthController],
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
        { token: NotificationsService, value: createNotificationsDouble() },
        { token: EventEmitter2, value: { emit } },
        { token: SettingsService, value: { getBoolean: jest.fn().mockResolvedValue(false) } },
      ],
    });
    controller = harness.get(AuthController);
  });

  afterEach(async () => {
    await harness.close();
  });

  describe('POST /auth/signup with role: "admin" (S-4)', () => {
    it('creates a CONSUMER and logs the attempt', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const body = await controller.signup(signupPayload({ role: 'admin' }), REQUEST, response);

      expect(body.role).toBe(Role.CONSUMER);
      expect(body.role).not.toBe(Role.ADMIN);
      expect(directory.rows).toHaveLength(1);
      expect(directory.rows[0].role).toBe(Role.CONSUMER);

      expect(emit).toHaveBeenCalledWith(
        AUTH_EVENTS.SIGNUP_ROLE_IGNORED,
        expect.objectContaining({ requestedRole: 'admin', createdRole: Role.CONSUMER }),
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('S-4'));
    });

    it('succeeds rather than rejecting the payload — S-4 says ignored, not refused', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(
        controller.signup(signupPayload({ role: 'admin' }), REQUEST, response),
      ).resolves.toBeDefined();
    });

    it('returns no password hash, 2FA secret or recovery codes', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const body = await controller.signup(signupPayload({ role: 'admin' }), REQUEST, response);

      const serialised = JSON.stringify(body);
      expect(serialised).not.toContain('argon2');
      expect(serialised).not.toContain('correct-horse-9!');
      expect(body).not.toHaveProperty('passwordHash');
      expect(body).not.toHaveProperty('twofaSecret');
    });

    it('sets the session and CSRF cookies on the response', async () => {
      await controller.signup(signupPayload(), REQUEST, response);

      expect(response.last('drape.sid')?.options).toMatchObject({ httpOnly: true });
      expect(response.last('drape.csrf')?.options).toMatchObject({ httpOnly: false });
    });
  });

  describe('GET /auth/csrf', () => {
    it('issues a token, writes the cookie and names the header (B-8)', async () => {
      const body = await controller.issueCsrfToken(undefined, response);

      expect(body.cookieName).toBe('drape.csrf');
      expect(body.headerName).toBe(CSRF_HEADER_NAME);
      expect(response.last('drape.csrf')?.value).toBe(body.csrfToken);
    });

    it('binds the token to the caller’s session when there is one', async () => {
      const signedIn = await controller.signup(signupPayload(), REQUEST, response);
      const sessions = harness.repository<Session>(Session);
      const session = sessions.$rows.find((row) => row.userId === signedIn.id);
      const csrfService = harness.get<CsrfService>(CsrfService);

      const body = await controller.issueCsrfToken(
        {
          id: signedIn.id,
          role: Role.CONSUMER,
          email: signedIn.email,
          name: signedIn.name,
          status: signedIn.status,
          emailVerifiedAt: null,
          phoneVerifiedAt: null,
          sessionId: session?.id as string,
          locale: signedIn.locale,
        },
        response,
      );

      expect(csrfService.verifyToken(body.csrfToken, session?.csrfSecret ?? null)).toBe(true);
      expect(csrfService.verifyToken(body.csrfToken, null)).toBe(false);
    });
  });
});
