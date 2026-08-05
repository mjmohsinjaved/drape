import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GarmentsModule } from '@api/modules/garments/garments.module';
import { ResultsModule } from '@api/modules/results/results.module';
import { UsersModule } from '@api/modules/users/users.module';

import { ShortlistController } from './controllers/shortlist.controller';
import { ShortlistItem } from './entities/shortlist-item.entity';
import { ShortlistService } from './services/shortlist.service';

/**
 * `shortlist` — PRD C-20, C-21, C-32, A-38 · ARCHITECTURE §5.13, §4.20.
 *
 * ### Entities registered here
 *
 * `ShortlistItem` only — it is the one table this module owns (§4.33), and it is the
 * single source of truth for a verdict. Verdicts are deliberately **not** stored on
 * `tryon_results`.
 *
 * ### What it imports, and why each one
 *
 * | Module | For |
 * | --- | --- |
 * | `GarmentsModule` | the live title, price and publish state of each shortlisted piece |
 * | `ResultsModule` | the render thumbnail shown beside an item, read through `tryon_results` |
 * | `UsersModule` | `consumer_profiles.budgetBand` — the figure C-32's running total is measured against |
 *
 * Each is imported for its `TypeOrmModule` re-export, the same accommodation
 * `catalog` documents: the entity classes appear only as injection tokens and as
 * types, and every rule about those tables still lives in the module that owns them
 * (§2.9 rule 5). `StorageModule` is `@Global()`, so signing a thumbnail URL needs no
 * import.
 *
 * ### What it exports
 *
 * `ShortlistService`, for `share` (which projects the live shortlist behind a link)
 * and `enquiries` (which snapshots it). Both call `rankedItems()` rather than querying
 * `shortlist_items` themselves, so "what is on the shortlist" — Love it and Maybe, in
 * rank order, never a rejection — has exactly one definition.
 *
 * ### Seams this module leaves open
 *
 * - **A-37 garment counters.** `garments.loveCount` / `maybeCount` / `rejectCount` are
 *   denormalised on the garment row and belong to `GarmentsService`. A verdict should
 *   move them; doing it from here would mean this module writing another module's
 *   table. The clean fill is a `shortlist.verdict-recorded` domain event with an
 *   `@OnEvent` listener in `garments`.
 * - **A-38 rejection rollup.** The rows are here, complete with reason; the aggregate
 *   belongs to `analytics`, which reads them.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ShortlistItem]), GarmentsModule, ResultsModule, UsersModule],
  controllers: [ShortlistController],
  providers: [ShortlistService],
  exports: [ShortlistService, TypeOrmModule],
})
export class ShortlistModule {}
