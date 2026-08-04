import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';

import { createTransport, type Transporter } from 'nodemailer';

import {
  NotificationConfigError,
  NotificationProviderError,
  NotificationTimeoutError,
  type NotificationError,
} from '../exceptions/notification.exception';
import {
  type EmailMessage,
  type EmailProvider,
  type ProviderSendContext,
  type ProviderSendOutcome,
} from '../interfaces/email-provider.interface';
import { type SmtpTransportOptions } from '../interfaces/notifications-options.interface';
import { NotificationErrorCode } from '../interfaces/send-result.interface';
import { SMTP_EMAIL_PROVIDER_NAME } from '../notifications.constants';
import { maskEmail, summariseProviderMessage } from '../utils/redact.util';

/**
 * The only part of nodemailer's send result this provider reads.
 *
 * `@types/nodemailer` has no 7.x line, so the untyped `createTransport()` result
 * widens `sendMail()` to `any` and every property access becomes unsafe. Naming
 * the shape we depend on keeps the boundary typed and documents the coupling.
 */
interface SentMessageInfo {
  readonly messageId?: string;
}

export interface SmtpEmailProviderConfig extends SmtpTransportOptions {
  /** `EMAIL_FROM`. */
  readonly from: string;
  /** Per-attempt deadline, applied to connection, greeting and socket alike. */
  readonly timeoutMs: number;
}

/** Nodemailer surfaces its own codes on the error object. These are the ones worth reacting to. */
const RETRYABLE_TRANSPORT_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNECTION',
  'ECONNRESET',
  'ECONNREFUSED',
  'EDNS',
  'EAI_AGAIN',
  'EPIPE',
  'ESTREAM',
]);

function readField(value: unknown, key: string): unknown {
  if (typeof value === 'object' && value !== null && key in value) {
    return (value as Record<string, unknown>)[key];
  }
  return undefined;
}

/**
 * SMTP driver (`EMAIL_DRIVER=smtp`).
 *
 * The transporter is created once and pooled, so sockets are reused across sends rather than
 * renegotiated per message. Every phase of the conversation carries the same timeout, so a hung
 * SMTP server cannot hold a request open (PRD E-11). Credentials come from config only — there is
 * no fallback for a missing host, user or password (E-2).
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider, OnModuleDestroy {
  readonly name = SMTP_EMAIL_PROVIDER_NAME;

  private readonly logger = new Logger(SmtpEmailProvider.name);

  private transporter: Transporter<SentMessageInfo> | null = null;

  constructor(private readonly config: SmtpEmailProviderConfig) {
    if (config.host.trim().length === 0) {
      throw new NotificationConfigError('SMTP_HOST is required when EMAIL_DRIVER is `smtp`.');
    }
    if (!Number.isInteger(config.port) || config.port <= 0) {
      throw new NotificationConfigError('SMTP_PORT must be a positive integer.');
    }
    if (config.user.length === 0 || config.password.length === 0) {
      throw new NotificationConfigError(
        'SMTP_USER and SMTP_PASSWORD are required when EMAIL_DRIVER is `smtp`.',
      );
    }
  }

  async send(message: EmailMessage, context: ProviderSendContext): Promise<ProviderSendOutcome> {
    try {
      const info = await this.getTransporter().sendMail({
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
        headers: message.headers,
      });

      const messageId = typeof info.messageId === 'string' ? info.messageId : null;
      this.logger.log(
        `email accepted · to=${maskEmail(message.to)} attempt=${context.attempt} messageId=${messageId ?? 'none'}`,
      );
      return { messageId, acceptedAt: new Date() };
    } catch (error) {
      throw this.toNotificationError(error);
    }
  }

  async verifyConnection(): Promise<void> {
    try {
      await this.getTransporter().verify();
    } catch (error) {
      throw this.toNotificationError(error);
    }
  }

  onModuleDestroy(): void {
    this.close();
  }

  close(): void {
    if (this.transporter !== null) {
      this.transporter.close();
      this.transporter = null;
    }
  }

  /** Created lazily and kept, so the pool survives between sends. */
  private getTransporter(): Transporter<SentMessageInfo> {
    if (this.transporter === null) {
      // The generic on `createTransport` names the *transport*, not the result,
      // so the options object must stay uninstantiated and the result narrowed.
      this.transporter = createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: { user: this.config.user, pass: this.config.password },
        pool: true,
        maxConnections: this.config.maxConnections ?? 3,
        maxMessages: this.config.maxMessages ?? 100,
        connectionTimeout: this.config.timeoutMs,
        greetingTimeout: this.config.timeoutMs,
        socketTimeout: this.config.timeoutMs,
      });
    }
    return this.transporter;
  }

  private toNotificationError(error: unknown): NotificationError {
    const rawMessage = error instanceof Error ? error.message : 'SMTP send failed.';
    const message = summariseProviderMessage(rawMessage);
    const code = readField(error, 'code');
    const responseCode = readField(error, 'responseCode');

    if (code === 'ETIMEDOUT' || code === 'ESOCKET') {
      return new NotificationTimeoutError(message, {
        providerName: this.name,
        cause: error,
      });
    }

    if (code === 'EAUTH') {
      return new NotificationProviderError(
        NotificationErrorCode.NOTIFICATION_AUTH_FAILED,
        message,
        {
          retryable: false,
          providerName: this.name,
          cause: error,
        },
      );
    }

    if (code === 'EENVELOPE') {
      return new NotificationProviderError(
        NotificationErrorCode.NOTIFICATION_INVALID_RECIPIENT,
        message,
        { retryable: false, providerName: this.name, cause: error },
      );
    }

    if (typeof responseCode === 'number') {
      // 4xx is a transient refusal; 5xx is permanent. Retrying a 5xx just annoys the server.
      const retryable = responseCode >= 400 && responseCode < 500;
      return new NotificationProviderError(
        retryable
          ? NotificationErrorCode.NOTIFICATION_PROVIDER_UNAVAILABLE
          : NotificationErrorCode.NOTIFICATION_PROVIDER_ERROR,
        `SMTP ${responseCode}: ${message}`,
        { retryable, providerName: this.name, cause: error },
      );
    }

    if (typeof code === 'string' && RETRYABLE_TRANSPORT_CODES.has(code)) {
      return new NotificationProviderError(
        NotificationErrorCode.NOTIFICATION_PROVIDER_UNAVAILABLE,
        message,
        { retryable: true, providerName: this.name, cause: error },
      );
    }

    return new NotificationProviderError(
      NotificationErrorCode.NOTIFICATION_PROVIDER_ERROR,
      message,
      { retryable: true, providerName: this.name, cause: error },
    );
  }
}
