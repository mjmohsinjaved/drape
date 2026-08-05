import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GarmentsModule } from '@api/modules/garments/garments.module';
import { DeletionLogEntry } from '@api/modules/retention/entities/deletion-log-entry.entity';
import { SettingsModule } from '@api/modules/settings';
import { ShortlistModule } from '@api/modules/shortlist/shortlist.module';

import { ResultsController } from './controllers/results.controller';
import { TryOnResult } from './entities/tryon-result.entity';
import { ResultDownloadService } from './services/result-download.service';
import { ResultWriterService } from './services/result-writer.service';
import { ResultsService } from './services/results.service';

/**
 * C-24 … C-31 / §5.12 — try-on history.
 *
 * Owns `tryon_results` (§4.33), the most consequential table in the schema: it is what
 * makes a render survive the photo, the job and the garment it came from.
 *
 * Why it imports what it imports:
 *  - **`GarmentsModule`** — for its `TypeOrmModule` re-export. History needs the
 *    garment for exactly one bit of information (is it still available to try on?),
 *    and reading it through the repository rather than through `GarmentsService` keeps
 *    that a single indexed `IN` query per page rather than a service call per row.
 *  - **`SettingsModule`** — the A-27 brand asset and brand name for the C-23 download
 *    watermark.
 *  - **`ShortlistModule`** — the verdict. §5.12 puts `verdict` and `rejectReason` on
 *    the history DTO and a `POST /results/:resultId/verdict` route on this controller,
 *    and §4.20 puts the row itself on `shortlist_items` and nowhere else. So the read
 *    is a keyed projection through that module's `TypeOrmModule` re-export, and the
 *    write is delegated whole to `ShortlistService.recordVerdict()`. No verdict is
 *    decided or stored here.
 *
 * What it exports:
 *  - **`ResultWriterService`** — the write path `tryon` depends on. Deliberately
 *    narrower than `ResultsService`: a module that records a render has no business
 *    also holding the history query and delete surface.
 *  - **`ResultsService`** — for `enquiries` and `share`, which project a render the
 *    consumer has chosen to attach.
 *  - **`TypeOrmModule`** — so those modules can read `tryon_results` without
 *    registering the entity a second time.
 *
 * `StorageModule` and `ConfigModule` are `@Global()` in the composition root.
 */
@Module({
  imports: [
    // `DeletionLogEntry` is `retention`'s table (§4.33) and is registered here as a
    // **write-only** dependency for exactly one statement: §4.18 makes a `deletion_log`
    // row part of what `DELETE /results/:resultId` *is*, and it has to land in the same
    // transaction as the soft delete (§2.9 rule 3). The entity rather than the module,
    // for the reason `moderation.module.ts` sets out at length: importing
    // `RetentionModule` would put the account-deletion cascade in this injector, and
    // `retention` exports no service precisely so that cannot happen. Registering an
    // entity in two `forFeature()` calls is harmless — the metadata is global to the
    // connection.
    TypeOrmModule.forFeature([TryOnResult, DeletionLogEntry]),
    GarmentsModule,
    SettingsModule,
    ShortlistModule,
  ],
  controllers: [ResultsController],
  providers: [ResultsService, ResultWriterService, ResultDownloadService],
  exports: [ResultsService, ResultWriterService, ResultDownloadService, TypeOrmModule],
})
export class ResultsModule {}
