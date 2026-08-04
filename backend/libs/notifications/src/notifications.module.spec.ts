import { Injectable, Logger, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { type NotificationsModuleOptions } from './interfaces/notifications-options.interface';
import { EMAIL_PROVIDER, SMS_PROVIDER } from './notifications.constants';
import { NotificationsModule } from './notifications.module';
import { NotificationsService } from './notifications.service';
import { ConsoleEmailProvider } from './providers/console-email.provider';
import { ConsoleSmsProvider } from './providers/console-sms.provider';

const OPTIONS: NotificationsModuleOptions = {
  emailDriver: 'console',
  emailFrom: 'Drape <hello@drape.test>',
  smsDriver: 'console',
  smsSenderId: 'DRAPE',
  webUrl: 'https://drape.test',
  brandName: 'Drape',
  supportEmail: 'hello@drape.test',
  defaultLocale: 'EN',
  timeZone: 'Asia/Karachi',
  timeoutMs: 1_000,
  maxAttempts: 1,
  backoffBaseMs: 0,
  backoffMaxMs: 0,
  backoffJitterRatio: 0,
  consoleLogBody: false,
};

@Injectable()
class FakeConfigService {
  readonly emailDriver = 'console' as const;
}

@Module({ providers: [FakeConfigService], exports: [FakeConfigService] })
class FakeConfigModule {}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

describe('NotificationsModule', () => {
  it('wires the service and the console drivers through forRoot', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NotificationsModule.forRoot(OPTIONS)],
    }).compile();

    expect(moduleRef.get(NotificationsService)).toBeInstanceOf(NotificationsService);
    expect(moduleRef.get(EMAIL_PROVIDER)).toBeInstanceOf(ConsoleEmailProvider);
    expect(moduleRef.get(SMS_PROVIDER)).toBeInstanceOf(ConsoleSmsProvider);

    await moduleRef.close();
  });

  it('resolves options from an injected dependency through forRootAsync', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationsModule.forRootAsync({
          imports: [FakeConfigModule],
          inject: [FakeConfigService],
          useFactory: (config: FakeConfigService) => ({
            ...OPTIONS,
            emailDriver: config.emailDriver,
          }),
        }),
      ],
    }).compile();

    const service = moduleRef.get(NotificationsService);
    expect(service.emailProviderName).toBe('console-email');
    expect(service.smsProviderName).toBe('console-sms');

    await moduleRef.close();
  });
});
