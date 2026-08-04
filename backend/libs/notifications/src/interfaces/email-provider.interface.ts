import { type NotificationLocale } from './send-result.interface';

/** Context the façade hands every attempt. Providers must honour `signal`. */
export interface ProviderSendContext {
  /** 1-based attempt number within the retry budget. */
  readonly attempt: number;
  /** Per-attempt deadline in milliseconds. */
  readonly timeoutMs: number;
  /** Aborted when the deadline passes. Pass it straight to the transport. */
  readonly signal: AbortSignal;
  readonly locale: NotificationLocale;
  /** Template id when the message came from the registry, otherwise null. */
  readonly template: string | null;
  /** Request or outbox id, for correlating provider logs with ours. */
  readonly correlationId: string | null;
}

/** What a provider returns when the transport accepted the message. */
export interface ProviderSendOutcome {
  /** Provider-side identifier, when one is returned. */
  readonly messageId: string | null;
  readonly acceptedAt: Date;
}

/** A rendered email, ready for a transport. Both bodies are always present. */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  /** Plain-text alternative. Never optional — every template produces one. */
  readonly text: string;
  readonly replyTo?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * The email driver contract.
 *
 * Adding a provider means implementing this interface and registering it in
 * `NotificationsModule` — or passing it as `emailProvider` in the module options. No call site
 * changes, exactly as `StorageDriver` works in docs/ARCHITECTURE.md §3.1.
 *
 * A provider signals failure by **throwing** a `NotificationError` with an accurate `retryable`
 * flag. It never returns a partial success and never swallows an error.
 */
export interface EmailProvider {
  /** Stable driver name. Appears in `SendResult.provider` and in logs. */
  readonly name: string;

  send(message: EmailMessage, context: ProviderSendContext): Promise<ProviderSendOutcome>;

  /** Optional readiness probe for `/health/ready`. Throws a `NotificationError` when unhealthy. */
  verifyConnection?(): Promise<void>;

  /** Optional teardown on shutdown. */
  close?(): void | Promise<void>;
}
