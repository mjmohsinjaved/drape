import { Logger } from '@nestjs/common';

import { type ProviderSendContext } from '../interfaces/email-provider.interface';
import { CONSOLE_EMAIL_PROVIDER_NAME, CONSOLE_SMS_PROVIDER_NAME } from '../notifications.constants';

import { ConsoleEmailProvider } from './console-email.provider';
import { ConsoleSmsProvider } from './console-sms.provider';

function sendContext(): ProviderSendContext {
  return {
    attempt: 1,
    timeoutMs: 1_000,
    signal: new AbortController().signal,
    locale: 'EN',
    template: 'VERIFY_EMAIL',
    correlationId: 'req-1',
  };
}

function firstLine(spy: jest.SpyInstance): string {
  return String(spy.mock.calls[0][0] as string);
}

describe('ConsoleEmailProvider', () => {
  it('logs through the Nest Logger and never through console', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const consoleSpy = jest.spyOn(global.console, 'log').mockImplementation(() => undefined);

    await new ConsoleEmailProvider().send(
      {
        to: 'alice@example.com',
        subject: 'Confirm your email address',
        html: '<p>x</p>',
        text: 'x',
      },
      sendContext(),
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('redacts the recipient address in the log line', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const provider = new ConsoleEmailProvider();
    await provider.send(
      {
        to: 'alice@example.com',
        subject: 'Confirm your email address',
        html: '<p>x</p>',
        text: 'x',
      },
      sendContext(),
    );

    const line = firstLine(logSpy);
    expect(line).toContain('a***e@e***e.com');
    expect(line).not.toContain('alice@example.com');
  });

  it('does not log the body unless asked, so links stay secret', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    await new ConsoleEmailProvider().send(
      { to: 'alice@example.com', subject: 's', html: '<p>x</p>', text: 'reset token abc123' },
      sendContext(),
    );
    expect(debugSpy).not.toHaveBeenCalled();

    await new ConsoleEmailProvider({ logBody: true }).send(
      { to: 'alice@example.com', subject: 's', html: '<p>x</p>', text: 'reset token abc123' },
      sendContext(),
    );
    expect(debugSpy).toHaveBeenCalledTimes(1);
  });

  it('reports its name and returns a message id without sending anything', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const provider = new ConsoleEmailProvider();

    expect(provider.name).toBe(CONSOLE_EMAIL_PROVIDER_NAME);
    const outcome = await provider.send(
      { to: 'alice@example.com', subject: 's', html: '<p>x</p>', text: 'x' },
      sendContext(),
    );
    expect(outcome.messageId).toMatch(/^console-/);
    expect(outcome.acceptedAt).toBeInstanceOf(Date);
  });
});

describe('ConsoleSmsProvider', () => {
  it('redacts the recipient number in the log line', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const provider = new ConsoleSmsProvider();
    expect(provider.name).toBe(CONSOLE_SMS_PROVIDER_NAME);

    await provider.send({ to: '+923001234567', text: '481920 is your Drape code.' }, sendContext());

    const line = firstLine(logSpy);
    expect(line).toContain('+92***567');
    expect(line).not.toContain('+923001234567');
  });

  it('keeps the code out of the log line', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await new ConsoleSmsProvider().send(
      { to: '+923001234567', text: '481920 is your Drape code.' },
      sendContext(),
    );

    expect(firstLine(logSpy)).not.toContain('481920');
  });
});
