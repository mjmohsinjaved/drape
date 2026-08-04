import {
  Global,
  Module,
  type DynamicModule,
  type FactoryProvider,
  type Provider,
} from '@nestjs/common';

import {
  type NotificationsModuleAsyncOptions,
  type NotificationsModuleOptions,
} from './interfaces/notifications-options.interface';
import { EMAIL_PROVIDER, NOTIFICATIONS_OPTIONS, SMS_PROVIDER } from './notifications.constants';
import { NotificationsService } from './notifications.service';
import { createEmailProvider, createSmsProvider } from './providers/provider.factory';

/**
 * Driver providers. Both read the resolved options and hand back whatever
 * `providers/provider.factory.ts` selects, so the module never names a driver itself.
 */
const DRIVER_PROVIDERS: readonly Provider[] = [
  {
    provide: EMAIL_PROVIDER,
    useFactory: (options: NotificationsModuleOptions) => createEmailProvider(options),
    inject: [NOTIFICATIONS_OPTIONS],
  },
  {
    provide: SMS_PROVIDER,
    useFactory: (options: NotificationsModuleOptions) => createSmsProvider(options),
    inject: [NOTIFICATIONS_OPTIONS],
  },
];

const EXPORTED_TOKENS = [NotificationsService, EMAIL_PROVIDER, SMS_PROVIDER, NOTIFICATIONS_OPTIONS];

/**
 * `@library/notifications`.
 *
 * Global, because sending is cross-cutting: `auth`, `invites`, `tryon`, `enquiries`, `quota`,
 * `moderation` and `retention` all send, and none of them should have to import a module to do it.
 *
 * The active drivers are chosen once, here, from config. Callers only ever see
 * `NotificationsService` — swapping SMTP for something else changes no call site.
 */
@Global()
@Module({})
export class NotificationsModule {
  static forRoot(options: NotificationsModuleOptions): DynamicModule {
    return {
      module: NotificationsModule,
      providers: [
        { provide: NOTIFICATIONS_OPTIONS, useValue: options },
        ...DRIVER_PROVIDERS,
        NotificationsService,
      ],
      exports: EXPORTED_TOKENS,
    };
  }

  static forRootAsync(asyncOptions: NotificationsModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: NOTIFICATIONS_OPTIONS,
      // The wrapper keeps the caller's factory strongly typed while satisfying Nest's own
      // `(...args: any[])` signature without an `any` reaching our code.
      useFactory: (...args: unknown[]) => asyncOptions.useFactory(...(args as never[])),
      inject: [...(asyncOptions.inject ?? [])] as FactoryProvider['inject'],
    };

    return {
      module: NotificationsModule,
      imports: [...(asyncOptions.imports ?? [])] as DynamicModule['imports'],
      providers: [optionsProvider, ...DRIVER_PROVIDERS, NotificationsService],
      exports: EXPORTED_TOKENS,
    };
  }
}
