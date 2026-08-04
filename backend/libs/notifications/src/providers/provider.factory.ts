import { NotificationConfigError } from '../exceptions/notification.exception';
import { type EmailProvider } from '../interfaces/email-provider.interface';
import { type NotificationsModuleOptions } from '../interfaces/notifications-options.interface';
import { type SmsProvider } from '../interfaces/sms-provider.interface';

import { ConsoleEmailProvider } from './console-email.provider';
import { ConsoleSmsProvider } from './console-sms.provider';
import { HttpSmsProvider } from './http-sms.provider';
import { SmtpEmailProvider } from './smtp-email.provider';

/**
 * Driver selection.
 *
 * This is the only place that knows which drivers exist. Adding one means a case here and a file in
 * `providers/` — no caller, no service and no template changes. An explicit `emailProvider` /
 * `smsProvider` in the module options wins outright, which is how a bespoke driver drops in and how
 * tests substitute a fake.
 */
export function createEmailProvider(options: NotificationsModuleOptions): EmailProvider {
  if (options.emailProvider !== undefined) {
    return options.emailProvider;
  }

  switch (options.emailDriver) {
    case 'console':
      return new ConsoleEmailProvider({ logBody: options.consoleLogBody });

    case 'smtp': {
      if (options.smtp === undefined) {
        throw new NotificationConfigError(
          'EMAIL_DRIVER is `smtp` but SMTP settings are missing. Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD.',
        );
      }
      return new SmtpEmailProvider({
        ...options.smtp,
        from: options.emailFrom,
        timeoutMs: options.timeoutMs,
      });
    }

    default:
      return assertUnreachable(options.emailDriver, 'EMAIL_DRIVER');
  }
}

export function createSmsProvider(options: NotificationsModuleOptions): SmsProvider {
  if (options.smsProvider !== undefined) {
    return options.smsProvider;
  }

  switch (options.smsDriver) {
    case 'console':
      return new ConsoleSmsProvider({ logBody: options.consoleLogBody });

    case 'http': {
      if (options.httpSms === undefined) {
        throw new NotificationConfigError(
          'SMS_DRIVER is `http` but gateway settings are missing. Set SMS_HTTP_URL and SMS_HTTP_API_KEY.',
        );
      }
      if (options.smsSenderId === undefined || options.smsSenderId.trim().length === 0) {
        throw new NotificationConfigError('SMS_SENDER_ID is required when SMS_DRIVER is `http`.');
      }
      return new HttpSmsProvider({
        ...options.httpSms,
        senderId: options.smsSenderId,
        timeoutMs: options.timeoutMs,
      });
    }

    default:
      return assertUnreachable(options.smsDriver, 'SMS_DRIVER');
  }
}

function assertUnreachable(value: never, variableName: string): never {
  throw new NotificationConfigError(`${variableName} has an unsupported value: ${String(value)}.`);
}
