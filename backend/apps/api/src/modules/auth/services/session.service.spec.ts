import { isSha256Hex, Role } from '@library/common';

import { buildSession, uuid } from '../../../../test/factories';
import {
  createTestingModule,
  type TestHarness,
  type InMemoryRepository,
} from '../../../../test/fixtures';
import { daysFromFixedNow, FIXED_NOW, freezeClock } from '../../../../test/setup/time';
import { AUTH_CONFIG, LAST_SEEN_WRITE_INTERVAL_MS, REVOKE_REASONS } from '../auth.constants';
import { Session } from '../entities/session.entity';
import { createCookieRecorder, testAuthConfig } from '../testing/auth-fixtures';

import { CsrfService } from './csrf.service';
import { SessionService, type IssuedSession } from './session.service';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const ADMIN = { id: uuid(), role: Role.ADMIN };
const CONSUMER = { id: uuid(), role: Role.CONSUMER };

/**
 * ARCHITECTURE §4.5, PRD S-7 — server-side sessions.
 *
 * "Session duration: Admin 12 hours of inactivity, Consumer 30 days" — plus the hard
 * ceilings of 7 and 90 days that no amount of activity extends. Both clocks are
 * asserted here, and so is the property that matters most in a breach: the row never
 * contains the cookie value.
 */
describe('SessionService', () => {
  let harness: TestHarness;
  let service: SessionService;
  let sessions: InMemoryRepository<Session>;

  beforeEach(async () => {
    freezeClock(FIXED_NOW);
    const config = testAuthConfig();
    harness = await createTestingModule({
      providers: [SessionService, CsrfService],
      repositories: [Session],
      overrides: [{ token: AUTH_CONFIG, value: config }],
    });
    service = harness.get(SessionService);
    sessions = harness.repository<Session>(Session);
  });

  afterEach(async () => {
    await harness.close();
  });

  function issue(user = CONSUMER): Promise<IssuedSession> {
    return service.issue({
      user,
      ip: '203.0.113.7',
      userAgent: 'jest/drape-test',
      now: FIXED_NOW,
    });
  }

  describe('expiry rules per role (S-7)', () => {
    it('gives a consumer a 30-day idle window and a 90-day ceiling', async () => {
      const issued = await issue(CONSUMER);

      expect(issued.session.expiresAt).toEqual(daysFromFixedNow(30));
      expect(issued.session.absoluteExpiresAt).toEqual(daysFromFixedNow(90));
    });

    it('gives an admin a 12-hour idle window and a 7-day ceiling', async () => {
      const issued = await issue(ADMIN);

      expect(issued.session.expiresAt).toEqual(new Date(FIXED_NOW.getTime() + 12 * HOUR_MS));
      expect(issued.session.absoluteExpiresAt).toEqual(daysFromFixedNow(7));
    });

    it('exposes the windows so callers never hard-code them', () => {
      expect(service.idleWindowMs(Role.ADMIN)).toBe(12 * HOUR_MS);
      expect(service.idleWindowMs(Role.CONSUMER)).toBe(30 * DAY_MS);
      expect(service.absoluteWindowMs(Role.ADMIN)).toBe(7 * DAY_MS);
      expect(service.absoluteWindowMs(Role.CONSUMER)).toBe(90 * DAY_MS);
    });

    it.each([
      ['the idle clock has passed', { expiresAt: new Date(FIXED_NOW.getTime() - 1) }],
      ['the absolute clock has passed', { absoluteExpiresAt: new Date(FIXED_NOW.getTime() - 1) }],
    ])('treats a session as expired when %s', (_label, overrides) => {
      const session = buildSession(overrides);

      expect(service.isExpired(session, FIXED_NOW)).toBe(true);
    });

    it('treats a healthy session as live', () => {
      expect(service.isExpired(buildSession(), FIXED_NOW)).toBe(false);
    });
  });

  describe('the stored token', () => {
    it('stores a sha256, never the cookie value (§4.5)', async () => {
      const issued = await issue();

      expect(isSha256Hex(issued.session.tokenHash)).toBe(true);
      expect(JSON.stringify(sessions.$rows)).not.toContain(issued.token);
    });

    it('derives the hash deterministically, so the cookie can be looked up', async () => {
      const issued = await issue();

      expect(service.hashToken(issued.token)).toBe(issued.session.tokenHash);
      await expect(service.findByToken(issued.token)).resolves.toMatchObject({
        id: issued.session.id,
      });
    });

    it('finds nothing for an unknown or empty cookie value', async () => {
      await issue();

      await expect(service.findByToken('not-a-real-token')).resolves.toBeNull();
      await expect(service.findByToken('')).resolves.toBeNull();
    });

    it('binds the hash to SESSION_SECRET, so rotating it signs everyone out (§7)', async () => {
      const issued = await issue();
      const rotated = new SessionService(
        sessions,
        testAuthConfig({ sessionSecret: 'a'.repeat(64) }),
        harness.get(CsrfService),
      );

      expect(rotated.hashToken(issued.token)).not.toBe(issued.session.tokenHash);
    });

    it('issues a CSRF token already bound to the new session', async () => {
      const issued = await issue();
      const csrf = harness.get<CsrfService>(CsrfService);

      expect(csrf.verifyToken(issued.csrfToken, issued.session.csrfSecret)).toBe(true);
    });
  });

  describe('touch — the throttled slide', () => {
    it('does not write again inside the throttle window', async () => {
      const issued = await issue();
      jest.mocked(sessions.update).mockClear();

      const wrote = await service.touch(
        issued.session,
        new Date(FIXED_NOW.getTime() + LAST_SEEN_WRITE_INTERVAL_MS - 1),
      );

      expect(wrote).toBe(false);
      expect(sessions.update).not.toHaveBeenCalled();
    });

    it('slides the idle clock once the throttle window has passed', async () => {
      const issued = await issue();
      const later = new Date(FIXED_NOW.getTime() + LAST_SEEN_WRITE_INTERVAL_MS + 1);

      const wrote = await service.touch(issued.session, later);

      expect(wrote).toBe(true);
      expect(issued.session.lastSeenAt).toEqual(later);
      expect(issued.session.expiresAt).toEqual(new Date(later.getTime() + 30 * DAY_MS));
      expect(sessions.update).toHaveBeenCalledTimes(1);
    });

    it('never slides past the absolute ceiling — the hard clock wins', async () => {
      const issued = await issue(ADMIN);
      // Six days in: sliding by another 12 hours would cross the 7-day ceiling only
      // near the end, so step to a point where it would.
      const later = new Date(FIXED_NOW.getTime() + 6 * DAY_MS + 20 * HOUR_MS);

      await service.touch(issued.session, later);

      expect(issued.session.expiresAt).toEqual(issued.session.absoluteExpiresAt);
      expect(issued.session.expiresAt.getTime()).toBeLessThanOrEqual(
        issued.session.absoluteExpiresAt.getTime(),
      );
    });
  });

  describe('rotation and revocation', () => {
    it('rotates on a privilege change: the old cookie stops working', async () => {
      const first = await issue();

      const second = await service.rotate(first.session, {
        user: CONSUMER,
        ip: '203.0.113.7',
        userAgent: 'jest/drape-test',
        now: FIXED_NOW,
      });

      expect(second.token).not.toEqual(first.token);
      expect(second.session.id).not.toEqual(first.session.id);
      expect(first.session.revokedAt).toEqual(FIXED_NOW);
      expect(first.session.revokedReason).toBe(REVOKE_REASONS.ROTATED);
      expect(second.session.revokedAt).toBeNull();
    });

    it('gives a rotated session a fresh CSRF secret', async () => {
      const first = await issue();
      const second = await service.rotate(first.session, {
        user: CONSUMER,
        ip: '203.0.113.7',
        userAgent: null,
        now: FIXED_NOW,
      });

      expect(second.session.csrfSecret).not.toEqual(first.session.csrfSecret);
    });

    it('is idempotent: a second revoke keeps the first reason', async () => {
      const issued = await issue();

      await service.revoke(issued.session, REVOKE_REASONS.LOGOUT, FIXED_NOW);
      await service.revoke(issued.session, REVOKE_REASONS.ADMIN_REVOKED, daysFromFixedNow(1));

      expect(issued.session.revokedReason).toBe(REVOKE_REASONS.LOGOUT);
      expect(issued.session.revokedAt).toEqual(FIXED_NOW);
    });

    it('revokes every session for a user (A-2, A-19)', async () => {
      const userId = CONSUMER.id;
      sessions.$seed([
        buildSession({ userId }),
        buildSession({ userId }),
        buildSession({ userId }),
        buildSession({ userId: uuid() }),
      ]);

      const revoked = await service.revokeAllForUser(userId, REVOKE_REASONS.SUSPENDED, FIXED_NOW);

      expect(revoked).toBe(3);
      expect(sessions.$rows.filter((row) => row.revokedAt !== null)).toHaveLength(3);
      expect(
        sessions.$rows.every(
          (row) => row.userId !== userId || row.revokedReason === REVOKE_REASONS.SUSPENDED,
        ),
      ).toBe(true);
    });

    it('can keep the caller signed in — DELETE /auth/sessions revokes the others', async () => {
      const userId = CONSUMER.id;
      const keep = buildSession({ userId });
      sessions.$seed([keep, buildSession({ userId }), buildSession({ userId })]);

      const revoked = await service.revokeAllForUser(userId, REVOKE_REASONS.LOGOUT_ALL, FIXED_NOW, {
        exceptSessionId: keep.id,
      });

      expect(revoked).toBe(2);
      expect(keep.revokedAt).toBeNull();
    });
  });

  describe('listActive', () => {
    it('excludes revoked and expired rows and sorts by recency', async () => {
      const userId = CONSUMER.id;
      const recent = buildSession({ userId, lastSeenAt: FIXED_NOW });
      const older = buildSession({
        userId,
        lastSeenAt: new Date(FIXED_NOW.getTime() - DAY_MS),
      });
      sessions.$seed([
        older,
        recent,
        buildSession({ userId, revokedAt: FIXED_NOW, revokedReason: 'LOGOUT' }),
        buildSession({ userId, expiresAt: new Date(FIXED_NOW.getTime() - 1) }),
        buildSession({ userId: uuid() }),
      ]);

      const listed = await service.listActive(userId, FIXED_NOW);

      expect(listed.map((row) => row.id)).toEqual([recent.id, older.id]);
    });
  });

  describe('cookies (PRD B-6, §9.2)', () => {
    it('writes the session cookie httpOnly, SameSite=Lax and parent-domain scoped', async () => {
      const issued = await issue(CONSUMER);
      const response = createCookieRecorder();

      service.writeAuthCookies(response, issued);
      const cookie = response.last('drape.sid');

      expect(cookie?.value).toBe(issued.token);
      expect(cookie?.options).toMatchObject({
        httpOnly: true,
        sameSite: 'lax',
        domain: '.localhost',
        path: '/',
        maxAge: 90 * DAY_MS,
      });
    });

    it('gives an admin cookie the shorter absolute lifetime', async () => {
      const issued = await issue(ADMIN);
      const response = createCookieRecorder();

      service.writeAuthCookies(response, issued);

      expect(response.last('drape.sid')?.options).toMatchObject({ maxAge: 7 * DAY_MS });
    });

    it('writes the CSRF cookie alongside it, readable by design (B-8)', async () => {
      const issued = await issue();
      const response = createCookieRecorder();

      service.writeAuthCookies(response, issued);

      expect(response.last('drape.csrf')?.value).toBe(issued.csrfToken);
      expect(response.last('drape.csrf')?.options).toMatchObject({ httpOnly: false });
    });

    it('honours SESSION_COOKIE_SECURE', () => {
      const secured = new SessionService(
        sessions,
        testAuthConfig({ sessionCookieSecure: true }),
        harness.get(CsrfService),
      );
      const response = createCookieRecorder();

      secured.writeSessionCookie(response, 'token', Role.CONSUMER);

      expect(response.last('drape.sid')?.options).toMatchObject({ secure: true });
    });

    it('clears both cookies on sign-out', () => {
      const response = createCookieRecorder();

      service.clearAuthCookies(response);

      expect(response.cleared).toEqual(['drape.sid', 'drape.csrf']);
    });
  });
});
