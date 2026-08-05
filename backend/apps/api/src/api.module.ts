import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { MetricsModule } from '@library/common';
import { DatabaseModule } from '@library/database';
import {
  NotificationsModule,
  loadNotificationsConfigFromEnv,
  type NotificationsModuleOptions,
} from '@library/notifications';
import { StorageModule } from '@library/storage';

import { GlobalProvidersModule } from '@api/bootstrap/global-providers';
import { validateEnv } from '@api/config/env.validation';
import { AuditModule } from '@api/modules/audit/audit.module';
import { AuthModule } from '@api/modules/auth/auth.module';
import { CatalogModule } from '@api/modules/catalog/catalog.module';
import { CategoriesModule } from '@api/modules/categories/categories.module';
import { ConsentsModule } from '@api/modules/consents/consents.module';
import { EnquiriesModule } from '@api/modules/enquiries/enquiries.module';
import { FilesModule } from '@api/modules/files/files.module';
import { GarmentImagesModule } from '@api/modules/garments/garment-images.module';
import { GarmentsModule } from '@api/modules/garments/garments.module';
import { HealthModule } from '@api/modules/health/health.module';
import { InvitesModule } from '@api/modules/invites/invites.module';
import { PersonPhotosModule } from '@api/modules/person-photos/person-photos.module';
import { QuotaModule } from '@api/modules/quota/quota.module';
import { ResultsModule } from '@api/modules/results/results.module';
import { SettingsModule } from '@api/modules/settings/settings.module';
import { ShareModule } from '@api/modules/share/share.module';
import { ShortlistModule } from '@api/modules/shortlist/shortlist.module';
import { TryOnModule } from '@api/modules/tryon/tryon.module';
import { UsersModule } from '@api/modules/users/users.module';

/**
 * The composition root.
 *
 * It imports modules and nothing else — no controllers, no providers, no business
 * logic (ARCHITECTURE §1.1). Cross-cutting wiring lives in
 * `bootstrap/global-providers.ts`; feature behaviour lives in its own module.
 */
@Module({
  imports: [
    /* Environment first: every module below resolves its configuration through
     * ConfigService, and `validateEnv` has already refused to start on a bad one. */
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: ['.env.local', '.env'],
    }),

    /* Cross-cutting: guard chain, envelope interceptor, exception filter, logger. */
    GlobalProvidersModule,

    /* Libraries (§2, §3). Each is `@Global()`; each resolves its own configuration
     * from the environment `validateEnv` has already checked. */
    DatabaseModule,
    StorageModule,
    NotificationsModule.forRootAsync({
      // The library reads §7 directly; `validateEnv` above has already refused to
      // start if a driver is selected without its credentials.
      useFactory: (): NotificationsModuleOptions => loadNotificationsConfigFromEnv(),
    }),
    MetricsModule,

    /* Global rate limit — 100 requests / 60 s, tracked by userId or IP (§5.22).
     * Per-route overrides are declared with `@Throttle()` on the handler. */
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.getOrThrow<number>('THROTTLE_TTL_SECONDS') * 1000,
            limit: config.getOrThrow<number>('THROTTLE_LIMIT'),
          },
        ],
      }),
    }),

    /* In-process scheduling (§8.2 — no external queue in V1) and domain events. */
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),

    /* Infrastructure endpoints (§5.21). */
    HealthModule,

    // --- feature modules (W1+) ---
    // Listed in the §4.33 ownership order. AuthModule is first because it binds
    // SESSION_RESOLVER, which the global SessionAuthGuard injects — without it
    // the application refuses to boot rather than authorising anything.
    AuthModule,
    UsersModule,
    InvitesModule,
    SettingsModule,
    ConsentsModule,
    AuditModule,
    CategoriesModule,
    GarmentsModule,
    GarmentImagesModule,
    CatalogModule,
    FilesModule,
    PersonPhotosModule,
    QuotaModule,
    TryOnModule,
    ResultsModule,
    ShortlistModule,
    ShareModule,
    EnquiriesModule,
    // Still to land: ModerationModule, AnalyticsModule, RetentionModule.
    // --- end feature modules ---
  ],
})
export class ApiModule {}
