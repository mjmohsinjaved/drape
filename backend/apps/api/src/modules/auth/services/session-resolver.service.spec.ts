import { ErrorCode, Role, UserStatus, type SessionResolutionContext } from '@library/common';

import {
  createTestingModule,
  type TestHarness,
  type InMemoryRepository,
} from '../../../../test/fixtures';
import { FIXED_NOW, freezeClock } from '../../../../test/setup/time';
import { AUTH_CONFIG, LAST_SEEN_WRITE_INTERVAL_MS, USER_DIRECTORY } from '../auth.constants';
import { Session } from '../entities/session.entity';
import {
  buildAuthUser,
  createFakeUserDirectory,
  testAuthConfig,
  type FakeUserDirectory,
} from '../testing/auth-fixtures';

import { CsrfService } from './csrf.service';
import { normaliseResolutionPath, SessionResolverService } from './session-resolver.service';
import { SessionService } from './session.service';

import type { AuthUser } from '../interfaces/user-directory.interface';

const PROTECTED: SessionResolutionContext = {
  ip: '203.0.113.7',
  userAgent: 'jest/drape-test',
  method: 'GET',
  path: '/api/v1/tryon',
  isPublicRoute: false,
};

const PUBLIC: SessionResolutionContext = { ...PROTECTED, isPublicRoute: true };

/**
 * ARCHITECTURE §2.7 guard 3 — the `SESSION_RESOLVER` binding.
 *
 * This is the seam the whole API hangs from: `SessionAuthGuard` cannot be constructed
 * without it, and every authorisation decision downstream depends on what it returns.
 * The cases below are the ones where a wrong answer is a security incident rather
 * than a bug — a suspended account that still resolves, or a role read from the
 * cookie instead of from `users`.
 */
describe('SessionResolverService', () => {
  let harness: TestHarness;
  let resolver: SessionResolverService;
  let sessionService: SessionService;
  let sessions: InMemoryRepository<Session>;
  let directory: FakeUserDirectory;

  async function arrange(user: AuthUser): Promise<{ token: string; sessionId: string }> {
    directory.rows.push(user);
    const issued = await sessionService.issue({
      user,
      ip: '203.0.113.7',
      userAgent: 'jest/drape-test',
      twofaPending: false,
      now: FIXED_NOW,
    });
    return { token: issued.token, sessionId: issued.session.id };
  }

  beforeEach(async () => {
    freezeClock(FIXED_NOW);
    directory = createFakeUserDirectory();
    harness = await createTestingModule({
      providers: [SessionResolverService, SessionService, CsrfService],
      repositories: [Session],
      overrides: [
        { token: AUTH_CONFIG, value: testAuthConfig() },
        { token: USER_DIRECTORY, value: directory },
      ],
    });
    resolver = harness.get(SessionResolverService);
    sessionService = harness.get(SessionService);
    sessions = harness.repository<Session>(Session);
  });

  afterEach(async () => {
    await harness.close();
  });

  describe('a healthy session', () => {
    it('resolves to the caller described by §2.6', async () => {
      const user = buildAuthUser({ name: 'Ayesha Khan' });
      const { token, sessionId } = await arrange(user);

      const caller = await resolver.resolve(token, PROTECTED);

      expect(caller).toEqual({
        id: user.id,
        role: Role.CONSUMER,
        email: user.email,
        name: 'Ayesha Khan',
        status: UserStatus.ACTIVE,
        emailVerifiedAt: user.emailVerifiedAt,
        phoneVerifiedAt: user.phoneVerifiedAt,
        sessionId,
        locale: user.locale,
      });
    });

    it('takes the role from users, not from the sessions snapshot (S-3)', async () => {
      const user = buildAuthUser({ role: Role.CONSUMER });
      const { token, sessionId } = await arrange(user);

      // The snapshot goes stale — a role change mid-session. `users` is authoritative.
      const row = sessions.$rows.find((candidate) => candidate.id === sessionId);
      if (row !== undefined) {
        row.role = Role.ADMIN;
      }

      const caller = await resolver.resolve(token, PROTECTED);

      expect(caller?.role).toBe(Role.CONSUMER);
    });
  });

  describe('accounts that must not resolve', () => {
    it('refuses a SUSPENDED account with ACCOUNT_SUSPENDED (A-19)', async () => {
      const { token } = await arrange(
        buildAuthUser({ status: UserStatus.SUSPENDED, email: 'suspended@example.invalid' }),
      );

      await expect(resolver.resolve(token, PROTECTED)).rejects.toMatchObject({
        errorCode: ErrorCode.ACCOUNT_SUSPENDED,
      });
    });

    it('refuses a DEACTIVATED account with ACCOUNT_DEACTIVATED (A-2)', async () => {
      const { token } = await arrange(
        buildAuthUser({ status: UserStatus.DEACTIVATED, email: 'gone@example.invalid' }),
      );

      await expect(resolver.resolve(token, PROTECTED)).rejects.toMatchObject({
        errorCode: ErrorCode.ACCOUNT_DEACTIVATED,
      });
    });

    it('refuses a suspended account even though the session row is perfectly healthy', async () => {
      const user = buildAuthUser({ email: 'ok@example.invalid' });
      const { token, sessionId } = await arrange(user);

      // Resolves now…
      await expect(resolver.resolve(token, PROTECTED)).resolves.toMatchObject({ id: user.id });

      // …and stops the moment the account is suspended, with the row untouched.
      user.status = UserStatus.SUSPENDED;
      const row = sessions.$rows.find((candidate) => candidate.id === sessionId);

      expect(row?.revokedAt).toBeNull();
      await expect(resolver.resolve(token, PROTECTED)).rejects.toMatchObject({
        errorCode: ErrorCode.ACCOUNT_SUSPENDED,
      });
    });

    it('refuses a session whose user row has gone', async () => {
      const user = buildAuthUser();
      const { token } = await arrange(user);
      directory.rows.length = 0;

      await expect(resolver.resolve(token, PROTECTED)).rejects.toMatchObject({
        errorCode: ErrorCode.SESSION_INVALID,
      });
    });
  });

  describe('sessions that must not resolve', () => {
    it('refuses an unknown cookie value with SESSION_INVALID', async () => {
      await expect(resolver.resolve('not-a-real-token', PROTECTED)).rejects.toMatchObject({
        errorCode: ErrorCode.SESSION_INVALID,
      });
    });

    it('refuses a revoked session with SESSION_INVALID, never revealing it was real', async () => {
      const { token, sessionId } = await arrange(buildAuthUser());
      const row = sessions.$rows.find((candidate) => candidate.id === sessionId);
      if (row !== undefined) {
        row.revokedAt = FIXED_NOW;
        row.revokedReason = 'LOGOUT';
      }

      await expect(resolver.resolve(token, PROTECTED)).rejects.toMatchObject({
        errorCode: ErrorCode.SESSION_INVALID,
      });
    });

    it.each([
      ['the idle clock', 'expiresAt' as const],
      ['the absolute clock', 'absoluteExpiresAt' as const],
    ])('refuses a session past %s with SESSION_EXPIRED (S-7)', async (_label, column) => {
      const { token, sessionId } = await arrange(buildAuthUser());
      const row = sessions.$rows.find((candidate) => candidate.id === sessionId);
      if (row !== undefined) {
        row[column] = new Date(FIXED_NOW.getTime() - 1);
      }

      await expect(resolver.resolve(token, PROTECTED)).rejects.toMatchObject({
        errorCode: ErrorCode.SESSION_EXPIRED,
      });
    });

    it('refuses a twofaPending session with TWOFA_REQUIRED (S-8)', async () => {
      const user = buildAuthUser({ role: Role.ADMIN, email: 'admin@example.invalid' });
      directory.rows.push(user);
      const issued = await sessionService.issue({
        user,
        ip: '203.0.113.7',
        userAgent: null,
        twofaPending: true,
        now: FIXED_NOW,
      });

      await expect(resolver.resolve(issued.token, PROTECTED)).rejects.toMatchObject({
        errorCode: ErrorCode.TWOFA_REQUIRED,
      });
    });
  });

  /* -----------------------------------------------------------------------------------------
   * S-8 — "2FA mandatory for Admin", enforced here and not by the console
   * -------------------------------------------------------------------------------------- */

  /**
   * `AuthService.login` sets `twofaPending = user.twofaEnabledAt !== null`, so an admin who
   * has never enrolled used to walk out of the password step holding a **fully authorised**
   * admin session: `twofaPending` false, every `@Roles(Role.ADMIN)` route reachable — consumer
   * PII, suspensions, deletions, settings, the audit log. The defence was that "the console
   * forces the enrolment screen", which is a client-side control; S-3 and S-11 say
   * authorisation is decided in the API, and an attacker with an admin password does not run
   * the console.
   *
   * The session is still issued — there has to be a way to enrol — but it now reaches the
   * enrolment routes and nothing else.
   */
  describe('an ADMIN with no second factor enrolled (S-8)', () => {
    function admin(overrides: Partial<AuthUser> = {}): AuthUser {
      return buildAuthUser({
        id: '22222222-2222-4222-8222-222222222222',
        role: Role.ADMIN,
        email: 'admin@example.invalid',
        twofaEnabledAt: null,
        ...overrides,
      });
    }

    function at(method: string, path: string): SessionResolutionContext {
      return { ...PROTECTED, method, path };
    }

    it.each([
      ['the admin consumer list', 'GET', '/api/v1/admin/consumers'],
      ['a suspension', 'POST', '/api/v1/admin/consumers/abc/suspend'],
      ['the audit log', 'GET', '/api/v1/admin/audit'],
      ['settings', 'PATCH', '/api/v1/settings'],
      ['her own photos', 'GET', '/api/v1/photos'],
      // The enrolment allow-list is matched on the *pair*, not on the path alone.
      ['the enrolment path under the wrong verb', 'GET', '/api/v1/auth/2fa/setup'],
      // …and not by prefix, or `/auth/me/anything` would ride in on `/auth/me`.
      ['a path that merely starts with an allowed one', 'GET', '/api/v1/auth/me/sessions'],
    ])('refuses %s with TWOFA_REQUIRED', async (_label, method, path) => {
      const { token } = await arrange(admin());

      await expect(resolver.resolve(token, at(method, path))).rejects.toMatchObject({
        errorCode: ErrorCode.TWOFA_REQUIRED,
      });
    });

    it.each([
      ['read who I am', 'GET', '/api/v1/auth/me'],
      ['begin enrolment', 'POST', '/api/v1/auth/2fa/setup'],
      ['finish enrolment', 'POST', '/api/v1/auth/2fa/enable'],
      ['leave', 'POST', '/api/v1/auth/logout'],
    ])('allows %s, or there would be no way out', async (_label, method, path) => {
      const user = admin();
      const { token } = await arrange(user);

      await expect(resolver.resolve(token, at(method, path))).resolves.toMatchObject({
        id: user.id,
        role: Role.ADMIN,
      });
    });

    it('stops refusing the moment the second factor is enrolled', async () => {
      const user = admin();
      const { token } = await arrange(user);

      await expect(
        resolver.resolve(token, at('GET', '/api/v1/admin/consumers')),
      ).rejects.toMatchObject({ errorCode: ErrorCode.TWOFA_REQUIRED });

      user.twofaEnabledAt = FIXED_NOW;

      await expect(
        resolver.resolve(token, at('GET', '/api/v1/admin/consumers')),
      ).resolves.toMatchObject({ id: user.id });
    });

    it('leaves consumers alone — S-8 makes 2FA optional for them', async () => {
      const user = buildAuthUser({ role: Role.CONSUMER, twofaEnabledAt: null });
      const { token } = await arrange(user);

      await expect(resolver.resolve(token, at('GET', '/api/v1/photos'))).resolves.toMatchObject({
        id: user.id,
      });
    });

    it('resolves an un-enrolled admin to nobody on a public route, never to a 401', async () => {
      const { token } = await arrange(admin());

      await expect(
        resolver.resolve(token, { ...PUBLIC, method: 'GET', path: '/api/v1/browse' }),
      ).resolves.toBeNull();
    });
  });

  describe('normaliseResolutionPath', () => {
    it.each([
      ['/api/v1/auth/me', '/auth/me'],
      ['/api/auth/me', '/auth/me'],
      ['/auth/me', '/auth/me'],
      ['/api/v1/auth/me/', '/auth/me'],
      ['/api/v12/auth/me', '/auth/me'],
      // Not a prefix to strip: `/apiary` shares four characters and nothing else.
      ['/apiary/auth/me', '/apiary/auth/me'],
      ['/', '/'],
    ])('%s → %s', (input, expected) => {
      expect(normaliseResolutionPath(input)).toBe(expected);
    });
  });

  describe('public routes (§2.6)', () => {
    it.each([
      ['an unknown token', async (): Promise<string> => 'not-a-real-token'],
      [
        'a suspended account',
        async (): Promise<string> =>
          (await arrange(buildAuthUser({ status: UserStatus.SUSPENDED }))).token,
      ],
    ])('resolves %s to nobody instead of throwing', async (_label, makeToken) => {
      const token = await makeToken();

      await expect(resolver.resolve(token, PUBLIC)).resolves.toBeNull();
    });

    it('still resolves a healthy session, so @CurrentUser() works', async () => {
      const user = buildAuthUser();
      const { token } = await arrange(user);

      await expect(resolver.resolve(token, PUBLIC)).resolves.toMatchObject({ id: user.id });
    });
  });

  describe('activity bookkeeping', () => {
    it('does not write on every request', async () => {
      const { token } = await arrange(buildAuthUser());
      jest.mocked(sessions.update).mockClear();
      directory.update.mockClear();

      await resolver.resolve(token, PROTECTED);
      await resolver.resolve(token, PROTECTED);

      expect(sessions.update).not.toHaveBeenCalled();
      expect(directory.update).not.toHaveBeenCalled();
    });

    it('slides the session and stamps lastActiveAt once the throttle has passed', async () => {
      const user = buildAuthUser();
      const { token } = await arrange(user);
      jest.mocked(sessions.update).mockClear();
      directory.update.mockClear();

      jest.setSystemTime(new Date(FIXED_NOW.getTime() + LAST_SEEN_WRITE_INTERVAL_MS + 1));
      await resolver.resolve(token, PROTECTED);

      expect(sessions.update).toHaveBeenCalledTimes(1);
      expect(directory.update).toHaveBeenCalledTimes(1);
      expect(user.lastActiveAt).not.toBeNull();
    });

    it('still authorises the request when the lastActiveAt write fails', async () => {
      const user = buildAuthUser();
      const { token } = await arrange(user);
      directory.update.mockRejectedValueOnce(new Error('database is having a moment'));

      jest.setSystemTime(new Date(FIXED_NOW.getTime() + LAST_SEEN_WRITE_INTERVAL_MS + 1));

      await expect(resolver.resolve(token, PROTECTED)).resolves.toMatchObject({ id: user.id });
    });
  });
});
