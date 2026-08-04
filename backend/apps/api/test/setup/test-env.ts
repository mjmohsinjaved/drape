import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Safe, obviously-fake environment for unit tests.
 *
 * There is no PostgreSQL, no storage root and no SMTP server on the machine this suite runs
 * on, and a unit test must never need one. These values exist so that code which *reads*
 * configuration at construction time has something well-formed to read — not so that
 * anything connects.
 *
 * Every secret below is a recognisable dummy pattern (`deadbeef…`, `feedface…`). If one of
 * these ever appears in a log, a bug report or a deployed environment, it is immediately
 * obvious what happened. None of them is a default: production reads its own values and
 * `validateRequiredEnvVars()` fails the boot when they are missing (§7, PRD E-2).
 *
 * `applyTestEnv()` never overwrites a variable that is already set, so a single test can
 * override one value without fighting this file.
 */

/** 64 hex characters, the shape §7 asks of every HMAC/AES key — and unmistakably fake. */
function dummySecret(pattern: string): string {
  return pattern.repeat(8);
}

export const TEST_STORAGE_ROOT = join(tmpdir(), 'drape-test-storage');

export const TEST_ENV: Readonly<Record<string, string>> = {
  // ── Runtime ────────────────────────────────────────────────────────────────
  NODE_ENV: 'test',
  API_PORT: '0',
  APP_WEB_URL: 'http://localhost:3000',
  APP_API_URL: 'http://localhost:4000',
  CORS_ORIGINS: 'http://localhost:3000',
  TRUST_PROXY: '0',
  LOG_LEVEL: 'error',
  TIMEZONE: 'Asia/Karachi',

  // ── Database ───────────────────────────────────────────────────────────────
  // Well-formed and deliberately unreachable. A unit test that actually opens this
  // connection has mocked one repository too few.
  DATABASE_URL: 'postgresql://drape_test:not-a-real-password@127.0.0.1:5432/drape_test',
  DATABASE_SSL: 'false',
  DATABASE_POOL_MAX: '2',
  DATABASE_POOL_MIN: '1',

  // ── Sessions and CSRF ──────────────────────────────────────────────────────
  SESSION_COOKIE_NAME: 'drape.sid',
  SESSION_COOKIE_DOMAIN: '.localhost',
  SESSION_SECRET: dummySecret('deadbeef'),
  SESSION_COOKIE_SECURE: 'false',
  SESSION_ADMIN_IDLE_HOURS: '12',
  SESSION_CONSUMER_IDLE_DAYS: '30',
  SESSION_ADMIN_ABSOLUTE_DAYS: '7',
  SESSION_CONSUMER_ABSOLUTE_DAYS: '90',
  CSRF_COOKIE_NAME: 'drape.csrf',
  CSRF_SECRET: dummySecret('feedface'),

  // ── Password hashing and 2FA ───────────────────────────────────────────────
  // Argon2 is deliberately expensive. These are the cheapest parameters the library
  // accepts, because a test suite that spends eight seconds hashing is a test suite
  // nobody runs. Production uses the §7 values.
  ARGON2_MEMORY_KIB: '1024',
  ARGON2_TIME_COST: '1',
  ARGON2_PARALLELISM: '1',
  TWOFA_ENCRYPTION_KEY: dummySecret('abadcafe'),
  TWOFA_ISSUER: 'Drape Test',

  // ── Storage ────────────────────────────────────────────────────────────────
  // A temp directory, well outside the repository. Nothing in the unit suite writes
  // to it — tests assert on the storage KEY, never on a file.
  STORAGE_DRIVER: 'local',
  STORAGE_ROOT: TEST_STORAGE_ROOT,
  STORAGE_URL_SECRET: dummySecret('facefeed'),
  STORAGE_URL_TTL_PHOTO_SECONDS: '300',
  STORAGE_URL_TTL_RENDER_SECONDS: '900',
  STORAGE_URL_TTL_PUBLIC_SECONDS: '3600',
  STORAGE_UPLOAD_TICKET_TTL_SECONDS: '900',
  STORAGE_MAX_UPLOAD_MB: '25',
  STORAGE_MIN_FREE_MB: '1',

  // ── TryOnCloud ─────────────────────────────────────────────────────────────
  // NON-NEGOTIABLE. The upstream account holds a total budget of ten images. The http
  // driver spends one per generation, permanently. No test, on any machine, ever runs
  // against it — and TRYONCLOUD_API_KEY is deliberately absent below so that a test
  // which somehow flipped this to `http` would fail loudly instead of billing the
  // account (§0, §7).
  TRYON_DRIVER: 'mock',
  TRYON_API_VERSION: 'test-0000-00-00',
  TRYON_TIMEOUT_MS: '1000',
  TRYON_MAX_ATTEMPTS: '3',
  TRYON_BACKOFF_BASE_MS: '1',
  TRYON_TEST_RENDER_CONCURRENCY: '1',
  // Zero latency by default; a test exercising the wait UI sets its own.
  TRYON_MOCK_LATENCY_MS: '0',
  TRYON_MOCK_FAILURE_RATE: '0',

  // ── Notifications ──────────────────────────────────────────────────────────
  EMAIL_DRIVER: 'console',
  EMAIL_FROM: 'Drape Test <test@example.invalid>',
  SMS_DRIVER: 'console',

  // ── Token lifetimes ────────────────────────────────────────────────────────
  OTP_TTL_SECONDS: '600',
  PASSWORD_RESET_TTL_MINUTES: '30',
  EMAIL_VERIFY_TTL_HOURS: '24',
  INVITE_TTL_DAYS: '7',

  // ── Rate limiting ──────────────────────────────────────────────────────────
  // High enough that an unrelated test never trips the throttler by accident. Tests
  // that assert throttling set their own values.
  THROTTLE_TTL_SECONDS: '60',
  THROTTLE_LIMIT: '10000',
  TRYON_RATE_PER_HOUR: '10000',
  TRYON_RATE_PER_IP_HOUR: '10000',
  LOGIN_LOCKOUT_THRESHOLD: '5',
  LOGIN_LOCKOUT_MAX_MINUTES: '60',

  // ── Quota, budget, retention ───────────────────────────────────────────────
  QUOTA_DEFAULT_MONTHLY: '15',
  BUDGET_DEFAULT_MONTHLY: '2000',
  BUDGET_WARN_PERCENT: '80',
  PHOTO_RETENTION_DAYS: '30',
  JOB_RETENTION_DAYS: '90',
  DELETION_SLA_HOURS: '24',
};

/**
 * Seed-script variables, kept OUT of `TEST_ENV` on purpose.
 *
 * `admin.seeder.ts` must throw when `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` are unset,
 * and that behaviour is the thing worth testing most (PRD E-4, E-2). If the default test
 * environment supplied them, the test proving the failure would have to unset them first —
 * and would quietly stop proving anything the day someone forgot. A test that wants a
 * working seed opts in explicitly.
 */
export const TEST_SEED_ENV: Readonly<Record<string, string>> = {
  SEED_ADMIN_EMAIL: 'admin@example.invalid',
  SEED_ADMIN_PASSWORD: 'not-a-real-password-9142',
  SEED_ADMIN_NAME: 'Test Admin',
};

/**
 * Applies the given values to `process.env`, skipping any variable already set.
 *
 * @returns the keys this call introduced, so a test can undo exactly those.
 */
export function applyEnv(values: Readonly<Record<string, string>>): string[] {
  const applied: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}

/** Applies `TEST_ENV` and pins the process timezone so date arithmetic is reproducible. */
export function applyTestEnv(): void {
  process.env.TZ = 'UTC';
  applyEnv(TEST_ENV);
}
