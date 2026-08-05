import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConsentsModule } from '@api/modules/consents/consents.module';
import { DeletionLogEntry } from '@api/modules/retention/entities/deletion-log-entry.entity';
import { RetentionPolicyModule } from '@api/modules/retention/retention-policy.module';
import { SettingsModule } from '@api/modules/settings';

import { PersonPhotosController } from './controllers/person-photos.controller';
import { PersonPhoto } from './entities/person-photo.entity';
import { PersonPhotosService } from './services/person-photos.service';

/**
 * `person-photos` — PRD C-11 … C-16, C-28, C-38 · ARCHITECTURE §5.9, §4.16.
 *
 * ### Entities registered here
 *
 * `PersonPhoto` is owned by this module (§4.33). `DeletionLogEntry` is a **write-only
 * dependency**: §9.3 requires a verifiable deletion log and C-38 puts a 24-hour ceiling
 * on honouring a consumer-initiated deletion, so removing a photograph must leave a
 * record behind. `RetentionModule` owns that table and does not exist yet; §2.9 rule 5
 * says a module imports another module's *module*, not its entity file, so when
 * `RetentionModule` lands this registration should be swapped for a call to its
 * service. Registering an entity in two `forFeature()` calls is harmless — the metadata
 * is global to the connection — which is the same accommodation `users.module.ts`
 * documents for `QuotaLedgerEntry`.
 *
 * ### What this module imports, and why each one
 *
 * | Module | For |
 * | --- | --- |
 * | `ConsentsModule` | `assertConsentIsCurrent()` — C-11's hard gate, before a photo row exists |
 * | `SettingsModule` | `photos.maxPerConsumer` (C-16, default 5) |
 * | `RetentionPolicyModule` | `purgeAfter` — §9.3's window, read and validated in one place |
 *
 * `RetentionPolicyModule` is a deliberately narrow slice of `RetentionModule`, which
 * exports nothing: it computes a date and cannot delete anything. This module used to
 * read `PHOTO_RETENTION_DAYS` itself, unvalidated and anchored on `Date.now()`, which
 * meant a misconfigured `0` wrote every new photograph as already expired while the purge
 * cron — which validated the same variable — was still honouring thirty days.
 *
 * `StorageModule` and `ConfigModule` are `@Global()` in the composition root, so
 * neither is imported here.
 *
 * ### The seam that used to be open, and is now closed the other way round
 *
 * C-16 requires a removed photo's `tryon_cache` rows to be retired, and that table
 * belongs to `TryOnModule` (§4.33). This module used to declare a
 * `TRYON_CACHE_RETIREMENT` port and inject it `@Optional()` for `TryOnModule` to bind
 * — a binding that could never arrive, because `TryOnModule` imports *this* module
 * (for `resolveGenerationPhoto`, guard-chain step 11) and a provider exported by an
 * importing module is not visible in the imported module's injector. Retirement
 * silently no-opped on every deletion.
 *
 * It is now a domain event: `PersonPhotosService` emits
 * `PERSON_PHOTO_EVENTS.REMOVED` after the commit and `TryOnModule` listens. The
 * dependency runs with the import direction instead of against it, needs no
 * `forwardRef` and no global module, and deletion no longer knows a cache exists.
 * `events/person-photo.events.ts` records why eventual retirement is correct here and
 * not a shortcut. `EventEmitterModule` is configured in the composition root, so
 * nothing has to be imported for it.
 *
 * ### What is not here
 *
 * An admin controller, an admin service, an admin query, or any exported method that
 * takes a photo id without a `userId` beside it. That absence is PRD S-10, and it is
 * structural rather than conventional — there is no shape in this module that could
 * return another account's photograph.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PersonPhoto, DeletionLogEntry]),
    ConsentsModule,
    SettingsModule,
    RetentionPolicyModule,
  ],
  controllers: [PersonPhotosController],
  providers: [PersonPhotosService],
  // `TryOnModule` (W3) needs `resolveGenerationPhoto` and `assertOwnedPhoto`;
  // `ResultsModule` needs `signedUrlFor`. Nothing else is exported.
  exports: [PersonPhotosService],
})
export class PersonPhotosModule {}
