import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConsentsModule } from '@api/modules/consents';
import { GarmentsModule } from '@api/modules/garments/garments.module';
import { ModerationModule } from '@api/modules/moderation';
import { PersonPhotosModule } from '@api/modules/person-photos';
import { QuotaModule } from '@api/modules/quota';
import { ResultsModule } from '@api/modules/results';
import { SettingsModule } from '@api/modules/settings';

import { ModerationQueueAdapter } from './adapters/moderation.adapter';
import { PersonPhotoServiceAdapter } from './adapters/person-photo.adapter';
import { QuotaSpendAdapter } from './adapters/quota-spend.adapter';
import { TryOnConfig } from './config/tryon.config';
import { AdminTryOnController } from './controllers/admin-tryon.controller';
import { TryOnController } from './controllers/tryon.controller';
import { ReferenceModel } from './entities/reference-model.entity';
import { TryOnCache } from './entities/tryon-cache.entity';
import { TryOnJob } from './entities/tryon-job.entity';
import { PersonPhotoRemovedListener } from './listeners/person-photo-removed.listener';
import { MODERATION_PORT } from './ports/moderation.port';
import { PERSON_PHOTO_PORT } from './ports/person-photo.port';
import { QUOTA_PORT } from './ports/quota.port';
import {
  TRYON_PROVIDER_RESOLVER,
  TryOnProviderResolver,
} from './providers/tryon-provider.resolver';
import { ReferenceModelsService } from './services/reference-models.service';
import { TestRenderBatchEventsService } from './services/test-render-batch-events.service';
import { TestRenderProcessor } from './services/test-render.processor';
import { TestRenderService } from './services/test-render.service';
import { TryOnCacheService } from './services/tryon-cache.service';
import { TryOnEventsService } from './services/tryon-events.service';
import { TryOnGuardService } from './services/tryon-guard.service';
import { TryOnJobsService } from './services/tryon-jobs.service';
import { TryOnProviderAdminService } from './services/tryon-provider-admin.service';
import { TryOnRateLimitService } from './services/tryon-rate-limit.service';
import { TryOnRunnerService } from './services/tryon-runner.service';
import { TryOnService } from './services/tryon.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TryOnJob, TryOnCache, ReferenceModel]),
    GarmentsModule,
    ResultsModule,
    ConsentsModule,
    SettingsModule,
    PersonPhotosModule,
    QuotaModule,
    ModerationModule,
  ],
  controllers: [TryOnController, AdminTryOnController],
  providers: [
    TryOnConfig,
    TryOnProviderResolver,
    { provide: TRYON_PROVIDER_RESOLVER, useExisting: TryOnProviderResolver },
    TryOnProviderAdminService,
    { provide: PERSON_PHOTO_PORT, useClass: PersonPhotoServiceAdapter },
    { provide: QUOTA_PORT, useClass: QuotaSpendAdapter },
    { provide: MODERATION_PORT, useClass: ModerationQueueAdapter },
    PersonPhotoRemovedListener,
    TryOnGuardService,
    TryOnRateLimitService,
    TryOnCacheService,
    TryOnEventsService,
    TryOnRunnerService,
    TryOnService,
    TryOnJobsService,
    ReferenceModelsService,
    TestRenderBatchEventsService,
    TestRenderService,
    TestRenderProcessor,
  ],
  exports: [TryOnCacheService, TestRenderService, TryOnConfig, TypeOrmModule],
})
export class TryOnModule {}
