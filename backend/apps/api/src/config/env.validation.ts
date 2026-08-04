import { isAbsolute } from 'node:path';

import { Transform, plainToInstance } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
  validateSync,
} from 'class-validator';

/* -------------------------------------------------------------------------- */
/* Enumerated environment values                                               */
/* -------------------------------------------------------------------------- */

/** `NODE_ENV` (§7, E-1). `test` is accepted so the E-8/E-9 suites can boot the app. */
export enum NodeEnv {
  DEVELOPMENT = 'development',
  TEST = 'test',
  STAGING = 'staging',
  PRODUCTION = 'production',
}

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export enum StorageDriverName {
  LOCAL = 'local',
  S3 = 's3',
}

export enum TryOnDriverName {
  MOCK = 'mock',
  HTTP = 'http',
}

export enum EmailDriverName {
  CONSOLE = 'console',
  SMTP = 'smtp',
}

export enum SmsDriverName {
  CONSOLE = 'console',
  HTTP = 'http',
}

/* -------------------------------------------------------------------------- */
/* Transform helpers                                                           */
/* -------------------------------------------------------------------------- */

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/** Parses an integer, falling back to `fallback` when the variable is absent. */
function toInt(value: unknown, fallback?: number): number | undefined {
  if (isBlank(value)) return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

/** Parses a float, falling back to `fallback` when the variable is absent. */
function toFloat(value: unknown, fallback?: number): number | undefined {
  return toInt(value, fallback);
}

/** Accepts `true|false|1|0|yes|no|on|off`, case-insensitive. */
function toBool(value: unknown, fallback: boolean): boolean | undefined {
  if (isBlank(value)) return fallback;
  const normalised = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalised)) return true;
  if (['false', '0', 'no', 'off'].includes(normalised)) return false;
  // Returning undefined makes @IsBoolean() fail with a readable message.
  return undefined;
}

/** Splits a comma-separated list, trimming blanks. */
function toList(value: unknown): string[] {
  if (isBlank(value)) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const HEX_64 = /^[0-9a-fA-F]{64}$/;
const HEX_64_MESSAGE = 'must be exactly 64 hexadecimal characters';

/* -------------------------------------------------------------------------- */
/* The schema — one property per row of ARCHITECTURE §7 (api service)          */
/* -------------------------------------------------------------------------- */

/**
 * Every `api` variable in ARCHITECTURE §7, with the required/optional split taken
 * verbatim from that table.
 *
 * **No secret carries a working default** (E-2). Optional variables carry the
 * documented operational default; required ones carry none, so a missing value is
 * reported rather than silently substituted.
 */
export class EnvironmentVariables {
  /* --- platform ---------------------------------------------------------- */

  /** Required. */
  @IsEnum(NodeEnv, { message: `NODE_ENV must be one of: ${Object.values(NodeEnv).join(', ')}` })
  NODE_ENV: NodeEnv;

  /** Optional — defaults to 4000. */
  @Transform(({ value }) => toInt(value, 4000))
  @IsInt()
  @Min(1)
  @Max(65535)
  API_PORT: number;

  /** Required. The web origin: email links, QR and short links. */
  @IsString()
  @IsNotEmpty()
  @Matches(/^https?:\/\/\S+$/, { message: 'APP_WEB_URL must be an http(s) URL' })
  APP_WEB_URL: string;

  /** Required. Public base for signed file URLs (§3.4). */
  @IsString()
  @IsNotEmpty()
  @Matches(/^https?:\/\/\S+$/, { message: 'APP_API_URL must be an http(s) URL' })
  APP_API_URL: string;

  /** Required. Comma-separated allow-list. **Never `*`, in any environment** (B-7). */
  @Transform(({ value }) => toList(value))
  @IsArray()
  @ArrayNotEmpty({ message: 'CORS_ORIGINS must list at least one origin' })
  @IsString({ each: true })
  @Matches(/^https?:\/\/\S+$/, {
    each: true,
    message: 'every CORS_ORIGINS entry must be an http(s) origin — "*" is never allowed (B-7)',
  })
  CORS_ORIGINS: string[];

  /** Optional — hop count for correct client IPs behind a reverse proxy. */
  @Transform(({ value }) => toInt(value, 0))
  @IsInt()
  @Min(0)
  @Max(10)
  TRUST_PROXY: number;

  /** Optional. */
  @IsEnum(LogLevel)
  @Transform(({ value }) => (isBlank(value) ? LogLevel.INFO : String(value).toLowerCase()))
  LOG_LEVEL: LogLevel;

  /* --- database (B-3) ---------------------------------------------------- */

  /** Required. */
  @IsString()
  @IsNotEmpty()
  @Matches(/^postgres(ql)?:\/\/\S+$/, {
    message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string',
  })
  DATABASE_URL: string;

  /** Optional. */
  @Transform(({ value }) => toBool(value, false))
  @IsBoolean()
  DATABASE_SSL: boolean;

  /** Optional — pool ceiling (20–50 in production). */
  @Transform(({ value }) => toInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(200)
  DATABASE_POOL_MAX: number;

  /** Optional — pool floor. */
  @Transform(({ value }) => toInt(value, 2))
  @IsInt()
  @Min(0)
  @Max(200)
  DATABASE_POOL_MIN: number;

  /* --- sessions and CSRF (B-6, B-8, S-7) --------------------------------- */

  /** Optional. */
  @Transform(({ value }) => (isBlank(value) ? 'drape.sid' : String(value)))
  @IsString()
  @IsNotEmpty()
  SESSION_COOKIE_NAME: string;

  /** Required — parent domain so one cookie covers both origins (B-6). */
  @IsString()
  @IsNotEmpty()
  SESSION_COOKIE_DOMAIN: string;

  /** Required — HMAC key for session token derivation. No default, ever. */
  @Matches(HEX_64, { message: `SESSION_SECRET ${HEX_64_MESSAGE}` })
  SESSION_SECRET: string;

  /** Optional — admin idle expiry (S-7). */
  @Transform(({ value }) => toInt(value, 12))
  @IsInt()
  @Min(1)
  SESSION_ADMIN_IDLE_HOURS: number;

  /** Optional — consumer idle expiry (S-7). */
  @Transform(({ value }) => toInt(value, 30))
  @IsInt()
  @Min(1)
  SESSION_CONSUMER_IDLE_DAYS: number;

  /** Optional — admin hard ceiling. */
  @Transform(({ value }) => toInt(value, 7))
  @IsInt()
  @Min(1)
  SESSION_ADMIN_ABSOLUTE_DAYS: number;

  /** Optional — consumer hard ceiling. */
  @Transform(({ value }) => toInt(value, 90))
  @IsInt()
  @Min(1)
  SESSION_CONSUMER_ABSOLUTE_DAYS: number;

  /** Optional — `false` locally, always `true` outside local. */
  @Transform(({ value }) => toBool(value, false))
  @IsBoolean()
  SESSION_COOKIE_SECURE: boolean;

  /** Optional — double-submit cookie, readable by JS by design (B-8). */
  @Transform(({ value }) => (isBlank(value) ? 'drape.csrf' : String(value)))
  @IsString()
  @IsNotEmpty()
  CSRF_COOKIE_NAME: string;

  /** Required — HMAC key for CSRF token derivation. No default, ever. */
  @Matches(HEX_64, { message: `CSRF_SECRET ${HEX_64_MESSAGE}` })
  CSRF_SECRET: string;

  /* --- password hashing and 2FA (S-6, S-8) ------------------------------- */

  /** Optional — Argon2id memory cost. */
  @Transform(({ value }) => toInt(value, 19456))
  @IsInt()
  @Min(8192)
  ARGON2_MEMORY_KIB: number;

  /** Optional — Argon2id iterations. */
  @Transform(({ value }) => toInt(value, 2))
  @IsInt()
  @Min(1)
  ARGON2_TIME_COST: number;

  /** Optional — Argon2id lanes. */
  @Transform(({ value }) => toInt(value, 1))
  @IsInt()
  @Min(1)
  ARGON2_PARALLELISM: number;

  /** Required — AES-256-GCM key protecting `users.twofaSecret` (S-8). */
  @Matches(HEX_64, { message: `TWOFA_ENCRYPTION_KEY ${HEX_64_MESSAGE}` })
  TWOFA_ENCRYPTION_KEY: string;

  /** Optional — label in the authenticator app. */
  @Transform(({ value }) => (isBlank(value) ? 'Drape' : String(value)))
  @IsString()
  @IsNotEmpty()
  TWOFA_ISSUER: string;

  /* --- storage (§3) ------------------------------------------------------ */

  /** Optional — `local` in V1. */
  @Transform(({ value }) =>
    isBlank(value) ? StorageDriverName.LOCAL : String(value).toLowerCase(),
  )
  @IsEnum(StorageDriverName)
  STORAGE_DRIVER: StorageDriverName;

  /** Required — absolute path **outside the repository**. */
  @IsString()
  @IsNotEmpty()
  STORAGE_ROOT: string;

  /** Required — HMAC key for signed download and upload tokens (§3.4). */
  @Matches(HEX_64, { message: `STORAGE_URL_SECRET ${HEX_64_MESSAGE}` })
  STORAGE_URL_SECRET: string;

  /** Optional — person-photo URL TTL. */
  @Transform(({ value }) => toInt(value, 300))
  @IsInt()
  @Min(30)
  STORAGE_URL_TTL_PHOTO_SECONDS: number;

  /** Optional — render URL TTL. */
  @Transform(({ value }) => toInt(value, 900))
  @IsInt()
  @Min(30)
  STORAGE_URL_TTL_RENDER_SECONDS: number;

  /** Optional — garment/category/brand URL TTL. */
  @Transform(({ value }) => toInt(value, 3600))
  @IsInt()
  @Min(30)
  STORAGE_URL_TTL_PUBLIC_SECONDS: number;

  /** Optional — upload ticket TTL. */
  @Transform(({ value }) => toInt(value, 900))
  @IsInt()
  @Min(30)
  STORAGE_UPLOAD_TICKET_TTL_SECONDS: number;

  /** Optional — hard per-file ceiling, in megabytes. */
  @Transform(({ value }) => toInt(value, 25))
  @IsInt()
  @Min(1)
  STORAGE_MAX_UPLOAD_MB: number;

  /** Optional — below this, `/health/ready` degrades and an alert fires (E-14). */
  @Transform(({ value }) => toInt(value, 2048))
  @IsInt()
  @Min(0)
  STORAGE_MIN_FREE_MB: number;

  /* --- TryOnCloud (§8.1, §8.3) ------------------------------------------- */

  /** Required — `mock` in local and CI; the upstream account has a 10-image budget. */
  @Transform(({ value }): unknown => (isBlank(value) ? value : String(value).toLowerCase()))
  @IsEnum(TryOnDriverName)
  TRYON_DRIVER: TryOnDriverName;

  /** Required when `TRYON_DRIVER=http`. */
  @ValidateIf((env: EnvironmentVariables) => env.TRYON_DRIVER === TryOnDriverName.HTTP)
  @IsString()
  @IsNotEmpty({ message: 'TRYONCLOUD_BASE_URL is required when TRYON_DRIVER=http' })
  @Matches(/^https?:\/\/\S+$/, { message: 'TRYONCLOUD_BASE_URL must be an http(s) URL' })
  TRYONCLOUD_BASE_URL?: string;

  /** Required when `TRYON_DRIVER=http`. API-service-only secret (B-1, §9.2). */
  @ValidateIf((env: EnvironmentVariables) => env.TRYON_DRIVER === TryOnDriverName.HTTP)
  @IsString()
  @IsNotEmpty({ message: 'TRYONCLOUD_API_KEY is required when TRYON_DRIVER=http' })
  TRYONCLOUD_API_KEY?: string;

  /** Required — third component of the cache key (§3.7). */
  @IsString()
  @IsNotEmpty()
  TRYON_API_VERSION: string;

  /** Optional — per-attempt upstream timeout (E-11). */
  @Transform(({ value }) => toInt(value, 20000))
  @IsInt()
  @Min(1000)
  TRYON_TIMEOUT_MS: number;

  /** Optional — retry ceiling (§8.3). */
  @Transform(({ value }) => toInt(value, 3))
  @IsInt()
  @Min(1)
  @Max(10)
  TRYON_MAX_ATTEMPTS: number;

  /** Optional — exponential backoff base. */
  @Transform(({ value }) => toInt(value, 800))
  @IsInt()
  @Min(0)
  TRYON_BACKOFF_BASE_MS: number;

  /** Optional — bulk test renders never compete with a live generation (§8.2). */
  @Transform(({ value }) => toInt(value, 1))
  @IsInt()
  @Min(1)
  TRYON_TEST_RENDER_CONCURRENCY: number;

  /** Optional — mock driver latency, so the wait UI is exercised honestly. */
  @Transform(({ value }) => toInt(value, 7000))
  @IsInt()
  @Min(0)
  TRYON_MOCK_LATENCY_MS: number;

  /** Optional — `0`–`1`; used by E-6 to walk the failure taxonomy. */
  @Transform(({ value }) => toFloat(value, 0))
  @IsNumber()
  @Min(0)
  @Max(1)
  TRYON_MOCK_FAILURE_RATE: number;

  /* --- email --------------------------------------------------------------*/

  /** Required. */
  @Transform(({ value }): unknown => (isBlank(value) ? value : String(value).toLowerCase()))
  @IsEnum(EmailDriverName)
  EMAIL_DRIVER: EmailDriverName;

  /** Required — From header. */
  @IsString()
  @IsNotEmpty()
  EMAIL_FROM: string;

  /** Required when `EMAIL_DRIVER=smtp`. */
  @ValidateIf((env: EnvironmentVariables) => env.EMAIL_DRIVER === EmailDriverName.SMTP)
  @IsString()
  @IsNotEmpty({ message: 'SMTP_HOST is required when EMAIL_DRIVER=smtp' })
  SMTP_HOST?: string;

  /** Required when `EMAIL_DRIVER=smtp`. */
  @ValidateIf((env: EnvironmentVariables) => env.EMAIL_DRIVER === EmailDriverName.SMTP)
  @Transform(({ value }) => toInt(value))
  @IsInt({ message: 'SMTP_PORT is required when EMAIL_DRIVER=smtp and must be a port number' })
  @Min(1)
  @Max(65535)
  SMTP_PORT?: number;

  /** Required when `EMAIL_DRIVER=smtp`. */
  @ValidateIf((env: EnvironmentVariables) => env.EMAIL_DRIVER === EmailDriverName.SMTP)
  @IsString()
  @IsNotEmpty({ message: 'SMTP_USER is required when EMAIL_DRIVER=smtp' })
  SMTP_USER?: string;

  /** Required when `EMAIL_DRIVER=smtp`. No default, ever. */
  @ValidateIf((env: EnvironmentVariables) => env.EMAIL_DRIVER === EmailDriverName.SMTP)
  @IsString()
  @IsNotEmpty({ message: 'SMTP_PASSWORD is required when EMAIL_DRIVER=smtp' })
  SMTP_PASSWORD?: string;

  /** Optional — implicit TLS. */
  @Transform(({ value }) => toBool(value, false))
  @IsBoolean()
  SMTP_SECURE: boolean;

  /* --- SMS ----------------------------------------------------------------*/

  /** Required. */
  @Transform(({ value }): unknown => (isBlank(value) ? value : String(value).toLowerCase()))
  @IsEnum(SmsDriverName)
  SMS_DRIVER: SmsDriverName;

  /** Required when `SMS_DRIVER=http`. */
  @ValidateIf((env: EnvironmentVariables) => env.SMS_DRIVER === SmsDriverName.HTTP)
  @IsString()
  @IsNotEmpty({ message: 'SMS_HTTP_URL is required when SMS_DRIVER=http' })
  @Matches(/^https?:\/\/\S+$/, { message: 'SMS_HTTP_URL must be an http(s) URL' })
  SMS_HTTP_URL?: string;

  /** Required when `SMS_DRIVER=http`. No default, ever. */
  @ValidateIf((env: EnvironmentVariables) => env.SMS_DRIVER === SmsDriverName.HTTP)
  @IsString()
  @IsNotEmpty({ message: 'SMS_HTTP_API_KEY is required when SMS_DRIVER=http' })
  SMS_HTTP_API_KEY?: string;

  /** Required when `SMS_DRIVER=http`. */
  @ValidateIf((env: EnvironmentVariables) => env.SMS_DRIVER === SmsDriverName.HTTP)
  @IsString()
  @IsNotEmpty({ message: 'SMS_SENDER_ID is required when SMS_DRIVER=http' })
  SMS_SENDER_ID?: string;

  /* --- token lifetimes ----------------------------------------------------*/

  /** Optional — phone OTP lifetime (C-3). */
  @Transform(({ value }) => toInt(value, 600))
  @IsInt()
  @Min(60)
  OTP_TTL_SECONDS: number;

  /** Optional — reset link lifetime (S-6). */
  @Transform(({ value }) => toInt(value, 30))
  @IsInt()
  @Min(1)
  PASSWORD_RESET_TTL_MINUTES: number;

  /** Optional — verification link lifetime. */
  @Transform(({ value }) => toInt(value, 24))
  @IsInt()
  @Min(1)
  EMAIL_VERIFY_TTL_HOURS: number;

  /** Optional — admin invite lifetime (S-5). */
  @Transform(({ value }) => toInt(value, 7))
  @IsInt()
  @Min(1)
  INVITE_TTL_DAYS: number;

  /* --- throttling and abuse (§5.22, C-6, S-6) -----------------------------*/

  /** Optional — global throttle window. */
  @Transform(({ value }) => toInt(value, 60))
  @IsInt()
  @Min(1)
  THROTTLE_TTL_SECONDS: number;

  /** Optional — global throttle limit. */
  @Transform(({ value }) => toInt(value, 100))
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT: number;

  /** Optional — per-account generation ceiling above quota (C-6). */
  @Transform(({ value }) => toInt(value, 20))
  @IsInt()
  @Min(1)
  TRYON_RATE_PER_HOUR: number;

  /** Optional — per-IP generation ceiling (C-6). */
  @Transform(({ value }) => toInt(value, 40))
  @IsInt()
  @Min(1)
  TRYON_RATE_PER_IP_HOUR: number;

  /** Optional — failures before lockout (S-6). */
  @Transform(({ value }) => toInt(value, 5))
  @IsInt()
  @Min(1)
  LOGIN_LOCKOUT_THRESHOLD: number;

  /** Optional — backoff ceiling, in minutes. */
  @Transform(({ value }) => toInt(value, 60))
  @IsInt()
  @Min(1)
  LOGIN_LOCKOUT_MAX_MINUTES: number;

  /* --- product defaults and retention ------------------------------------ */

  /** Optional — seed value for `settings['quota.defaultMonthly']` (A-28, C-5). */
  @Transform(({ value }) => toInt(value, 15))
  @IsInt()
  @Min(0)
  QUOTA_DEFAULT_MONTHLY: number;

  /** Optional — seed value for `settings['budget.monthlyGenerations']` (A-29). */
  @Transform(({ value }) => toInt(value, 2000))
  @IsInt()
  @Min(0)
  BUDGET_DEFAULT_MONTHLY: number;

  /** Optional — soft warning threshold (A-29, E-14). */
  @Transform(({ value }) => toInt(value, 80))
  @IsInt()
  @Min(1)
  @Max(100)
  BUDGET_WARN_PERCENT: number;

  /** Optional — photo purge after last account activity (§9.3). */
  @Transform(({ value }) => toInt(value, 30))
  @IsInt()
  @Min(1)
  PHOTO_RETENTION_DAYS: number;

  /** Optional — `tryon_jobs` pruning window. */
  @Transform(({ value }) => toInt(value, 90))
  @IsInt()
  @Min(1)
  JOB_RETENTION_DAYS: number;

  /** Optional — consumer-initiated deletion SLA (C-38, A-20). */
  @Transform(({ value }) => toInt(value, 24))
  @IsInt()
  @Min(1)
  DELETION_SLA_HOURS: number;

  /** Optional — cron schedules and the ledger `period` boundary. */
  @Transform(({ value }) => (isBlank(value) ? 'Asia/Karachi' : String(value)))
  @IsString()
  @IsNotEmpty()
  TIMEZONE: string;

  /* --- seeding (§7 "✔ (seed)") ------------------------------------------- */
  /*
   * These three are required by `npm run seed`, not by the HTTP service. They are
   * optional here so the API boots without them, and are asserted by
   * `validateSeedEnv()` below, which the seeder calls before it writes anything.
   */

  @IsOptional()
  @IsEmail({}, { message: 'SEED_ADMIN_EMAIL must be an email address' })
  SEED_ADMIN_EMAIL?: string;

  /** No default, ever — E-2. Rotated immediately after the first login. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  SEED_ADMIN_PASSWORD?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  SEED_ADMIN_NAME?: string;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

export class EnvironmentValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(
      [
        '',
        '  Drape API cannot start: the environment is invalid.',
        `  ${problems.length} problem${problems.length === 1 ? '' : 's'} found:`,
        '',
        ...problems.map((problem) => `    • ${problem}`),
        '',
        '  Every variable is documented in docs/ARCHITECTURE.md §7 and backend/.env.example.',
        '  No secret has a fallback default — supply it explicitly.',
        '',
      ].join('\n'),
    );
    this.name = 'EnvironmentValidationError';
  }
}

/** Invariants that class-validator cannot express on a single property. */
function collectCrossFieldProblems(env: EnvironmentVariables): string[] {
  const problems: string[] = [];

  if (env.CORS_ORIGINS?.some((origin) => origin === '*' || origin.includes('*'))) {
    problems.push('CORS_ORIGINS must never contain "*", in any environment (B-7)');
  }

  if (env.STORAGE_ROOT && !isAbsolute(env.STORAGE_ROOT)) {
    problems.push('STORAGE_ROOT must be an absolute path outside the repository (§3.2)');
  }

  if (env.DATABASE_POOL_MIN > env.DATABASE_POOL_MAX) {
    problems.push('DATABASE_POOL_MIN must not exceed DATABASE_POOL_MAX');
  }

  if (env.NODE_ENV === NodeEnv.PRODUCTION) {
    if (!env.SESSION_COOKIE_SECURE) {
      problems.push('SESSION_COOKIE_SECURE must be true outside local development (§7)');
    }
    if (env.CORS_ORIGINS?.some((origin) => origin.startsWith('http://'))) {
      problems.push('CORS_ORIGINS must use https:// in production');
    }
  }

  return problems;
}

function flatten(prefix: string, errors: ReturnType<typeof validateSync>): string[] {
  const messages: string[] = [];
  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    if (error.constraints) {
      for (const constraint of Object.values(error.constraints)) {
        messages.push(constraint.startsWith(path) ? constraint : `${path}: ${constraint}`);
      }
    }
    if (error.children?.length) {
      messages.push(...flatten(path, error.children));
    }
  }
  return messages;
}

/**
 * The `validate` hook for `ConfigModule.forRoot({ validate })` and the engine behind
 * `validateRequiredEnvVars()`.
 *
 * Reports **every** problem at once — a half-configured deployment should not be
 * discovered one variable at a time.
 */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
  });

  const problems = [
    ...flatten('', validateSync(validated, { skipMissingProperties: false })),
    ...collectCrossFieldProblems(validated),
  ];

  if (problems.length > 0) {
    throw new EnvironmentValidationError(problems);
  }

  return validated;
}

/** The `✔ (seed)` rows of §7 — required by `npm run seed`, not by the HTTP service. */
export const SEED_REQUIRED_ENV_VARS = [
  'SEED_ADMIN_EMAIL',
  'SEED_ADMIN_PASSWORD',
  'SEED_ADMIN_NAME',
] as const;

/** Asserts the seed-only variables before the seeder writes anything (E-4, S-5). */
export function validateSeedEnv(config: Record<string, unknown>): void {
  const problems = SEED_REQUIRED_ENV_VARS.filter((name) => isBlank(config[name])).map(
    (name) => `${name} is required to run the seeder (§7)`,
  );

  if (problems.length > 0) {
    throw new EnvironmentValidationError(problems);
  }
}
