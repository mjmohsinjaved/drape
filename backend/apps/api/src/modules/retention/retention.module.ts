import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConsentsModule } from '@api/modules/consents';
import { Consent } from '@api/modules/consents/entities/consent.entity';
import { EnquiryItem } from '@api/modules/enquiries/entities/enquiry-item.entity';
import { Enquiry } from '@api/modules/enquiries/entities/enquiry.entity';
import { NotificationsModule } from '@api/modules/notifications/notifications.module';
import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { ShareLink } from '@api/modules/share/entities/share-link.entity';
import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { TryOnCache } from '@api/modules/tryon/entities/tryon-cache.entity';
import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';
import { User } from '@api/modules/users/entities/user.entity';

import { MeDataController } from './controllers/me-data.controller';
import { DeletionLogEntry } from './entities/deletion-log-entry.entity';
import { RenderDeletedListener } from './listeners/render-deleted.listener';
import { RetentionProcessor } from './processors/retention.processor';
import { AccountDeletionService } from './services/account-deletion.service';
import { DataExportService } from './services/data-export.service';
import { MyDataService } from './services/my-data.service';
import { PurgeService } from './services/purge.service';

/**
 * `retention` — PRD A-20, C-27, C-37 … C-40, §9.3, E-14 · ARCHITECTURE §4.31, §5.2.
 *
 * ### The property the whole module is built around
 *
 * **A time-based purge can delete a photograph and can never delete a render.**
 *
 * > C-27: "Renders persist for the life of the account. They are not subject to a
 * > time-based purge and are removed only when she deletes them individually or deletes
 * > her account."
 *
 * `PurgeService` does not inject `Repository<TryOnResult>`. It cannot reach the table,
 * so no edit to it — however careless — can make it delete a render. `AccountDeletionService`
 * does hold that repository, because deleting the account is the case where renders
 * *must* go, and the two paths are separate classes precisely so that "expired" and
 * "deleted" can never be confused for one another. The spec beside `purge.service.ts`
 * asserts the guarantee directly against a database full of expired photographs and
 * their renders.
 *
 * ### Entities registered here
 *
 * `DeletionLogEntry` is owned by this module (§4.33). The other ten are the cascade:
 * deletion is, by its nature, the one operation that has to touch every table an account
 * appears in, and §9.3's "everything belonging to an account is removed" cannot be
 * delegated to ten services that each know about their own. It is done here, in one
 * transaction, with a manifest — because a cascade split across ten modules is a cascade
 * with ten places to forget a table.
 *
 * `TryOnCache` is registered for two purposes, both of them pointer hygiene rather than
 * data: dropping rows whose canonical object was a render this module just deleted
 * (account deletion), and {@link RenderDeletedListener} doing the same for an individual
 * deletion — the gap `modules/tryon` flagged. Neither ever deletes cached *bytes*: §3.7
 * makes those the owner's live render, and `TryOnCacheService` documents at length why
 * retiring a row must never take a file.
 *
 * ### Modules imported
 *
 * - **`NotificationsModule`** — the outbox, for the C-38 confirmation queued inside the
 *   deletion transaction; `NotificationsInboxService`, to remove her in-app notifications
 *   with everything else; and `AlertingService`, for the E-14 purge-failure alert.
 * - **`ConsentsModule`** — C-37 asks for "the consent she granted with its date", and
 *   whether it is still current is `PolicyService`'s question, not a comparison this
 *   module should reimplement.
 *
 * ### Nothing is exported
 *
 * Deletion is requested through `DELETE /me` (C-38) or `DELETE /admin/consumers/:userId`
 * (A-20, in `users`, which writes the request row this module executes). A service
 * exported from here would be a second way to delete an account that skipped the
 * `deletion_log` row — and that row is the whole of §9.3's "verifiable".
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeletionLogEntry,
      User,
      PersonPhoto,
      TryOnResult,
      TryOnJob,
      TryOnCache,
      ShortlistItem,
      ShareLink,
      Enquiry,
      EnquiryItem,
      Consent,
    ]),
    NotificationsModule,
    ConsentsModule,
  ],
  controllers: [MeDataController],
  providers: [
    PurgeService,
    AccountDeletionService,
    MyDataService,
    DataExportService,
    RetentionProcessor,
    RenderDeletedListener,
  ],
})
export class RetentionModule {}
