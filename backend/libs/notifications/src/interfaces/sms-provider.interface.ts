import { type ProviderSendContext, type ProviderSendOutcome } from './email-provider.interface';

/** A rendered SMS. Text only — there is no rich SMS in V1. */
export interface SmsMessage {
  /** E.164, e.g. `+923001234567`. */
  readonly to: string;
  readonly text: string;
  /** Alphanumeric sender id where the gateway supports one. */
  readonly senderId?: string;
}

/**
 * The SMS driver contract.
 *
 * Same extension rule as `EmailProvider`: implement, register, done. Callers never learn which
 * gateway is behind it.
 */
export interface SmsProvider {
  /** Stable driver name. Appears in `SendResult.provider` and in logs. */
  readonly name: string;

  send(message: SmsMessage, context: ProviderSendContext): Promise<ProviderSendOutcome>;

  /** Optional readiness probe. Throws a `NotificationError` when unhealthy. */
  verifyConnection?(): Promise<void>;

  /** Optional teardown on shutdown. */
  close?(): void | Promise<void>;
}
