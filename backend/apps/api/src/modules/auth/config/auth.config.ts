import { Role } from '@library/common';

/**
 * The §7 variables this module reads, resolved once at boot.
 *
 * Secrets are read with `requireSecret`, which has **no fallback** (E-2, CLAUDE.md):
 * a missing `SESSION_SECRET`, `CSRF_SECRET` or `TWOFA_ENCRYPTION_KEY` fails the boot
 * rather than silently degrading every session in the deployment.
 */
export interface AuthConfig {
  /** Session cookie name — not a secret, so a documented default is correct (§7). */
  readonly sessionCookieName: string;
  /** Parent domain so one cookie covers both origins (B-6). Required. */
  readonly sessionCookieDomain: string;
  /** `Secure` flag. Always true outside local development. */
  readonly sessionCookieSecure: boolean;
  /** HMAC key the opaque session token is derived under. Rotating it logs everyone out. */
  readonly sessionSecret: string;

  /** Double-submit cookie name — readable by JS by design (B-8). */
  readonly csrfCookieName: string;
  /** HMAC key for the session-bound CSRF token (§2.7 guard 1). */
  readonly csrfSecret: string;

  /** Sliding idle expiry per role, in milliseconds (S-7). */
  readonly idleMs: Readonly<Record<Role, number>>;
  /** Hard ceiling per role, in milliseconds (§4.5). */
  readonly absoluteMs: Readonly<Record<Role, number>>;

  /** Argon2id cost parameters (S-6). Tuning values, not credentials. */
  readonly argon2: {
    readonly memoryCost: number;
    readonly timeCost: number;
    readonly parallelism: number;
  };

  /** AES-256-GCM key protecting `users.twofaSecret` (S-8). 32 bytes. */
  readonly twofaEncryptionKey: Buffer;
  /** Label shown in the authenticator app. */
  readonly twofaIssuer: string;

  /** Phone OTP lifetime (C-3). */
  readonly otpTtlSeconds: number;
  /** Reset link lifetime — 30 minutes (S-6). */
  readonly passwordResetTtlMinutes: number;
  /** Verification link lifetime. */
  readonly emailVerifyTtlHours: number;

  /** Failures before lockout (S-6). */
  readonly lockoutThreshold: number;
  /** Backoff ceiling, in minutes. */
  readonly lockoutMaxMinutes: number;

  /** The web origin, for the links inside verification and reset emails. */
  readonly webUrl: string;
}

/**
 * Anything that can answer "what is the value of this variable?".
 *
 * `ConfigService` satisfies it, and so does a plain object in a test — which is the
 * point: `resolveAuthConfig` is a pure function of its source, so its behaviour can
 * be asserted without a Nest container.
 */
export interface AuthConfigSource {
  get<T = unknown>(key: string): T | undefined;
}

/** Wraps a `process.env`-shaped record as an `AuthConfigSource`. */
export function envConfigSource(env: NodeJS.ProcessEnv): AuthConfigSource {
  return { get: <T>(key: string): T | undefined => env[key] as T | undefined };
}

class AuthConfigError extends Error {
  constructor(message: string) {
    super(`Auth configuration: ${message} — see docs/ARCHITECTURE.md §7.`);
    this.name = 'AuthConfigError';
  }
}

/**
 * Narrows a configuration value to a trimmed scalar, or `undefined`.
 *
 * `ConfigService` hands back whatever `validateEnv` produced — a `number` for the
 * transformed integers, a `boolean` for the flags, a `string` for everything else —
 * while `process.env` hands back strings. Anything else is not configuration and is
 * treated as absent rather than stringified into `"[object Object]"`.
 */
function readScalar(source: AuthConfigSource, key: string): string | undefined {
  const value = source.get(key);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function readString(source: AuthConfigSource, key: string, fallback: string): string {
  return readScalar(source, key) ?? fallback;
}

/** No fallback, ever (E-2). A blank secret is a failed boot, not a default. */
function requireSecret(source: AuthConfigSource, key: string): string {
  const secret = readScalar(source, key);
  if (secret === undefined) {
    throw new AuthConfigError(`${key} is required and has no default`);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(secret)) {
    throw new AuthConfigError(`${key} must be exactly 64 hexadecimal characters`);
  }
  return secret.toLowerCase();
}

function requireString(source: AuthConfigSource, key: string): string {
  const value = readScalar(source, key);
  if (value === undefined) {
    throw new AuthConfigError(`${key} is required`);
  }
  return value;
}

function readInt(source: AuthConfigSource, key: string, fallback: number): number {
  const value = readScalar(source, key);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AuthConfigError(`${key} must be a positive integer`);
  }
  return parsed;
}

function readBool(source: AuthConfigSource, key: string, fallback: boolean): boolean {
  const value = readScalar(source, key);
  if (value === undefined) {
    return fallback;
  }
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Builds the module's configuration from any source.
 *
 * `Role.PUBLIC` is never persisted and never holds a session, but `Record<Role, …>`
 * needs an entry for it; it is given the consumer window so an accidental lookup can
 * only ever be *more* conservative than the admin one.
 */
export function resolveAuthConfig(source: AuthConfigSource): AuthConfig {
  const adminIdleMs = readInt(source, 'SESSION_ADMIN_IDLE_HOURS', 12) * HOUR_MS;
  const consumerIdleMs = readInt(source, 'SESSION_CONSUMER_IDLE_DAYS', 30) * DAY_MS;
  const adminAbsoluteMs = readInt(source, 'SESSION_ADMIN_ABSOLUTE_DAYS', 7) * DAY_MS;
  const consumerAbsoluteMs = readInt(source, 'SESSION_CONSUMER_ABSOLUTE_DAYS', 90) * DAY_MS;

  return {
    sessionCookieName: readString(source, 'SESSION_COOKIE_NAME', 'drape.sid'),
    sessionCookieDomain: requireString(source, 'SESSION_COOKIE_DOMAIN'),
    sessionCookieSecure: readBool(source, 'SESSION_COOKIE_SECURE', false),
    sessionSecret: requireSecret(source, 'SESSION_SECRET'),

    csrfCookieName: readString(source, 'CSRF_COOKIE_NAME', 'drape.csrf'),
    csrfSecret: requireSecret(source, 'CSRF_SECRET'),

    idleMs: {
      [Role.ADMIN]: adminIdleMs,
      [Role.CONSUMER]: consumerIdleMs,
      [Role.PUBLIC]: consumerIdleMs,
    },
    absoluteMs: {
      [Role.ADMIN]: adminAbsoluteMs,
      [Role.CONSUMER]: consumerAbsoluteMs,
      [Role.PUBLIC]: consumerAbsoluteMs,
    },

    argon2: {
      memoryCost: readInt(source, 'ARGON2_MEMORY_KIB', 19_456),
      timeCost: readInt(source, 'ARGON2_TIME_COST', 2),
      parallelism: readInt(source, 'ARGON2_PARALLELISM', 1),
    },

    twofaEncryptionKey: Buffer.from(requireSecret(source, 'TWOFA_ENCRYPTION_KEY'), 'hex'),
    twofaIssuer: readString(source, 'TWOFA_ISSUER', 'Drape'),

    otpTtlSeconds: readInt(source, 'OTP_TTL_SECONDS', 600),
    passwordResetTtlMinutes: readInt(source, 'PASSWORD_RESET_TTL_MINUTES', 30),
    emailVerifyTtlHours: readInt(source, 'EMAIL_VERIFY_TTL_HOURS', 24),

    lockoutThreshold: readInt(source, 'LOGIN_LOCKOUT_THRESHOLD', 5),
    lockoutMaxMinutes: readInt(source, 'LOGIN_LOCKOUT_MAX_MINUTES', 60),

    webUrl: requireString(source, 'APP_WEB_URL').replace(/\/+$/, ''),
  };
}
