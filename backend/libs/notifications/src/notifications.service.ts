import { Inject, Injectable, Logger } from '@nestjs/common';

import { toNotificationError, type NotificationError } from './exceptions/notification.exception';
import {
  type EmailMessage,
  type EmailProvider,
  type ProviderSendContext,
  type ProviderSendOutcome,
} from './interfaces/email-provider.interface';
import { type NotificationsModuleOptions } from './interfaces/notifications-options.interface';
import {
  NotificationErrorCode,
  type NotificationChannelName,
  type NotificationLocale,
  type SendResult,
} from './interfaces/send-result.interface';
import { type SmsMessage, type SmsProvider } from './interfaces/sms-provider.interface';
import { EMAIL_PROVIDER, NOTIFICATIONS_OPTIONS, SMS_PROVIDER } from './notifications.constants';
import { type RenderedTemplate, type TemplateContext } from './templates/shared/template-context';
import {
  renderTemplate,
  TEMPLATE_REGISTRY,
  type TemplateId,
  type TemplatePropsMap,
} from './templates/template-registry';
import {
  isE164PhoneNumber,
  isLikelyEmailAddress,
  normalisePhoneNumber,
} from './utils/recipient.util';
import { maskEmail, maskPhone, summariseProviderMessage } from './utils/redact.util';
import { runWithRetry, type RetryPolicy } from './utils/retry.util';

/** A ready-made email. Use `sendTemplatedEmail` when the body should come from the registry. */
export interface SendEmailInput {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly replyTo?: string;
  readonly locale?: NotificationLocale;
  /** Request id or outbox row id, for correlating logs. */
  readonly correlationId?: string;
  /** Template id when one produced this body. Logged, never sent. */
  readonly template?: string;
}

export interface SendTemplatedEmailInput<K extends TemplateId> {
  readonly to: string;
  readonly template: K;
  readonly props: TemplatePropsMap[K];
  readonly locale?: NotificationLocale;
  readonly replyTo?: string;
  readonly correlationId?: string;
}

export interface SendSmsInput {
  readonly to: string;
  readonly text: string;
  readonly senderId?: string;
  readonly locale?: NotificationLocale;
  readonly correlationId?: string;
  readonly template?: string;
}

export interface SendTemplatedSmsInput<K extends TemplateId> {
  readonly to: string;
  readonly template: K;
  readonly props: TemplatePropsMap[K];
  readonly locale?: NotificationLocale;
  readonly correlationId?: string;
}

export interface RenderTemplateInput<K extends TemplateId> {
  readonly template: K;
  readonly props: TemplatePropsMap[K];
  readonly locale?: NotificationLocale;
  /** Overrides context defaults, for a preview or a test. */
  readonly context?: Partial<Omit<TemplateContext, 'locale'>>;
}

/**
 * The notifications façade.
 *
 * Everything a caller needs is here: render a template, send an email, send an SMS. Which provider
 * is behind it, how long it is given, how many times it is retried and how a failure is classified
 * are all internal.
 *
 * **`sendEmail()` and `sendSms()` never reject.** A provider outage, a timeout, a malformed address
 * — all of them resolve to a `SendResult` with `ok: false` and a typed `failure`. A notification is
 * never allowed to throw into a request path (PRD E-11), so the caller decides what to do with a
 * failed send instead of having a 500 decided for it.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(NOTIFICATIONS_OPTIONS) private readonly options: NotificationsModuleOptions,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
  ) {}

  /** Name of the active email driver, e.g. `console-email`. */
  get emailProviderName(): string {
    return this.emailProvider.name;
  }

  /** Name of the active SMS driver, e.g. `console-sms`. */
  get smsProviderName(): string {
    return this.smsProvider.name;
  }

  /**
   * Renders one template to `{ subject, html, text }`.
   *
   * Pure and synchronous: the outbox processor renders inside its own transaction without waiting
   * on anything, and a test can assert on copy without a Nest context.
   */
  renderTemplate<K extends TemplateId>(input: RenderTemplateInput<K>): RenderedTemplate {
    const context = this.buildTemplateContext(input.locale, input.context);
    return renderTemplate(input.template, input.props, context);
  }

  /** Sends a ready-made email. Resolves with a `SendResult` whatever happens. */
  sendEmail(input: SendEmailInput): Promise<SendResult> {
    const startedAt = Date.now();
    const recipient = maskEmail(input.to);
    const locale = input.locale ?? this.options.defaultLocale;

    if (!isLikelyEmailAddress(input.to)) {
      return Promise.resolve(
        this.rejectRecipient(
          'EMAIL',
          this.emailProvider.name,
          recipient,
          startedAt,
          'email address',
        ),
      );
    }

    const message: EmailMessage = {
      to: input.to.trim(),
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
    };

    return this.dispatch({
      channel: 'EMAIL',
      providerName: this.emailProvider.name,
      recipient,
      locale,
      template: input.template ?? null,
      correlationId: input.correlationId ?? null,
      startedAt,
      attempt: (context) => this.emailProvider.send(message, context),
    });
  }

  /** Renders a template and sends it as email. */
  sendTemplatedEmail<K extends TemplateId>(input: SendTemplatedEmailInput<K>): Promise<SendResult> {
    const locale = input.locale ?? this.options.defaultLocale;
    let rendered: RenderedTemplate;
    try {
      rendered = this.renderTemplate({
        template: input.template,
        props: input.props,
        locale,
      });
    } catch (error) {
      return Promise.resolve(
        this.templateFailure('EMAIL', this.emailProvider.name, maskEmail(input.to), error),
      );
    }

    return this.sendEmail({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      replyTo: input.replyTo,
      locale,
      correlationId: input.correlationId,
      template: input.template,
    });
  }

  /** Sends a ready-made SMS. Resolves with a `SendResult` whatever happens. */
  sendSms(input: SendSmsInput): Promise<SendResult> {
    const startedAt = Date.now();
    const to = normalisePhoneNumber(input.to);
    const recipient = maskPhone(to);
    const locale = input.locale ?? this.options.defaultLocale;

    if (!isE164PhoneNumber(to)) {
      return Promise.resolve(
        this.rejectRecipient('SMS', this.smsProvider.name, recipient, startedAt, 'E.164 number'),
      );
    }

    const message: SmsMessage = {
      to,
      text: input.text,
      senderId: input.senderId ?? this.options.smsSenderId,
    };

    return this.dispatch({
      channel: 'SMS',
      providerName: this.smsProvider.name,
      recipient,
      locale,
      template: input.template ?? null,
      correlationId: input.correlationId ?? null,
      startedAt,
      attempt: (context) => this.smsProvider.send(message, context),
    });
  }

  /** Renders a template and sends its plain-text body as SMS. */
  sendTemplatedSms<K extends TemplateId>(input: SendTemplatedSmsInput<K>): Promise<SendResult> {
    const locale = input.locale ?? this.options.defaultLocale;
    let rendered: RenderedTemplate;
    try {
      rendered = this.renderTemplate({
        template: input.template,
        props: input.props,
        locale,
      });
    } catch (error) {
      return Promise.resolve(
        this.templateFailure('SMS', this.smsProvider.name, maskPhone(input.to), error),
      );
    }

    return this.sendSms({
      to: input.to,
      text: rendered.text,
      locale,
      correlationId: input.correlationId,
      template: input.template,
    });
  }

  /** Which channel a template's copy was written for. */
  channelForTemplate(template: TemplateId): NotificationChannelName {
    return TEMPLATE_REGISTRY[template].channel;
  }

  /**
   * Readiness probe for `/health/ready`. Resolves false rather than throwing — a degraded mail
   * server is a health signal, not an exception.
   */
  async verifyProviders(): Promise<{ email: boolean; sms: boolean }> {
    return {
      email: await this.verifyOne(this.emailProvider),
      sms: await this.verifyOne(this.smsProvider),
    };
  }

  private async verifyOne(provider: EmailProvider | SmsProvider): Promise<boolean> {
    if (provider.verifyConnection === undefined) {
      return true;
    }
    try {
      await provider.verifyConnection();
      return true;
    } catch (error) {
      const failure = toNotificationError(error, provider.name);
      this.logger.warn(
        `provider unhealthy · provider=${provider.name} code=${failure.code} reason=${summariseProviderMessage(failure.message)}`,
      );
      return false;
    }
  }

  private get retryPolicy(): RetryPolicy {
    return {
      maxAttempts: this.options.maxAttempts,
      timeoutMs: this.options.timeoutMs,
      backoffBaseMs: this.options.backoffBaseMs,
      backoffMaxMs: this.options.backoffMaxMs,
      jitterRatio: this.options.backoffJitterRatio,
    };
  }

  private buildTemplateContext(
    locale: NotificationLocale | undefined,
    overrides?: Partial<Omit<TemplateContext, 'locale'>>,
  ): TemplateContext {
    return {
      locale: locale ?? this.options.defaultLocale,
      brandName: overrides?.brandName ?? this.options.brandName,
      webUrl: overrides?.webUrl ?? this.options.webUrl,
      supportEmail: overrides?.supportEmail ?? this.options.supportEmail,
      timeZone: overrides?.timeZone ?? this.options.timeZone,
    };
  }

  /**
   * The one place a provider is actually called.
   *
   * Timeout, bounded retry, exponential backoff, typed classification and the guarantee that
   * nothing escapes all live here — not in the callers and not in the drivers.
   */
  private async dispatch(input: {
    channel: NotificationChannelName;
    providerName: string;
    recipient: string;
    locale: NotificationLocale;
    template: string | null;
    correlationId: string | null;
    startedAt: number;
    attempt: (context: ProviderSendContext) => Promise<ProviderSendOutcome>;
  }): Promise<SendResult> {
    let attemptsMade = 0;

    try {
      const { value, attempts } = await runWithRetry(
        this.retryPolicy,
        (attemptContext) => {
          attemptsMade = attemptContext.attempt;
          return input.attempt({
            attempt: attemptContext.attempt,
            timeoutMs: attemptContext.timeoutMs,
            signal: attemptContext.signal,
            locale: input.locale,
            template: input.template,
            correlationId: input.correlationId,
          });
        },
        {
          onAttemptFailed: (failure) => {
            this.logger.warn(
              [
                'send attempt failed',
                `channel=${input.channel}`,
                `provider=${input.providerName}`,
                `to=${input.recipient}`,
                `template=${input.template ?? 'none'}`,
                `attempt=${failure.attempt}/${this.options.maxAttempts}`,
                `code=${failure.error.code}`,
                `willRetry=${String(failure.willRetry)}`,
                `reason=${summariseProviderMessage(failure.error.message, 200)}`,
              ].join(' · '),
            );
          },
        },
      );

      return {
        ok: true,
        channel: input.channel,
        provider: input.providerName,
        messageId: value.messageId,
        recipient: input.recipient,
        attempts,
        durationMs: Date.now() - input.startedAt,
      };
    } catch (error) {
      const failure: NotificationError = toNotificationError(error, input.providerName);
      this.logger.error(
        [
          'send failed',
          `channel=${input.channel}`,
          `provider=${input.providerName}`,
          `to=${input.recipient}`,
          `template=${input.template ?? 'none'}`,
          `attempts=${attemptsMade}`,
          `code=${failure.code}`,
          `retryable=${String(failure.retryable)}`,
          `reason=${summariseProviderMessage(failure.message, 200)}`,
        ].join(' · '),
      );

      return {
        ok: false,
        channel: input.channel,
        provider: input.providerName,
        messageId: null,
        recipient: input.recipient,
        attempts: Math.max(1, attemptsMade),
        durationMs: Date.now() - input.startedAt,
        failure: {
          code: failure.code,
          message: summariseProviderMessage(failure.message),
          retryable: failure.retryable,
        },
      };
    }
  }

  /** An undeliverable recipient never reaches a provider — no timeout and no retries spent on it. */
  private rejectRecipient(
    channel: NotificationChannelName,
    providerName: string,
    recipient: string,
    startedAt: number,
    expected: string,
  ): SendResult {
    this.logger.warn(
      `send rejected · channel=${channel} provider=${providerName} to=${recipient} reason=not a valid ${expected}`,
    );
    return {
      ok: false,
      channel,
      provider: providerName,
      messageId: null,
      recipient,
      attempts: 0,
      durationMs: Date.now() - startedAt,
      failure: {
        code: NotificationErrorCode.NOTIFICATION_INVALID_RECIPIENT,
        message: `The recipient is not a valid ${expected}.`,
        retryable: false,
      },
    };
  }

  /** A template that cannot render is a code defect, not an outage — but it still must not throw. */
  private templateFailure(
    channel: NotificationChannelName,
    providerName: string,
    recipient: string,
    error: unknown,
  ): SendResult {
    const failure = toNotificationError(error, providerName);
    this.logger.error(
      `template render failed · channel=${channel} to=${recipient} code=${failure.code} reason=${summariseProviderMessage(failure.message, 200)}`,
    );
    return {
      ok: false,
      channel,
      provider: providerName,
      messageId: null,
      recipient,
      attempts: 0,
      durationMs: 0,
      failure: {
        code: failure.code,
        message: summariseProviderMessage(failure.message),
        retryable: false,
      },
    };
  }
}
