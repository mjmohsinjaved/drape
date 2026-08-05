import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GarmentsModule } from '@api/modules/garments/garments.module';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { UsersModule } from '@api/modules/users/users.module';

import { ShortlistController } from './controllers/shortlist.controller';
import { ShortlistItem } from './entities/shortlist-item.entity';
import { ShortlistService } from './services/shortlist.service';

/**
 * `shortlist` — PRD C-20, C-21, C-32, A-38 · ARCHITECTURE §5.13, §4.20.
 *
 * ### Entities registered here
 *
 * `ShortlistItem` — the one table this module owns (§4.33), and the single source of
 * truth for a verdict. Verdicts are deliberately **not** stored on `tryon_results`.
 *
 * `TryOnResult` is registered alongside it purely as a reader, for the render thumbnail
 * shown beside an item. It used to arrive through `ResultsModule`'s `TypeOrmModule`
 * re-export; it is registered directly now because `results` projects the verdict onto
 * its own DTOs (§5.12) and therefore depends on **this** module. Only one of the two
 * edges can exist without a cycle, and the honest direction is the one that follows the
 * write: `results` delegates every verdict here, and reads `tryon_results` here stay
 * exactly what they were — a signed thumbnail URL and nothing else. Every rule about
 * that table still lives in the module that owns it (§2.9 rule 5).
 *
 * ### What it imports, and why each one
 *
 * | Module | For |
 * | --- | --- |
 * | `GarmentsModule` | the live title, price and publish state of each shortlisted piece |
 * | `UsersModule` | `consumer_profiles.budgetBand` — the figure C-32's running total is measured against |
 *
 * Both are imported for their `TypeOrmModule` re-export, the same accommodation
 * `catalog` documents: the entity classes appear only as injection tokens and as
 * types. `StorageModule` is `@Global()`, so signing a thumbnail URL needs no import.
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
  imports: [TypeOrmModule.forFeature([ShortlistItem, TryOnResult]), GarmentsModule, UsersModule],
  controllers: [ShortlistController],
  providers: [ShortlistService],
  exports: [ShortlistService, TypeOrmModule],
})
export class ShortlistModule {}
