import { Logger } from '@nestjs/common';

import {
  NotificationProviderError,
  NotificationTimeoutError,
} from './exceptions/notification.exception';
import {
  type EmailMessage,
  type EmailProvider,
  type ProviderSendContext,
  type ProviderSendOutcome,
} from './interfaces/email-provider.interface';
import { type NotificationsModuleOptions } from './interfaces/notifications-options.interface';
import { NotificationErrorCode } from './interfaces/send-result.interface';
import { type SmsMessage, type SmsProvider } from './interfaces/sms-provider.interface';
import { NotificationsService } from './notifications.service';
import { ConsoleEmailProvider } from './providers/console-email.provider';
import { ConsoleSmsProvider } from './providers/console-sms.provider';
import { HttpSmsProvider } from './providers/http-sms.provider';
import { createEmailProvider, createSmsProvider } from './providers/provider.factory';
import { SmtpEmailProvider } from './providers/smtp-email.provider';
import { TemplateId } from './templates/template-registry';

const BASE_OPTIONS: NotificationsModuleOptions = {
  emailDriver: 'console',
  emailFrom: 'Drape <hello@drape.test>',
  smsDriver: 'console',
  smsSenderId: 'DRAPE',
  webUrl: 'https://drape.test',
  brandName: 'Drape',
  supportEmail: 'hello@drape.test',
  defaultLocale: 'EN',
  timeZone: 'Asia/Karachi',
  timeoutMs: 50,
  maxAttempts: 3,
  // Zero backoff keeps the retry tests instant and timer-free.
  backoffBaseMs: 0,
  backoffMaxMs: 0,
  backoffJitterRatio: 0,
  consoleLogBody: false,
};

function options(overrides: Partial<NotificationsModuleOptions> = {}): NotificationsModuleOptions {
  return { ...BASE_OPTIONS, ...overrides };
}

class StubEmailProvider implements EmailProvider {
  readonly name = 'stub-email';

  calls = 0;

  constructor(private readonly behaviour: (attempt: number) => Promise<ProviderSendOutcome>) {}

  send(_message: EmailMessage, context: ProviderSendContext): Promise<ProviderSendOutcome> {
    this.calls += 1;
    return this.behaviour(context.attempt);
  }
}

class StubSmsProvider implements SmsProvider {
  readonly name = 'stub-sms';

  calls = 0;

  constructor(private readonly behaviour: (attempt: number) => Promise<ProviderSendOutcome>) {}

  send(_message: SmsMessage, context: ProviderSendContext): Promise<ProviderSendOutcome> {
    this.calls += 1;
    return this.behaviour(context.attempt);
  }
}

function accepted(): Promise<ProviderSendOutcome> {
  return Promise.resolve({ messageId: 'stub-1', acceptedAt: new Date() });
}

function build(
  email: EmailProvider,
  sms: SmsProvider,
  overrides: Partial<NotificationsModuleOptions> = {},
): NotificationsService {
  return new NotificationsService(options(overrides), email, sms);
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

describe('provider selection', () => {
  it('defaults to the console drivers, which is what local, test and CI run', () => {
    expect(createEmailProvider(options())).toBeInstanceOf(ConsoleEmailProvider);
    expect(createSmsProvider(options())).toBeInstanceOf(ConsoleSmsProvider);
  });

  it('selects the SMTP driver from config', () => {
    const provider = createEmailProvider(
      options({
        emailDriver: 'smtp',
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          user: 'mailer',
          password: 'not-a-real-password',
          secure: false,
        },
      }),
    );
    expect(provider).toBeInstanceOf(SmtpEmailProvider);
  });

  it('selects the HTTP SMS driver from config', () => {
    const provider = createSmsProvider(
      options({
        smsDriver: 'http',
        httpSms: { url: 'https://sms.example.pk/send', apiKey: 'not-a-real-key' },
      }),
    );
    expect(provider).toBeInstanceOf(HttpSmsProvider);
  });

  it('refuses to boot when a driver is selected without its settings', () => {
    expect(() => createEmailProvider(options({ emailDriver: 'smtp' }))).toThrow(
      /SMTP settings are missing/,
    );
    expect(() => createSmsProvider(options({ smsDriver: 'http' }))).toThrow(
      /gateway settings are missing/,
    );
  });

  it('lets a caller drop in its own provider without touching call sites', () => {
    const custom = new StubEmailProvider(accepted);
    expect(createEmailProvider(options({ emailProvider: custom }))).toBe(custom);

    const service = build(custom, new StubSmsProvider(accepted));
    expect(service.emailProviderName).toBe('stub-email');
  });
});

describe('sendEmail', () => {
  it('returns a success result with the recipient masked', async () => {
    const provider = new StubEmailProvider(accepted);
    const service = build(provider, new StubSmsProvider(accepted));

    const result = await service.sendEmail({
      to: 'alice@example.com',
      subject: 'Confirm your email address',
      html: '<p>x</p>',
      text: 'x',
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.recipient).toBe('a***e@e***e.com');
    expect(JSON.stringify(result)).not.toContain('alice@example.com');
  });

  it('swallows a provider outage instead of throwing into the request path', async () => {
    const provider = new StubEmailProvider(() =>
      Promise.reject(
        new NotificationProviderError(
          NotificationErrorCode.NOTIFICATION_PROVIDER_UNAVAILABLE,
          'connection refused',
          { retryable: true },
        ),
      ),
    );
    const service = build(provider, new StubSmsProvider(accepted));

    const result = await service.sendEmail({
      to: 'alice@example.com',
      subject: 's',
      html: '<p>x</p>',
      text: 'x',
    });

    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe(NotificationErrorCode.NOTIFICATION_PROVIDER_UNAVAILABLE);
    expect(result.failure?.retryable).toBe(true);
    expect(result.attempts).toBe(3);
    expect(provider.calls).toBe(3);
  });

  it('gives up after the first attempt when the failure cannot be retried', async () => {
    const provider = new StubEmailProvider(() =>
      Promise.reject(
        new NotificationProviderError(
          NotificationErrorCode.NOTIFICATION_AUTH_FAILED,
          'credentials rejected',
          { retryable: false },
        ),
      ),
    );
    const service = build(provider, new StubSmsProvider(accepted));

    const result = await service.sendEmail({
      to: 'alice@example.com',
      subject: 's',
      html: '<p>x</p>',
      text: 'x',
    });

    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe(NotificationErrorCode.NOTIFICATION_AUTH_FAILED);
    expect(provider.calls).toBe(1);
  });

  it('recovers when a later attempt succeeds', async () => {
    const provider = new StubEmailProvider((attempt) =>
      attempt < 3
        ? Promise.reject(new NotificationTimeoutError('no answer'))
        : Promise.resolve({ messageId: 'stub-3', acceptedAt: new Date() }),
    );
    const service = build(provider, new StubSmsProvider(accepted));

    const result = await service.sendEmail({
      to: 'alice@example.com',
      subject: 's',
      html: '<p>x</p>',
      text: 'x',
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.messageId).toBe('stub-3');
  });

  it('times out a provider that never answers, and still resolves', async () => {
    const provider = new StubEmailProvider(() => new Promise<ProviderSendOutcome>(() => undefined));
    const service = build(provider, new StubSmsProvider(accepted), {
      maxAttempts: 1,
      timeoutMs: 20,
    });

    const result = await service.sendEmail({
      to: 'alice@example.com',
      subject: 's',
      html: '<p>x</p>',
      text: 'x',
    });

    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe(NotificationErrorCode.NOTIFICATION_TIMEOUT);
    expect(result.failure?.retryable).toBe(true);
  });

  it('turns a provider that throws a bare Error into a typed failure', async () => {
    const provider = new StubEmailProvider(() => Promise.reject(new Error('kaboom')));
    const service = build(provider, new StubSmsProvider(accepted), { maxAttempts: 1 });

    const result = await service.sendEmail({
      to: 'alice@example.com',
      subject: 's',
      html: '<p>x</p>',
      text: 'x',
    });

    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe(NotificationErrorCode.NOTIFICATION_PROVIDER_ERROR);
  });

  it('rejects an undeliverable address before spending a provider call', async () => {
    const provider = new StubEmailProvider(accepted);
    const service = build(provider, new StubSmsProvider(accepted));

    const result = await service.sendEmail({
      to: 'not-an-address',
      subject: 's',
      html: '<p>x</p>',
      text: 'x',
    });

    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe(NotificationErrorCode.NOTIFICATION_INVALID_RECIPIENT);
    expect(result.failure?.retryable).toBe(false);
    expect(provider.calls).toBe(0);
  });
});

describe('sendSms', () => {
  it('normalises the number and masks it in the result', async () => {
    const provider = new StubSmsProvider(accepted);
    const service = build(new StubEmailProvider(accepted), provider);

    const result = await service.sendSms({ to: '+92 300 123 4567', text: 'code' });

    expect(result.ok).toBe(true);
    expect(result.recipient).toBe('+92***567');
    expect(provider.calls).toBe(1);
  });

  it('rejects a number that is not E.164 without calling the gateway', async () => {
    const provider = new StubSmsProvider(accepted);
    const service = build(new StubEmailProvider(accepted), provider);

    const result = await service.sendSms({ to: '03001234567', text: 'code' });

    expect(result.ok).toBe(false);
    expect(result.failure?.code).toBe(NotificationErrorCode.NOTIFICATION_INVALID_RECIPIENT);
    expect(provider.calls).toBe(0);
  });

  it('never throws when the gateway is down', async () => {
    const provider = new StubSmsProvider(() => Promise.reject(new Error('gateway down')));
    const service = build(new StubEmailProvider(accepted), provider);

    await expect(service.sendSms({ to: '+923001234567', text: 'code' })).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe('renderTemplate and templated sends', () => {
  it('renders through the service using module config', () => {
    const service = build(new StubEmailProvider(accepted), new StubSmsProvider(accepted));

    const rendered = service.renderTemplate({
      template: TemplateId.RENDER_READY,
      props: {
        consumerName: 'Hira',
        garmentTitle: 'Ivory tissue lehenga',
        resultUrl: 'https://drape.test/results/9f21',
        tryOnsLeft: 7,
      },
    });

    expect(rendered.subject).toContain('try-on');
    expect(rendered.html).toContain('Drape');
    expect(rendered.text.length).toBeGreaterThan(0);
  });

  it('renders in the requested locale', () => {
    const service = build(new StubEmailProvider(accepted), new StubSmsProvider(accepted));

    const rendered = service.renderTemplate({
      template: TemplateId.BUDGET_EXHAUSTED_CONSUMER,
      locale: 'UR',
      props: {
        consumerName: 'حرا',
        shortlistUrl: 'https://drape.test/shortlist',
        enquiryUrl: 'https://drape.test/enquiries/new',
      },
    });

    expect(rendered.html).toContain('dir="rtl"');
  });

  it('sends a templated email through the active provider', async () => {
    const provider = new StubEmailProvider(accepted);
    const service = build(provider, new StubSmsProvider(accepted));

    const result = await service.sendTemplatedEmail({
      to: 'alice@example.com',
      template: TemplateId.VERIFY_EMAIL,
      props: { verifyUrl: 'https://drape.test/verify?token=abc', expiresInHours: 24 },
    });

    expect(result.ok).toBe(true);
    expect(provider.calls).toBe(1);
  });

  it('sends the SMS template as plain text', async () => {
    const provider = new StubSmsProvider(accepted);
    const service = build(new StubEmailProvider(accepted), provider);

    const result = await service.sendTemplatedSms({
      to: '+923001234567',
      template: TemplateId.OTP_SMS,
      props: { code: '481920', expiresInMinutes: 10 },
    });

    expect(result.ok).toBe(true);
    expect(service.channelForTemplate(TemplateId.OTP_SMS)).toBe('SMS');
  });
});

describe('verifyProviders', () => {
  it('reports a degraded provider rather than throwing', async () => {
    const email: EmailProvider = {
      name: 'stub-email',
      send: accepted,
      verifyConnection: () => Promise.reject(new Error('smtp unreachable')),
    };
    const service = build(email, new StubSmsProvider(accepted));

    await expect(service.verifyProviders()).resolves.toEqual({ email: false, sms: true });
  });
});
