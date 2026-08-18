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
  GEMINI = 'gemini',
  OPENAI = 'openai',
}

export const TRYON_DRIVER_NAMES: readonly TryOnDriverName[] = [
  TryOnDriverName.MOCK,
  TryOnDriverName.HTTP,
  TryOnDriverName.GEMINI,
  TryOnDriverName.OPENAI,
];

export enum OpenAiImageQuality {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export const OPENAI_IMAGE_QUALITIES: readonly OpenAiImageQuality[] = [
  OpenAiImageQuality.LOW,
  OpenAiImageQuality.MEDIUM,
  OpenAiImageQuality.HIGH,
];

export const DEFAULT_OPENAI_TIMEOUT_MS = 120_000;

export enum EmailDriverName {
  CONSOLE = 'console',
  SMTP = 'smtp',
}

export enum SmsDriverName {
  CONSOLE = 'console',
  HTTP = 'http',
}

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

function toInt(value: unknown, fallback?: number): number | undefined {
  if (isBlank(value)) return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function toFloat(value: unknown, fallback?: number): number | undefined {
  return toInt(value, fallback);
}

function toBool(value: unknown, fallback: boolean): boolean | undefined {
  if (isBlank(value)) return fallback;
  const normalised = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalised)) return true;
  if (['false', '0', 'no', 'off'].includes(normalised)) return false;
  return undefined;
}

function toList(value: unknown): string[] {
  if (isBlank(value)) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const HEX_64 = /^[0-9a-fA-F]{64}$/;
const HEX_64_MESSAGE = 'must be exactly 64 hexadecimal characters';

export class EnvironmentVariables {
  @IsEnum(NodeEnv, { message: `NODE_ENV must be one of: ${Object.values(NodeEnv).join(', ')}` })
  NODE_ENV: NodeEnv;

  @Transform(({ value }) => toInt(value, 4000))
  @IsInt()
  @Min(1)
  @Max(65535)
  API_PORT: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/^https?:\/\/\S+$/, { message: 'APP_WEB_URL must be an http(s) URL' })
  APP_WEB_URL: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^https?:\/\/\S+$/, { message: 'APP_API_URL must be an http(s) URL' })
  APP_API_URL: string;

  @Transform(({ value }) => toList(value))
  @IsArray()
  @ArrayNotEmpty({ message: 'CORS_ORIGINS must list at least one origin' })
  @IsString({ each: true })
  @Matches(/^https?:\/\/\S+$/, {
    each: true,
    message: 'every CORS_ORIGINS entry must be an http(s) origin — "*" is never allowed (B-7)',
  })
  CORS_ORIGINS: string[];

  @Transform(({ value }) => toInt(value, 0))
  @IsInt()
  @Min(0)
  @Max(10)
  TRUST_PROXY: number;

  @IsEnum(LogLevel)
  @Transform(({ value }) => (isBlank(value) ? LogLevel.INFO : String(value).toLowerCase()))
  LOG_LEVEL: LogLevel;

  @Transform(({ value }) => toBool(value, false))
  @IsBoolean()
  EXPOSE_API_DOCS: boolean = false;

  @IsString()
  @IsNotEmpty()
  @Matches(/^postgres(ql)?:\/\/\S+$/, {
    message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string',
  })
  DATABASE_URL: string;

  @Transform(({ value }) => toBool(value, false))
  @IsBoolean()
  DATABASE_SSL: boolean;

  @Transform(({ value }) => toInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(200)
  DATABASE_POOL_MAX: number;

  @Transform(({ value }) => toInt(value, 2))
  @IsInt()
  @Min(0)
  @Max(200)
  DATABASE_POOL_MIN: number;

  @Transform(({ value }) => (isBlank(value) ? 'drape.sid' : String(value)))
  @IsString()
  @IsNotEmpty()
  SESSION_COOKIE_NAME: string;

  @IsString()
  @IsNotEmpty()
  SESSION_COOKIE_DOMAIN: string;

  @Matches(HEX_64, { message: `SESSION_SECRET ${HEX_64_MESSAGE}` })
  SESSION_SECRET: string;

  @Transform(({ value }) => toInt(value, 12))
  @IsInt()
  @Min(1)
  SESSION_ADMIN_IDLE_HOURS: number;

  @Transform(({ value }) => toInt(value, 30))
  @IsInt()
  @Min(1)
  SESSION_CONSUMER_IDLE_DAYS: number;

  @Transform(({ value }) => toInt(value, 7))
  @IsInt()
  @Min(1)
  SESSION_ADMIN_ABSOLUTE_DAYS: number;

  @Transform(({ value }) => toInt(value, 90))
  @IsInt()
  @Min(1)
  SESSION_CONSUMER_ABSOLUTE_DAYS: number;

  @Transform(({ value }) => toBool(value, false))
  @IsBoolean()
  SESSION_COOKIE_SECURE: boolean;

  @Transform(({ value }) => (isBlank(value) ? 'drape.csrf' : String(value)))
  @IsString()
  @IsNotEmpty()
  CSRF_COOKIE_NAME: string;

  @Matches(HEX_64, { message: `CSRF_SECRET ${HEX_64_MESSAGE}` })
  CSRF_SECRET: string;

  @Transform(({ value }) => toInt(value, 19456))
  @IsInt()
  @Min(8192)
  ARGON2_MEMORY_KIB: number;

  @Transform(({ value }) => toInt(value, 2))
  @IsInt()
  @Min(1)
  ARGON2_TIME_COST: number;

  @Transform(({ value }) => toInt(value, 1))
  @IsInt()
  @Min(1)
  ARGON2_PARALLELISM: number;

  @Matches(HEX_64, { message: `TWOFA_ENCRYPTION_KEY ${HEX_64_MESSAGE}` })
  TWOFA_ENCRYPTION_KEY: string;

  @Transform(({ value }) => (isBlank(value) ? 'Drape' : String(value)))
  @IsString()
  @IsNotEmpty()
  TWOFA_ISSUER: string;

  @Transform(({ value }) =>
    isBlank(value) ? StorageDriverName.LOCAL : String(value).toLowerCase(),
  )
  @IsEnum(StorageDriverName)
  STORAGE_DRIVER: StorageDriverName;

  @IsString()
  @IsNotEmpty()
  STORAGE_ROOT: string;

  @Matches(HEX_64, { message: `STORAGE_URL_SECRET ${HEX_64_MESSAGE}` })
  STORAGE_URL_SECRET: string;

  @Transform(({ value }) => toInt(value, 300))
  @IsInt()
  @Min(30)
  STORAGE_URL_TTL_PHOTO_SECONDS: number;

  @Transform(({ value }) => toInt(value, 900))
  @IsInt()
  @Min(30)
  STORAGE_URL_TTL_RENDER_SECONDS: number;

  @Transform(({ value }) => toInt(value, 3600))
  @IsInt()
  @Min(30)
  STORAGE_URL_TTL_PUBLIC_SECONDS: number;

  @Transform(({ value }) => toInt(value, 900))
  @IsInt()
  @Min(30)
  STORAGE_UPLOAD_TICKET_TTL_SECONDS: number;

  @Transform(({ value }) => toInt(value, 25))
  @IsInt()
  @Min(1)
  STORAGE_MAX_UPLOAD_MB: number;

  @Transform(({ value }) => toInt(value, 2048))
  @IsInt()
  @Min(0)
  STORAGE_MIN_FREE_MB: number;

  @Transform(({ value }): unknown => (isBlank(value) ? value : String(value).toLowerCase()))
  @IsEnum(TryOnDriverName)
  TRYON_DRIVER: TryOnDriverName;

  @ValidateIf((env: EnvironmentVariables) => env.TRYON_DRIVER === TryOnDriverName.HTTP)
  @IsString()
  @IsNotEmpty({ message: 'TRYONCLOUD_BASE_URL is required when TRYON_DRIVER=http' })
  @Matches(/^https?:\/\/\S+$/, { message: 'TRYONCLOUD_BASE_URL must be an http(s) URL' })
  TRYONCLOUD_BASE_URL?: string;

  @ValidateIf((env: EnvironmentVariables) => env.TRYON_DRIVER === TryOnDriverName.HTTP)
  @IsString()
  @IsNotEmpty({ message: 'TRYONCLOUD_API_KEY is required when TRYON_DRIVER=http' })
  TRYONCLOUD_API_KEY?: string;

  @ValidateIf((env: EnvironmentVariables) => env.TRYON_DRIVER === TryOnDriverName.GEMINI)
  @IsString()
  @IsNotEmpty({ message: 'GEMINI_BASE_URL is required when TRYON_DRIVER=gemini' })
  @Matches(/^https?:\/\/\S+$/, { message: 'GEMINI_BASE_URL must be an http(s) URL' })
  GEMINI_BASE_URL?: string;

  @ValidateIf((env: EnvironmentVariables) => env.TRYON_DRIVER === TryOnDriverName.GEMINI)
  @IsString()
  @IsNotEmpty({ message: 'GEMINI_API_KEY is required when TRYON_DRIVER=gemini' })
  GEMINI_API_KEY?: string;

  @ValidateIf((env: EnvironmentVariables) => env.TRYON_DRIVER === TryOnDriverName.GEMINI)
  @IsString()
  @IsNotEmpty({ message: 'GEMINI_IMAGE_MODEL is required when TRYON_DRIVER=gemini' })
  GEMINI_IMAGE_MODEL?: string;

  @ValidateIf((env: EnvironmentVariables) => env.TRYON_DRIVER === TryOnDriverName.OPENAI)
  @IsString()
  @IsNotEmpty({ message: 'OPENAI_BASE_URL is required when TRYON_DRIVER=openai' })
  @Matches(/^https?:\/\/\S+$/, { message: 'OPENAI_BASE_URL must be an http(s) URL' })
  OPENAI_BASE_URL?: string;

  @ValidateIf((env: EnvironmentVariables) => env.TRYON_DRIVER === TryOnDriverName.OPENAI)
  @IsString()
  @IsNotEmpty({ message: 'OPENAI_API_KEY is required when TRYON_DRIVER=openai' })
  OPENAI_API_KEY?: string;

  @ValidateIf((env: EnvironmentVariables) => env.TRYON_DRIVER === TryOnDriverName.OPENAI)
  @IsString()
  @IsNotEmpty({ message: 'OPENAI_IMAGE_MODEL is required when TRYON_DRIVER=openai' })
  OPENAI_IMAGE_MODEL?: string;

  @IsOptional()
  @Transform(({ value }) => toInt(value, DEFAULT_OPENAI_TIMEOUT_MS))
  @IsInt()
  @Min(1000)
  TRYON_OPENAI_TIMEOUT_MS?: number;

  @IsString()
  @IsNotEmpty()
  TRYON_API_VERSION: string;

  @Transform(({ value }) => toInt(value, 20000))
  @IsInt()
  @Min(1000)
  TRYON_TIMEOUT_MS: number;

  @Transform(({ value }) => toInt(value, 3))
  @IsInt()
  @Min(1)
  @Max(10)
  TRYON_MAX_ATTEMPTS: number;

  @Transform(({ value }) => toInt(value, 800))
  @IsInt()
  @Min(0)
  TRYON_BACKOFF_BASE_MS: number;

  @Transform(({ value }) => toInt(value, 1))
  @IsInt()
  @Min(1)
  TRYON_TEST_RENDER_CONCURRENCY: number;

  @Transform(({ value }) => toInt(value, 7000))
  @IsInt()
  @Min(0)
  TRYON_MOCK_LATENCY_MS: number;

  @Transform(({ value }) => toFloat(value, 0))
  @IsNumber()
  @Min(0)
  @Max(1)
  TRYON_MOCK_FAILURE_RATE: number;

  @Transform(({ value }): unknown => (isBlank(value) ? value : String(value).toLowerCase()))
  @IsEnum(EmailDriverName)
  EMAIL_DRIVER: EmailDriverName;

  @IsString()
  @IsNotEmpty()
  EMAIL_FROM: string;

  @ValidateIf((env: EnvironmentVariables) => env.EMAIL_DRIVER === EmailDriverName.SMTP)
  @IsString()
  @IsNotEmpty({ message: 'SMTP_HOST is required when EMAIL_DRIVER=smtp' })
  SMTP_HOST?: string;

  @ValidateIf((env: EnvironmentVariables) => env.EMAIL_DRIVER === EmailDriverName.SMTP)
  @Transform(({ value }) => toInt(value))
  @IsInt({ message: 'SMTP_PORT is required when EMAIL_DRIVER=smtp and must be a port number' })
  @Min(1)
  @Max(65535)
  SMTP_PORT?: number;

  @ValidateIf((env: EnvironmentVariables) => env.EMAIL_DRIVER === EmailDriverName.SMTP)
  @IsString()
  @IsNotEmpty({ message: 'SMTP_USER is required when EMAIL_DRIVER=smtp' })
  SMTP_USER?: string;

  @ValidateIf((env: EnvironmentVariables) => env.EMAIL_DRIVER === EmailDriverName.SMTP)
  @IsString()
  @IsNotEmpty({ message: 'SMTP_PASSWORD is required when EMAIL_DRIVER=smtp' })
  SMTP_PASSWORD?: string;

  @Transform(({ value }) => toBool(value, false))
  @IsBoolean()
  SMTP_SECURE: boolean;

  @Transform(({ value }): unknown => (isBlank(value) ? value : String(value).toLowerCase()))
  @IsEnum(SmsDriverName)
  SMS_DRIVER: SmsDriverName;

  @ValidateIf((env: EnvironmentVariables) => env.SMS_DRIVER === SmsDriverName.HTTP)
  @IsString()
  @IsNotEmpty({ message: 'SMS_HTTP_URL is required when SMS_DRIVER=http' })
  @Matches(/^https?:\/\/\S+$/, { message: 'SMS_HTTP_URL must be an http(s) URL' })
  SMS_HTTP_URL?: string;

  @ValidateIf((env: EnvironmentVariables) => env.SMS_DRIVER === SmsDriverName.HTTP)
  @IsString()
  @IsNotEmpty({ message: 'SMS_HTTP_API_KEY is required when SMS_DRIVER=http' })
  SMS_HTTP_API_KEY?: string;

  @ValidateIf((env: EnvironmentVariables) => env.SMS_DRIVER === SmsDriverName.HTTP)
  @IsString()
  @IsNotEmpty({ message: 'SMS_SENDER_ID is required when SMS_DRIVER=http' })
  SMS_SENDER_ID?: string;

  @Transform(({ value }) => toInt(value, 600))
  @IsInt()
  @Min(60)
  OTP_TTL_SECONDS: number;

  @Transform(({ value }) => toInt(value, 30))
  @IsInt()
  @Min(1)
  PASSWORD_RESET_TTL_MINUTES: number;

  @Transform(({ value }) => toInt(value, 24))
  @IsInt()
  @Min(1)
  EMAIL_VERIFY_TTL_HOURS: number;

  @Transform(({ value }) => toInt(value, 7))
  @IsInt()
  @Min(1)
  INVITE_TTL_DAYS: number;

  @Transform(({ value }) => toInt(value, 60))
  @IsInt()
  @Min(1)
  THROTTLE_TTL_SECONDS: number;

  @Transform(({ value }) => toInt(value, 100))
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT: number;

  @Transform(({ value }) => toInt(value, 20))
  @IsInt()
  @Min(1)
  TRYON_RATE_PER_HOUR: number;

  @Transform(({ value }) => toInt(value, 40))
  @IsInt()
  @Min(1)
  TRYON_RATE_PER_IP_HOUR: number;

  @Transform(({ value }) => toInt(value, 5))
  @IsInt()
  @Min(1)
  LOGIN_LOCKOUT_THRESHOLD: number;

  @Transform(({ value }) => toInt(value, 60))
  @IsInt()
  @Min(1)
  LOGIN_LOCKOUT_MAX_MINUTES: number;

  @Transform(({ value }) => toInt(value, 15))
  @IsInt()
  @Min(0)
  QUOTA_DEFAULT_MONTHLY: number;

  @Transform(({ value }) => toInt(value, 2000))
  @IsInt()
  @Min(0)
  BUDGET_DEFAULT_MONTHLY: number;

  @Transform(({ value }) => toInt(value, 80))
  @IsInt()
  @Min(1)
  @Max(100)
  BUDGET_WARN_PERCENT: number;

  @Transform(({ value }) => toInt(value, 30))
  @IsInt()
  @Min(1)
  PHOTO_RETENTION_DAYS: number;

  @Transform(({ value }) => toInt(value, 90))
  @IsInt()
  @Min(1)
  JOB_RETENTION_DAYS: number;

  @Transform(({ value }) => toInt(value, 24))
  @IsInt()
  @Min(1)
  DELETION_SLA_HOURS: number;

  @Transform(({ value }) => (isBlank(value) ? 'Asia/Karachi' : String(value)))
  @IsString()
  @IsNotEmpty()
  TIMEZONE: string;

  @IsOptional()
  @IsEmail({}, { message: 'SEED_ADMIN_EMAIL must be an email address' })
  SEED_ADMIN_EMAIL?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  SEED_ADMIN_PASSWORD?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  SEED_ADMIN_NAME?: string;
}

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

export const SEED_REQUIRED_ENV_VARS = [
  'SEED_ADMIN_EMAIL',
  'SEED_ADMIN_PASSWORD',
  'SEED_ADMIN_NAME',
] as const;

export function validateSeedEnv(config: Record<string, unknown>): void {
  const problems = SEED_REQUIRED_ENV_VARS.filter((name) => isBlank(config[name])).map(
    (name) => `${name} is required to run the seeder (§7)`,
  );

  if (problems.length > 0) {
    throw new EnvironmentValidationError(problems);
  }
}
