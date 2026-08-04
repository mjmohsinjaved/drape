import { NotificationConfigError } from './exceptions/notification.exception';
import {
  EMAIL_DRIVERS,
  SMS_DRIVERS,
  type EmailDriver,
  type NotificationsConfig,
  type SmsDriver,
} from './interfaces/notifications-options.interface';
import {
  DEFAULT_NOTIFICATION_LOCALE,
  NOTIFICATION_LOCALES,
  type NotificationLocale,
} from './interfaces/send-result.interface';
import {
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_JITTER_RATIO,
  DEFAULT_BACKOFF_MAX_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_SEND_TIMEOUT_MS,
} from './notifications.constants';

/**
 * Builds `NotificationsConfig` from environment variables (docs/ARCHITECTURE.md §7).
 *
 * Two rules hold throughout:
 *  - **No secret has a fallback default.** A missing `SMTP_PASSWORD` or `SMS_HTTP_API_KEY` throws.
 *  - Variables §7 marks required throw when absent, even when a sensible value exists. Startup
 *    failing loudly beats a production box quietly mailing from the console driver (E-2).
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

function required(env: EnvSource, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new NotificationConfigError(`${name} is required and has no default.`);
  }
  return value.trim();
}

function optional(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}

function readInt(env: EnvSource, name: string, fallback: number): number {
  const raw = optional(env, name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new NotificationConfigError(`${name} must be a positive integer, got "${raw}".`);
  }
  return parsed;
}

function readBoolean(env: EnvSource, name: string, fallback: boolean): boolean {
  const raw = optional(env, name)?.toLowerCase();
  if (raw === undefined) {
    return fallback;
  }
  if (raw === 'true' || raw === '1') {
    return true;
  }
  if (raw === 'false' || raw === '0') {
    return false;
  }
  throw new NotificationConfigError(`${name} must be true or false, got "${raw}".`);
}

function readEmailDriver(env: EnvSource): EmailDriver {
  const value = required(env, 'EMAIL_DRIVER');
  const match = EMAIL_DRIVERS.find((driver) => driver === value);
  if (match === undefined) {
    throw new NotificationConfigError(
      `EMAIL_DRIVER must be one of ${EMAIL_DRIVERS.join(' | ')}, got "${value}".`,
    );
  }
  return match;
}

function readSmsDriver(env: EnvSource): SmsDriver {
  const value = required(env, 'SMS_DRIVER');
  const match = SMS_DRIVERS.find((driver) => driver === value);
  if (match === undefined) {
    throw new NotificationConfigError(
      `SMS_DRIVER must be one of ${SMS_DRIVERS.join(' | ')}, got "${value}".`,
    );
  }
  return match;
}

function readLocale(env: EnvSource): NotificationLocale {
  const raw = optional(env, 'NOTIFICATIONS_DEFAULT_LOCALE');
  if (raw === undefined) {
    return DEFAULT_NOTIFICATION_LOCALE;
  }
  const upper = raw.toUpperCase();
  const match = NOTIFICATION_LOCALES.find((locale) => locale === upper);
  if (match === undefined) {
    throw new NotificationConfigError(
      `NOTIFICATIONS_DEFAULT_LOCALE must be one of ${NOTIFICATION_LOCALES.join(' | ')}, got "${raw}".`,
    );
  }
  return match;
}

/** `Drape <hello@example.com>` → `hello@example.com`. A bare address passes through untouched. */
export function extractEmailAddress(from: string): string {
  const angled = /<([^>]+)>/.exec(from);
  return (angled === null ? from : angled[1]).trim();
}

export function loadNotificationsConfigFromEnv(env: EnvSource = process.env): NotificationsConfig {
  const emailDriver = readEmailDriver(env);
  const smsDriver = readSmsDriver(env);

  const smtp =
    emailDriver === 'smtp'
      ? {
          host: required(env, 'SMTP_HOST'),
          port: readInt(env, 'SMTP_PORT', 587),
          user: required(env, 'SMTP_USER'),
          password: required(env, 'SMTP_PASSWORD'),
          secure: readBoolean(env, 'SMTP_SECURE', false),
        }
      : undefined;

  const httpSms =
    smsDriver === 'http'
      ? {
          url: required(env, 'SMS_HTTP_URL'),
          apiKey: required(env, 'SMS_HTTP_API_KEY'),
        }
      : undefined;

  const emailFrom = required(env, 'EMAIL_FROM');

  return {
    emailDriver,
    emailFrom,
    smtp,

    smsDriver,
    smsSenderId:
      smsDriver === 'http' ? required(env, 'SMS_SENDER_ID') : optional(env, 'SMS_SENDER_ID'),
    httpSms,

    webUrl: required(env, 'APP_WEB_URL'),
    brandName: optional(env, 'BRAND_NAME') ?? 'Drape',
    supportEmail: optional(env, 'SUPPORT_EMAIL') ?? extractEmailAddress(emailFrom),
    defaultLocale: readLocale(env),
    timeZone: optional(env, 'TIMEZONE') ?? 'Asia/Karachi',

    timeoutMs: readInt(env, 'NOTIFICATIONS_TIMEOUT_MS', DEFAULT_SEND_TIMEOUT_MS),
    maxAttempts: readInt(env, 'NOTIFICATIONS_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS),
    backoffBaseMs: readInt(env, 'NOTIFICATIONS_BACKOFF_BASE_MS', DEFAULT_BACKOFF_BASE_MS),
    backoffMaxMs: readInt(env, 'NOTIFICATIONS_BACKOFF_MAX_MS', DEFAULT_BACKOFF_MAX_MS),
    backoffJitterRatio: DEFAULT_BACKOFF_JITTER_RATIO,

    consoleLogBody: readBoolean(env, 'NOTIFICATIONS_CONSOLE_LOG_BODY', false),
  };
}
