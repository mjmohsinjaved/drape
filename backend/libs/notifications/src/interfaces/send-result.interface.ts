/**
 * The result contract every send returns.
 *
 * `NotificationsService.sendEmail()` / `sendSms()` resolve with a `SendResult` in **every** case,
 * including a total provider outage. They never reject — a notification is never allowed to throw
 * into a request path (PRD E-11).
 */

/** Channels this library can actually deliver on. `IN_APP` rows never reach a provider. */
export type NotificationChannelName = 'EMAIL' | 'SMS';

/** Locales the templates are written in. Mirrors `locale_enum` in docs/ARCHITECTURE.md §4.1. */
export const NOTIFICATION_LOCALES = ['EN', 'UR'] as const;

export type NotificationLocale = (typeof NOTIFICATION_LOCALES)[number];

export const DEFAULT_NOTIFICATION_LOCALE: NotificationLocale = 'EN';

/** Text direction per locale. Urdu is RTL (docs/ARCHITECTURE.md §6.7). */
export const NOTIFICATION_DIRECTION: Readonly<Record<NotificationLocale, 'ltr' | 'rtl'>> = {
  EN: 'ltr',
  UR: 'rtl',
};

/**
 * Operator-facing failure codes. These are never shown to a consumer — the outbox stores the code
 * in `lastError` and the UI reads its own copy.
 */
export enum NotificationErrorCode {
  /** The provider did not answer inside the per-attempt timeout. */
  NOTIFICATION_TIMEOUT = 'NOTIFICATION_TIMEOUT',
  /** The provider answered, and the answer was a failure. */
  NOTIFICATION_PROVIDER_ERROR = 'NOTIFICATION_PROVIDER_ERROR',
  /** The provider could not be reached at all (DNS, refused, socket). */
  NOTIFICATION_PROVIDER_UNAVAILABLE = 'NOTIFICATION_PROVIDER_UNAVAILABLE',
  /** The address or number is not deliverable. Retrying cannot help. */
  NOTIFICATION_INVALID_RECIPIENT = 'NOTIFICATION_INVALID_RECIPIENT',
  /** Credentials were rejected. Rotate the key; retrying cannot help. */
  NOTIFICATION_AUTH_FAILED = 'NOTIFICATION_AUTH_FAILED',
  /** The provider is throttling us. */
  NOTIFICATION_RATE_LIMITED = 'NOTIFICATION_RATE_LIMITED',
  /** Module configuration is incomplete or contradictory. Raised at boot, never per request. */
  NOTIFICATION_CONFIG_INVALID = 'NOTIFICATION_CONFIG_INVALID',
  /** The template id is not in the registry, or its props are unusable. */
  NOTIFICATION_TEMPLATE_INVALID = 'NOTIFICATION_TEMPLATE_INVALID',
}

/** Why a send failed, in a shape safe to log and to persist in `notifications_outbox.lastError`. */
export interface SendFailure {
  readonly code: NotificationErrorCode;
  /** Operator-facing detail. Never rendered to a consumer. */
  readonly message: string;
  /** True when another attempt could plausibly succeed. Drives the outbox backoff schedule. */
  readonly retryable: boolean;
}

/** The outcome of one send, whatever happened. */
export interface SendResult {
  readonly ok: boolean;
  readonly channel: NotificationChannelName;
  /** Name of the driver that handled it, e.g. `console-email`, `smtp-email`. */
  readonly provider: string;
  /** Provider-side identifier when one is returned, otherwise null. */
  readonly messageId: string | null;
  /** Masked recipient. The raw address never appears in a result, a log line or a metric. */
  readonly recipient: string;
  /** How many attempts were made, including the one that succeeded. Always >= 1. */
  readonly attempts: number;
  readonly durationMs: number;
  /** Present only when `ok` is false. */
  readonly failure?: SendFailure;
}
