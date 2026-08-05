import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Category } from '@api/modules/categories/entities/category.entity';
import { Enquiry } from '@api/modules/enquiries/entities/enquiry.entity';
import { Garment } from '@api/modules/garments/entities/garment.entity';
import { ModerationModule } from '@api/modules/moderation/moderation.module';
import { NotificationsModule } from '@api/modules/notifications/notifications.module';
import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { QuotaModule } from '@api/modules/quota/quota.module';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';
import { User } from '@api/modules/users/entities/user.entity';

import { AdminAnalyticsController } from './controllers/admin-analytics.controller';
import { CatalogAnalyticsService } from './services/catalog-analytics.service';
import { FunnelService } from './services/funnel.service';
import { GenerationHealthService } from './services/generation-health.service';
import { OverviewService } from './services/overview.service';
import { UsageAnalyticsService } from './services/usage-analytics.service';

/**
 * `analytics` — PRD A-1, A-33, A-36 … A-39, E-13, E-14 · ARCHITECTURE §5.18.
 *
 * ### This module owns no entities, by design
 *
 * §4.33 lists it beside `catalog`, `files` and `health` as owning none. Every table it
 * reads belongs to somebody else, and everything it produces is an aggregate — a count,
 * a sum, a rate. It has no write path at all: not one method in this module inserts,
 * updates or deletes a row anywhere.
 *
 * That is a stronger guarantee than it sounds. A reporting module with a write path is
 * how a "denormalised counter for the dashboard" gets introduced, and a denormalised
 * counter is a second source of truth for a number that already had one.
 *
 * ### The two numbers it does not compute itself
 *
 * | Number | Owner | Why not here |
 * | --- | --- | --- |
 * | remaining budget, consumer/test split, trailing spend | `quota`'s `BudgetService` | `usage_ledger` is append-only and the balance is **derived by summing it** (§4.0 rule 10). A second module summing the same table is a second definition of the same number |
 * | moderation items pending | `moderation`'s `ModerationQueueService` | A-1's tile, and `moderation_items` is that module's table (§4.33) |
 *
 * Everything else is read directly, because the alternative would be adding a counting
 * method to five other modules' services purely so this one could call it.
 *
 * ### Entities registered here, all read-only
 *
 * `User`, `PersonPhoto`, `TryOnResult`, `TryOnJob`, `ShortlistItem`, `Enquiry`,
 * `Garment`, `Category`. §2.9 rule 5 prefers a module over an entity file and this
 * deliberately does not follow it: importing eight feature modules to reach eight
 * repositories would put every one of their services — and their transitive imports —
 * into a reporting module's injector, for the sake of `COUNT(*)`.
 *
 * **`PersonPhoto` deserves a specific word.** It appears in exactly one query, as
 * `COUNT(DISTINCT "userId")` for the A-36 funnel step "photo uploaded". No storage key
 * is selected, nothing is signed, and there is no shape that query could return which
 * identifies an image. A cohort count discloses strictly less than A-16 already
 * authorises (S-10).
 *
 * ### The E-14 edge
 *
 * `GenerationHealthService` sweeps `tryon_jobs` every five minutes and raises the
 * failure-rate alert through `notifications`' `AlertingService`. The condition is
 * visible only to the module that can read the table; the copy lives only in the module
 * that owns the templates. One edge, one direction.
 *
 * ### Nothing is exported
 *
 * Every consumer of this module is a browser, through the seven `@Roles(Role.ADMIN)`
 * routes in `AdminAnalyticsController`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      PersonPhoto,
      TryOnResult,
      TryOnJob,
      ShortlistItem,
      Enquiry,
      Garment,
      Category,
    ]),
    QuotaModule,
    ModerationModule,
    NotificationsModule,
  ],
  controllers: [AdminAnalyticsController],
  providers: [
    OverviewService,
    UsageAnalyticsService,
    FunnelService,
    CatalogAnalyticsService,
    GenerationHealthService,
  ],
})
export class AnalyticsModule {}
