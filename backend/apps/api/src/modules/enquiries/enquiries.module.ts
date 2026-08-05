import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GarmentsModule } from '@api/modules/garments/garments.module';
import { ResultsModule } from '@api/modules/results/results.module';
import { SettingsModule } from '@api/modules/settings';
import { ShortlistModule } from '@api/modules/shortlist/shortlist.module';
import { UsersModule } from '@api/modules/users/users.module';

import { AdminEnquiriesController } from './controllers/admin-enquiries.controller';
import { EnquiriesController } from './controllers/enquiries.controller';
import { EnquiryItem } from './entities/enquiry-item.entity';
import { EnquiryNote } from './entities/enquiry-note.entity';
import { Enquiry } from './entities/enquiry.entity';
import { EnquiryNotificationsListener } from './listeners/enquiry-notifications.listener';
import { AdminEnquiriesService } from './services/admin-enquiries.service';
import { EnquiriesService } from './services/enquiries.service';
import { EnquiryExportService } from './services/enquiry-export.service';
import { WhatsAppReplyService } from './services/whatsapp-reply.service';

/**
 * `enquiries` — PRD A-21 … A-26, C-3, C-35, C-36 · ARCHITECTURE §5.15, §4.23 … §4.25.
 *
 * ### This module is S-10's only exception, so its boundary is the guarantee
 *
 * An admin may see a consumer's render **where she has submitted an enquiry**, and
 * nowhere else. That sentence is enforced by what is and is not in this file:
 *
 * - `enquiry_items` is registered here and is the join every admin render lookup
 *   starts from (§4.24);
 * - `PersonPhotosModule` is **not** imported and `PersonPhoto` is **not** registered,
 *   so no service, controller or query in this module has a repository for the table.
 *   An admin route that returned a consumer's photograph would have to change this
 *   file first, which is exactly the review moment that rule deserves.
 *
 * ### Entities registered here
 *
 * `Enquiry`, `EnquiryItem` and `EnquiryNote` — the three tables this module owns
 * (§4.33). `EnquiryNote` is append-only (§4.25): no update route, no delete route.
 *
 * ### What it imports, and why each one
 *
 * | Module | For |
 * | --- | --- |
 * | `ShortlistModule` | `rankedItems()` — the set snapshotted at submission (A-21) |
 * | `GarmentsModule` | title, SKU and price **at submission**, copied into the snapshot |
 * | `ResultsModule` | `tryon_results`, reached only through `enquiry_items` (§4.24) |
 * | `UsersModule` | her verified contact snapshot, the admin recipients, note authors |
 * | `SettingsModule` | `enquiries.enabled` (A-30) and the A-27 brand WhatsApp number |
 *
 * ### What it exports
 *
 * `EnquiriesService` and `AdminEnquiriesService`, for the A-1 dashboard tiles and the
 * A-36 funnel that `analytics` will build. Nothing that writes a status: the state
 * machine has one entrance and it is the admin route.
 *
 * ### Seams this module leaves open
 *
 * - **In-app notification (A-25).** Half of A-25 is delivered — the email — and the
 *   in-app half waits on `notifications_outbox` (§4.32). See
 *   `listeners/enquiry-notifications.listener.ts`; both handlers become outbox writes
 *   inside the originating transaction when that module lands.
 * - **A-37's `garments.enquiryCount`.** The counter is denormalised on the garment row
 *   and belongs to `GarmentsService`. The clean fill is an `@OnEvent` listener in
 *   `garments` on `enquiry.created`, which this module already emits.
 * - **Retention.** `enquiries` is `CASCADE` from `users`, so account deletion takes the
 *   enquiry and its items and notes with it. Whether a closed enquiry should be
 *   retained beyond that for the studio's own records is a §9.3 policy decision that
 *   belongs in `retention`, not here.
 * - **A stale-enquiry digest.** The 24-hour flag is computed and filterable; a daily
 *   email that pushes it at the studio rather than waiting to be asked is a `@Cron` in
 *   whichever module ends up owning scheduled digests.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Enquiry, EnquiryItem, EnquiryNote]),
    ShortlistModule,
    GarmentsModule,
    ResultsModule,
    UsersModule,
    SettingsModule,
  ],
  controllers: [EnquiriesController, AdminEnquiriesController],
  providers: [
    EnquiriesService,
    AdminEnquiriesService,
    EnquiryExportService,
    WhatsAppReplyService,
    EnquiryNotificationsListener,
  ],
  exports: [EnquiriesService, AdminEnquiriesService, TypeOrmModule],
})
export class EnquiriesModule {}
