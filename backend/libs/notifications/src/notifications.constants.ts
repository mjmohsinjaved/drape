/**
 * Injection tokens and shared constants for `@library/notifications`.
 *
 * docs/ARCHITECTURE.md §1.1 — the library knows nothing about `@api/*`.
 */

/** Resolved module options (config + optional provider overrides). */
export const NOTIFICATIONS_OPTIONS = Symbol('NOTIFICATIONS_OPTIONS');

/** The active `EmailProvider`, selected from config by `NotificationsModule`. */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

/** The active `SmsProvider`, selected from config by `NotificationsModule`. */
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/** Provider names. A new driver adds a name here and a case in the factory — nothing else. */
export const CONSOLE_EMAIL_PROVIDER_NAME = 'console-email';
export const SMTP_EMAIL_PROVIDER_NAME = 'smtp-email';
export const CONSOLE_SMS_PROVIDER_NAME = 'console-sms';
export const HTTP_SMS_PROVIDER_NAME = 'http-sms';

/** Defaults for the retry/timeout wrapper (PRD E-11). None of these is a secret. */
export const DEFAULT_SEND_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BACKOFF_BASE_MS = 500;
export const DEFAULT_BACKOFF_MAX_MS = 8_000;
export const DEFAULT_BACKOFF_JITTER_RATIO = 0.2;

/** Longest SMS body we will hand to a gateway before truncating in the caller's face. */
export const SMS_MAX_LENGTH = 480;
