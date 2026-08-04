import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';

import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';

import axios, { type AxiosInstance, type AxiosResponse } from 'axios';

import {
  NotificationConfigError,
  NotificationProviderError,
  NotificationTimeoutError,
  type NotificationError,
} from '../exceptions/notification.exception';
import {
  type ProviderSendContext,
  type ProviderSendOutcome,
} from '../interfaces/email-provider.interface';
import { type HttpSmsTransportOptions } from '../interfaces/notifications-options.interface';
import { NotificationErrorCode } from '../interfaces/send-result.interface';
import { type SmsMessage, type SmsProvider } from '../interfaces/sms-provider.interface';
import { type SmsRequestBody } from '../interfaces/sms-transport.interface';
import { HTTP_SMS_PROVIDER_NAME } from '../notifications.constants';
import { maskPhone, summariseProviderMessage } from '../utils/redact.util';

export interface HttpSmsProviderConfig extends HttpSmsTransportOptions {
  /** `SMS_SENDER_ID`. */
  readonly senderId: string;
  /** Per-attempt deadline. */
  readonly timeoutMs: number;
}

/** Default body. A gateway with different field names supplies `buildRequestBody`. */
function defaultRequestBody(to: string, text: string, senderId: string): SmsRequestBody {
  return { to, from: senderId, message: text };
}

/** Reads the gateway's own id out of a JSON response without trusting its shape. */
function defaultReadMessageId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  for (const key of ['messageId', 'message_id', 'id', 'reference']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }
  return null;
}

/**
 * Generic REST SMS driver (`SMS_DRIVER=http`).
 *
 * Written against no particular gateway: the URL, the credential header, the request body and the
 * message-id extraction are all configurable, so swapping a regional provider is a config change.
 * The credential has no default and no fallback (E-2), every request carries a timeout and the
 * façade's abort signal, and every failure comes back as a typed error with an honest `retryable`
 * flag (E-11).
 */
@Injectable()
export class HttpSmsProvider implements SmsProvider, OnModuleDestroy {
  readonly name = HTTP_SMS_PROVIDER_NAME;

  private readonly logger = new Logger(HttpSmsProvider.name);

  private readonly httpAgent = new HttpAgent({ keepAlive: true, maxSockets: 10 });

  private readonly httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 10 });

  private readonly client: AxiosInstance;

  constructor(private readonly config: HttpSmsProviderConfig) {
    if (config.url.trim().length === 0) {
      throw new NotificationConfigError('SMS_HTTP_URL is required when SMS_DRIVER is `http`.');
    }
    if (config.apiKey.length === 0) {
      throw new NotificationConfigError('SMS_HTTP_API_KEY is required when SMS_DRIVER is `http`.');
    }
    if (config.senderId.trim().length === 0) {
      throw new NotificationConfigError('SMS_SENDER_ID is required when SMS_DRIVER is `http`.');
    }

    const headerName = config.authHeaderName ?? 'Authorization';
    const scheme = config.authScheme ?? 'Bearer';

    this.client = axios.create({
      timeout: config.timeoutMs,
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
      // A 4xx must reach our own classifier rather than axios' default throw path.
      validateStatus: () => true,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...config.extraHeaders,
        [headerName]: scheme.length > 0 ? `${scheme} ${config.apiKey}` : config.apiKey,
      },
    });
  }

  async send(message: SmsMessage, context: ProviderSendContext): Promise<ProviderSendOutcome> {
    const senderId = message.senderId ?? this.config.senderId;
    const buildBody = this.config.buildRequestBody ?? defaultRequestBody;
    const readMessageId = this.config.readMessageId ?? defaultReadMessageId;

    let response: AxiosResponse<unknown>;
    try {
      response = await this.client.post<unknown>(
        this.config.url,
        buildBody(message.to, message.text, senderId),
        { signal: context.signal, timeout: context.timeoutMs },
      );
    } catch (error) {
      throw this.toTransportError(error);
    }

    if (response.status < 200 || response.status >= 300) {
      throw this.toStatusError(response);
    }

    const messageId = readMessageId(response.data);
    this.logger.log(
      `sms accepted · to=${maskPhone(message.to)} attempt=${context.attempt} status=${response.status} messageId=${messageId ?? 'none'}`,
    );
    return { messageId, acceptedAt: new Date() };
  }

  async verifyConnection(): Promise<void> {
    try {
      const response = await this.client.get<unknown>(this.config.url, {
        timeout: this.config.timeoutMs,
      });
      if (response.status >= 500) {
        throw this.toStatusError(response);
      }
    } catch (error) {
      throw this.toTransportError(error);
    }
  }

  onModuleDestroy(): void {
    this.close();
  }

  close(): void {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }

  /** Classifies a non-2xx answer. The gateway told us something — believe the status code. */
  private toStatusError(response: AxiosResponse<unknown>): NotificationError {
    const detail = summariseProviderMessage(
      typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? {}),
      200,
    );
    const message = `SMS gateway returned ${response.status}: ${detail}`;

    if (response.status === 401 || response.status === 403) {
      return new NotificationProviderError(
        NotificationErrorCode.NOTIFICATION_AUTH_FAILED,
        message,
        {
          retryable: false,
          providerName: this.name,
        },
      );
    }
    if (response.status === 429) {
      return new NotificationProviderError(
        NotificationErrorCode.NOTIFICATION_RATE_LIMITED,
        message,
        { retryable: true, providerName: this.name },
      );
    }
    if (response.status === 408) {
      return new NotificationTimeoutError(message, { providerName: this.name });
    }
    if (response.status >= 500) {
      return new NotificationProviderError(
        NotificationErrorCode.NOTIFICATION_PROVIDER_UNAVAILABLE,
        message,
        { retryable: true, providerName: this.name },
      );
    }
    if (response.status === 400 || response.status === 422) {
      return new NotificationProviderError(
        NotificationErrorCode.NOTIFICATION_INVALID_RECIPIENT,
        message,
        { retryable: false, providerName: this.name },
      );
    }
    return new NotificationProviderError(
      NotificationErrorCode.NOTIFICATION_PROVIDER_ERROR,
      message,
      { retryable: false, providerName: this.name },
    );
  }

  /** Classifies a throw from axios: no answer at all, an abort, or a timeout. */
  private toTransportError(error: unknown): NotificationError {
    if (error instanceof NotificationProviderError || error instanceof NotificationTimeoutError) {
      return error;
    }

    if (axios.isAxiosError(error)) {
      const message = summariseProviderMessage(error.message);
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        return new NotificationTimeoutError(message, { providerName: this.name, cause: error });
      }
      if (error.code === 'ERR_CANCELED') {
        return new NotificationTimeoutError('The SMS request was aborted by the deadline.', {
          providerName: this.name,
          cause: error,
        });
      }
      return new NotificationProviderError(
        NotificationErrorCode.NOTIFICATION_PROVIDER_UNAVAILABLE,
        message,
        { retryable: true, providerName: this.name, cause: error },
      );
    }

    const message =
      error instanceof Error ? summariseProviderMessage(error.message) : 'SMS send failed.';
    return new NotificationProviderError(
      NotificationErrorCode.NOTIFICATION_PROVIDER_ERROR,
      message,
      { retryable: true, providerName: this.name, cause: error },
    );
  }
}
