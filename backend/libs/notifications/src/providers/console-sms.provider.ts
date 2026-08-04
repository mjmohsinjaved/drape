import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import {
  type ProviderSendContext,
  type ProviderSendOutcome,
} from '../interfaces/email-provider.interface';
import { type SmsMessage, type SmsProvider } from '../interfaces/sms-provider.interface';
import { CONSOLE_SMS_PROVIDER_NAME } from '../notifications.constants';
import { maskPhone } from '../utils/redact.util';

import { type ConsoleProviderOptions } from './console-email.provider';

/**
 * The default SMS driver for local, test and CI.
 *
 * Nothing is sent. The message goes through the NestJS `Logger` with the number masked, so an OTP
 * run in CI leaves no phone number in the log.
 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = CONSOLE_SMS_PROVIDER_NAME;

  private readonly logger = new Logger(ConsoleSmsProvider.name);

  constructor(private readonly options: ConsoleProviderOptions = {}) {}

  send(message: SmsMessage, context: ProviderSendContext): Promise<ProviderSendOutcome> {
    const messageId = `console-${randomUUID()}`;

    this.logger.log(
      [
        'sms not sent (console driver)',
        `to=${maskPhone(message.to)}`,
        `senderId=${message.senderId ?? 'none'}`,
        `locale=${context.locale}`,
        `template=${context.template ?? 'none'}`,
        `attempt=${context.attempt}`,
        `chars=${message.text.length}`,
        `messageId=${messageId}`,
      ].join(' · '),
    );

    if (this.options.logBody === true) {
      this.logger.debug(`body (${maskPhone(message.to)}): ${message.text}`);
    }

    return Promise.resolve({ messageId, acceptedAt: new Date() });
  }

  verifyConnection(): Promise<void> {
    return Promise.resolve();
  }
}
