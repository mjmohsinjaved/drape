import { NotificationErrorCode } from '../interfaces/send-result.interface';

export interface NotificationErrorOptions {
  /** True when another attempt could plausibly succeed. Defaults to false. */
  readonly retryable?: boolean;
  /** The driver that raised it, when known. */
  readonly providerName?: string | null;
  readonly cause?: unknown;
}

/**
 * Base typed error for the notifications library.
 *
 * Providers signal failure by throwing one of these; `NotificationsService` converts the throw into
 * a `SendResult` and never lets it escape into a request path (PRD E-11). Only configuration errors
 * are meant to surface — at boot, where a missing setting should stop the process.
 */
export class NotificationError extends Error {
  readonly code: NotificationErrorCode;
  readonly retryable: boolean;
  readonly providerName: string | null;

  constructor(
    code: NotificationErrorCode,
    message: string,
    options: NotificationErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.providerName = options.providerName ?? null;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** The provider did not answer inside the per-attempt timeout. Always retryable. */
export class NotificationTimeoutError extends NotificationError {
  constructor(message: string, options: Omit<NotificationErrorOptions, 'retryable'> = {}) {
    super(NotificationErrorCode.NOTIFICATION_TIMEOUT, message, { ...options, retryable: true });
  }
}

/** The provider refused, failed or could not be reached. */
export class NotificationProviderError extends NotificationError {}

/** Module configuration is incomplete. Raised at boot so startup fails loudly (E-2). */
export class NotificationConfigError extends NotificationError {
  constructor(message: string, options: Omit<NotificationErrorOptions, 'retryable'> = {}) {
    super(NotificationErrorCode.NOTIFICATION_CONFIG_INVALID, message, {
      ...options,
      retryable: false,
    });
  }
}

/** The template id is unknown or its props are unusable. Never retryable. */
export class NotificationTemplateError extends NotificationError {
  constructor(message: string, options: Omit<NotificationErrorOptions, 'retryable'> = {}) {
    super(NotificationErrorCode.NOTIFICATION_TEMPLATE_INVALID, message, {
      ...options,
      retryable: false,
    });
  }
}

/**
 * Normalises anything thrown by a provider into a `NotificationError`.
 * An unrecognised throw is treated as a retryable provider error — one more attempt is cheaper
 * than a lost notification.
 */
export function toNotificationError(error: unknown, providerName?: string): NotificationError {
  if (error instanceof NotificationError) {
    return error;
  }
  const message = error instanceof Error ? error.message : 'Provider threw a non-Error value.';
  return new NotificationProviderError(NotificationErrorCode.NOTIFICATION_PROVIDER_ERROR, message, {
    retryable: true,
    providerName: providerName ?? null,
    cause: error,
  });
}
