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
import { tryOnProviderFactory } from './providers/tryon-provider.factory';
import { ReferenceModelsService } from './services/reference-models.service';
import { TestRenderBatchEventsService } from './services/test-render-batch-events.service';
import { TestRenderProcessor } from './services/test-render.processor';
import { TestRenderService } from './services/test-render.service';
import { TryOnCacheService } from './services/tryon-cache.service';
import { TryOnEventsService } from './services/tryon-events.service';
import { TryOnGuardService } from './services/tryon-guard.service';
import { TryOnJobsService } from './services/tryon-jobs.service';
import { TryOnRateLimitService } from './services/tryon-rate-limit.service';
import { TryOnRunnerService } from './services/tryon-runner.service';
import { TryOnService } from './services/tryon.service';

/**
 * PRD §8 / §5.11 — the generation path. **The module where money is spent.**
 *
 * Owns `tryon_jobs`, `tryon_cache` and `reference_models` (§4.33).
 *
 * ### Why it imports what it imports
 *
 *  - **`GarmentsModule`** — its `TypeOrmModule` re-export gives read access to
 *    `garments` and `garment_images` for guard-chain steps 9–10 and for the try-on
 *    source image, and its `hasApprovedTestRender()` is the A-11 predicate the guard
 *    chain delegates to rather than re-deriving.
 *  - **`ResultsModule`** — `ResultWriterService`, the narrow write path into
 *    `tryon_results`. This module never queries history.
 *  - **`ConsentsModule`** — `ConsentsService.assertConsentIsCurrent()` is guard-chain
 *    steps 4–5. Nothing here compares policy versions itself.
 *  - **`SettingsModule`** — `quota.requireEmailVerification` for step 3,
 *    `getBudgetPolicy()` for step 8, and `PreviewModeService` for A-31.
 *
 * ### The two ports, and the one thing that is deliberately not a port
 *
 *  - **`PERSON_PHOTO_PORT`** → `PersonPhotosService.resolveGenerationPhoto()`, which
 *    *is* guard-chain step 11 (ownership, moderation, and C-16's active photo).
 *  - **`QUOTA_PORT`** → `QuotaService` / `BudgetService` / `GenerationSpendService`.
 *    Two separate assertions rather than `assertCanGenerate()`, because §2.4 puts the
 *    C-6 rate limits between them.
 *  - **C-16 cache retirement is a listener, not a port.** `person-photos` used to
 *    declare a `TRYON_CACHE_RETIREMENT` token for this module to bind, and the binding
 *    could never reach it: providers resolve through the *importing* module's
 *    injector, and the import runs this way — `TryOnModule` → `PersonPhotosModule`.
 *    Retirement is hygiene rather than correctness (the §3.7 key already contains
 *    `personPhotoHash`), so it is now driven by `PERSON_PHOTO_EVENTS.REMOVED` and
 *    {@link PersonPhotoRemovedListener}, which runs with the import direction rather
 *    than against it. See that file for the full argument.
 *
 * ### What it exports
 *
 *  - **`TryOnCacheService`** — for callers that want the typed class.
 *  - **`TestRenderService`** — `garments` reads the A-11 state for the publish screen.
 *  - **`TypeOrmModule`** — so `analytics` can read `tryon_jobs` for the E-13
 *    generation-health surface without registering the entity twice.
 *
 * `StorageModule`, `MetricsModule`, `ScheduleModule` and `ConfigModule` are `@Global()`
 * in the composition root, so none of them is imported here.
 */
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
    tryOnProviderFactory,
    { provide: PERSON_PHOTO_PORT, useClass: PersonPhotoServiceAdapter },
    { provide: QUOTA_PORT, useClass: QuotaSpendAdapter },
    { provide: MODERATION_PORT, useClass: ModerationQueueAdapter },
    // C-16. Registered here because this module owns `tryon_cache` (§4.33); it holds
    // the same `TryOnCacheService` instance the generation path uses, so a retirement
    // cannot run against a second, unrelated cache.
    PersonPhotoRemovedListener,
    TryOnGuardService,
    TryOnRateLimitService,
    TryOnCacheService,
    TryOnEventsService,
    TryOnRunnerService,
    TryOnService,
    TryOnJobsService,
    ReferenceModelsService,
    // The A-12 batch bus (§5.11). A singleton for the same reason `TryOnEventsService`
    // is: the processor publishes into the instance the controller streams from, and a
    // second one would be a stream that silently never emits.
    TestRenderBatchEventsService,
    TestRenderService,
    TestRenderProcessor,
  ],
  exports: [TryOnCacheService, TestRenderService, TryOnConfig, TypeOrmModule],
})
export class TryOnModule {}
