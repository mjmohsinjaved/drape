import { createCookieRecorder, testAuthConfig } from '../testing/auth-fixtures';

import { CsrfService } from './csrf.service';

/**
 * ARCHITECTURE §2.7 guard 1, PRD B-8 — the session-bound double-submit token.
 *
 * `CsrfGuard` in `@library/common` proves the header and the cookie agree. These
 * tests cover the half it cannot do: that the pair was minted *for this session* and
 * signed with `CSRF_SECRET`.
 */
describe('CsrfService', () => {
  const service = new CsrfService(testAuthConfig());
  const sessionSecret = 'a'.repeat(64);
  const otherSessionSecret = 'b'.repeat(64);

  describe('session secrets', () => {
    it('mints a 64-character hex secret for the sessions row (§4.5)', () => {
      const secret = service.newSessionSecret();

      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      expect(secret).not.toEqual(service.newSessionSecret());
    });
  });

  describe('issue and verify', () => {
    it('verifies a token against the session it was minted for', () => {
      const token = service.issueToken(sessionSecret);

      expect(service.verifyToken(token, sessionSecret)).toBe(true);
    });

    it('rejects a token lifted from another session — this is the whole point', () => {
      const token = service.issueToken(sessionSecret);

      expect(service.verifyToken(token, otherSessionSecret)).toBe(false);
    });

    it('rejects an anonymous token once a session exists', () => {
      const anonymous = service.issueToken(null);

      expect(service.verifyToken(anonymous, null)).toBe(true);
      expect(service.verifyToken(anonymous, sessionSecret)).toBe(false);
    });

    it('rejects a session token presented anonymously', () => {
      const token = service.issueToken(sessionSecret);

      expect(service.verifyToken(token, null)).toBe(false);
    });

    it('mints a distinct token each time, so one cannot be pinned', () => {
      expect(service.issueToken(sessionSecret)).not.toEqual(service.issueToken(sessionSecret));
    });

    it('rejects a tampered signature', () => {
      const token = service.issueToken(sessionSecret);
      const [nonce, signature] = token.split('.');
      const tampered = `${nonce}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;

      expect(service.verifyToken(tampered, sessionSecret)).toBe(false);
    });

    it('rejects a tampered nonce', () => {
      const token = service.issueToken(sessionSecret);
      const [nonce, signature] = token.split('.');

      expect(service.verifyToken(`${nonce.slice(1)}0.${signature}`, sessionSecret)).toBe(false);
    });

    it.each([
      ['undefined', undefined],
      ['an empty string', ''],
      ['no separator', 'justanonce'],
      ['an empty nonce', '.signature'],
      ['an empty signature', 'nonce.'],
    ])('rejects %s without throwing', (_label, token) => {
      expect(service.verifyToken(token, sessionSecret)).toBe(false);
    });

    it('cannot be forged without CSRF_SECRET', () => {
      const forger = new CsrfService(testAuthConfig({ csrfSecret: 'c'.repeat(64) }));
      const forged = forger.issueToken(sessionSecret);

      expect(service.verifyToken(forged, sessionSecret)).toBe(false);
    });

    it('produces a cookie-safe value', () => {
      expect(service.issueToken(sessionSecret)).toMatch(/^[A-Za-z0-9._-]+$/);
    });
  });

  describe('the cookie', () => {
    it('is readable by script by design, and carries no authority alone (B-8)', () => {
      const response = createCookieRecorder();
      const token = service.issueToken(sessionSecret);

      service.writeCookie(response, token);

      expect(response.last('drape.csrf')).toMatchObject({
        value: token,
        options: { httpOnly: false, sameSite: 'lax', domain: '.localhost', path: '/' },
      });
    });

    it('uses Lax rather than Strict, so an emailed link still arrives with it (B-6)', () => {
      expect(service.cookieOptions().sameSite).toBe('lax');
    });

    it('clears by name', () => {
      const response = createCookieRecorder();

      service.clearCookie(response);

      expect(response.cleared).toEqual(['drape.csrf']);
    });
  });
});
