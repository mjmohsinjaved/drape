import { Role } from '@library/common';

import { envConfigSource, resolveAuthConfig } from './auth.config';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A complete, well-formed environment. Individual tests remove or corrupt one row. */
function validEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    SESSION_COOKIE_DOMAIN: '.example.com',
    SESSION_SECRET: 'a'.repeat(64),
    CSRF_SECRET: 'b'.repeat(64),
    APP_WEB_URL: 'https://example.com/',
    ...overrides,
  };
}

/**
 * ARCHITECTURE §7, PRD E-2 — "no credential has a fallback default in code".
 *
 * The point of these tests is the negative space: a missing or malformed secret has
 * to stop the boot, because the alternative is an API that runs with a predictable
 * session key and looks perfectly healthy while doing it.
 */
describe('resolveAuthConfig — secrets have no defaults (E-2)', () => {
  it.each(['SESSION_SECRET', 'CSRF_SECRET'])('refuses to resolve without %s', (name) => {
    expect(() => resolveAuthConfig(envConfigSource(validEnv({ [name]: undefined })))).toThrow(
      new RegExp(`${name} is required`),
    );
  });

  it.each(['SESSION_SECRET', 'CSRF_SECRET'])(
    'refuses a %s that is not 64 hex characters',
    (name) => {
      expect(() => resolveAuthConfig(envConfigSource(validEnv({ [name]: 'too-short' })))).toThrow(
        /64 hexadecimal characters/,
      );
    },
  );

  it('treats an all-whitespace secret as missing, not as a value', () => {
    expect(() => resolveAuthConfig(envConfigSource(validEnv({ SESSION_SECRET: '   ' })))).toThrow(
      /SESSION_SECRET is required/,
    );
  });

  it('refuses to resolve without SESSION_COOKIE_DOMAIN (B-6)', () => {
    expect(() =>
      resolveAuthConfig(envConfigSource(validEnv({ SESSION_COOKIE_DOMAIN: undefined }))),
    ).toThrow(/SESSION_COOKIE_DOMAIN is required/);
  });
});

describe('resolveAuthConfig — session windows (S-7)', () => {
  it('applies the documented defaults', () => {
    const config = resolveAuthConfig(envConfigSource(validEnv()));

    expect(config.idleMs[Role.ADMIN]).toBe(12 * HOUR_MS);
    expect(config.idleMs[Role.CONSUMER]).toBe(30 * DAY_MS);
    expect(config.absoluteMs[Role.ADMIN]).toBe(7 * DAY_MS);
    expect(config.absoluteMs[Role.CONSUMER]).toBe(90 * DAY_MS);
  });

  it('honours overrides', () => {
    const config = resolveAuthConfig(
      envConfigSource(validEnv({ SESSION_ADMIN_IDLE_HOURS: '2', SESSION_CONSUMER_IDLE_DAYS: '7' })),
    );

    expect(config.idleMs[Role.ADMIN]).toBe(2 * HOUR_MS);
    expect(config.idleMs[Role.CONSUMER]).toBe(7 * DAY_MS);
  });

  it('gives Role.PUBLIC the shorter-lived consumer window, never the admin one', () => {
    const config = resolveAuthConfig(envConfigSource(validEnv()));

    expect(config.idleMs[Role.PUBLIC]).toBe(config.idleMs[Role.CONSUMER]);
  });

  it.each(['0', '-1', 'twelve', '1.5'])('refuses %p as an hour count', (value) => {
    expect(() =>
      resolveAuthConfig(envConfigSource(validEnv({ SESSION_ADMIN_IDLE_HOURS: value }))),
    ).toThrow(/must be a positive integer/);
  });
});

describe('resolveAuthConfig — everything else', () => {
  it('applies the §7 defaults for names, TTLs and lockout', () => {
    const config = resolveAuthConfig(envConfigSource(validEnv()));

    expect(config.sessionCookieName).toBe('drape.sid');
    expect(config.csrfCookieName).toBe('drape.csrf');
    expect(config.sessionCookieSecure).toBe(false);
    expect(config.passwordResetTtlMinutes).toBe(30);
    expect(config.emailVerifyTtlHours).toBe(24);
    expect(config.otpTtlSeconds).toBe(600);
    expect(config.lockoutThreshold).toBe(5);
    expect(config.lockoutMaxMinutes).toBe(60);
  });

  it('strips a trailing slash from APP_WEB_URL, so links never double up', () => {
    const config = resolveAuthConfig(envConfigSource(validEnv({ APP_WEB_URL: 'https://x.io//' })));

    expect(config.webUrl).toBe('https://x.io');
  });

  it.each([
    ['true', true],
    ['1', true],
    ['on', true],
    ['false', false],
    ['no', false],
  ])('reads SESSION_COOKIE_SECURE=%p as %p', (value, expected) => {
    const config = resolveAuthConfig(envConfigSource(validEnv({ SESSION_COOKIE_SECURE: value })));

    expect(config.sessionCookieSecure).toBe(expected);
  });

  it('accepts the already-typed values ConfigService hands back', () => {
    // `validateEnv` transforms integers and booleans before ConfigService sees them.
    const typed = {
      get: <T>(key: string): T | undefined =>
        ({
          SESSION_COOKIE_DOMAIN: '.example.com',
          SESSION_SECRET: 'a'.repeat(64),
          CSRF_SECRET: 'b'.repeat(64),
          APP_WEB_URL: 'https://example.com',
          SESSION_ADMIN_IDLE_HOURS: 6,
          SESSION_COOKIE_SECURE: true,
        })[key] as T | undefined,
    };

    const config = resolveAuthConfig(typed);

    expect(config.idleMs[Role.ADMIN]).toBe(6 * HOUR_MS);
    expect(config.sessionCookieSecure).toBe(true);
  });

  it('ignores a value that is not configuration rather than stringifying it', () => {
    const config = resolveAuthConfig({
      get: <T>(key: string): T | undefined =>
        (key === 'SESSION_COOKIE_NAME' ? { nonsense: true } : validEnv()[key]) as T | undefined,
    });

    // Not `"[object Object]"` — an object is not configuration, so the default stands.
    expect(config.sessionCookieName).toBe('drape.sid');
  });
});
