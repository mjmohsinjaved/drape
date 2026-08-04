import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import {
  type EmailMessage,
  type EmailProvider,
  type ProviderSendContext,
  type ProviderSendOutcome,
} from '../interfaces/email-provider.interface';
import { CONSOLE_EMAIL_PROVIDER_NAME } from '../notifications.constants';
import { maskEmail } from '../utils/redact.util';

export interface ConsoleProviderOptions {
  /**
   * Log the rendered body at `debug`. Off by default — verification links, reset links and OTP
   * codes are secrets even on a laptop.
   */
  readonly logBody?: boolean;
}

/**
 * The default email driver for local, test and CI.
 *
 * Nothing is sent. The message is written through the NestJS `Logger` — never `console.log` — and
 * the recipient is masked, so a shared terminal or a CI log never carries a real address.
 */
@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = CONSOLE_EMAIL_PROVIDER_NAME;

  private readonly logger = new Logger(ConsoleEmailProvider.name);

  constructor(private readonly options: ConsoleProviderOptions = {}) {}

  send(message: EmailMessage, context: ProviderSendContext): Promise<ProviderSendOutcome> {
    const messageId = `console-${randomUUID()}`;

    this.logger.log(
      [
        'email not sent (console driver)',
        `to=${maskEmail(message.to)}`,
        `subject="${message.subject}"`,
        `locale=${context.locale}`,
        `template=${context.template ?? 'none'}`,
        `attempt=${context.attempt}`,
        `htmlChars=${message.html.length}`,
        `textChars=${message.text.length}`,
        `messageId=${messageId}`,
      ].join(' · '),
    );

    if (this.options.logBody === true) {
      this.logger.debug(`body (${maskEmail(message.to)}):\n${message.text}`);
    }

    return Promise.resolve({ messageId, acceptedAt: new Date() });
  }

  verifyConnection(): Promise<void> {
    return Promise.resolve();
  }
}
