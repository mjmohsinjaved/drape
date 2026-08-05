import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '@api/modules/audit/audit.module';
import { AuthAttempt } from '@api/modules/auth/entities/auth-attempt.entity';
import { NotificationsModule } from '@api/modules/notifications/notifications.module';
import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';
import { User } from '@api/modules/users/entities/user.entity';

import { AdminAbuseController } from './controllers/admin-abuse.controller';
import { AdminModerationController } from './controllers/admin-moderation.controller';
import { IpBlock } from './entities/ip-block.entity';
import { ModerationItem } from './entities/moderation-item.entity';
import { AbuseService } from './services/abuse.service';
import { ModerationMonitorService } from './services/moderation-monitor.service';
import { ModerationQueueService } from './services/moderation-queue.service';

/**
 * `moderation` — PRD A-34, A-35, S-10, E-14 · ARCHITECTURE §4.8, §4.29, §5.17.
 *
 * ### The property the whole module is built around
 *
 * **A moderator sees a blurred derivative or nothing at all.** Not "a moderator is
 * shown the blurred version" — that would be a rendering decision, and rendering
 * decisions get edited. The original photograph's storage key is never selected by any
 * query this module makes (`MODERATION_PHOTO_COLUMNS`), so there is no value in this
 * process that could be signed, logged or returned. S-10 holds because of what is
 * absent, not because of what is checked.
 *
 * ### Entities registered here
 *
 * `ModerationItem` and `IpBlock` are owned by this module (§4.33). Four others are
 * dependencies, and each is narrower than it looks:
 *
 * | Entity | Access | Why |
 * | --- | --- | --- |
 * | `PersonPhoto` | read (explicit column list, **never `storageKey`**) · write (`moderationState` only) | A-34's decision has to reach the photograph, and `person-photos` exposes no service method for it |
 * | `TryOnJob` | read (aggregate) · write (`status`, `errorCode` on a blocked job) | A-35 counts repeated failures; a rejection must settle the generation waiting on it rather than leave it queued forever |
 * | `AuthAttempt` | read (aggregate only) | A-35's "accounts hitting rate limits", and the E-14 anomaly signal. §4.7 keeps addresses out of this table, so an aggregate over it carries none |
 * | `User` | read (`id`, `status`) | Whether an account on the A-35 list is already suspended |
 *
 * §2.9 rule 5 prefers a module over an entity file, and this deliberately does not
 * follow it for these four. Importing `PersonPhotosModule` would put
 * `PersonPhotosService` — which *does* hold `storageKey`, and must, because it serves
 * her own photograph to her — inside this module's injector. Registering the entity and
 * confining every read to one method with an explicit column list is the narrower
 * dependency, and it is the one S-10 asks for. Registering an entity in two
 * `forFeature()` calls is harmless: the metadata is global to the connection.
 *
 * ### Modules imported, and why exactly two
 *
 * - **`AuditModule`** for `AuditService`. This is the one module in the codebase that
 *   injects it directly rather than emitting `AUDIT_RECORD_EVENT`, and `AuditService`'s
 *   own contract names the reason: A-34 audits the *read itself*, so the row must have
 *   landed before the response is written. An event would make the audit a side effect
 *   of a view that had already happened.
 * - **`NotificationsModule`** for `AlertingService`, so the backlog E-14 detects here
 *   can be raised there. The edge runs one way; `notifications` imports nothing from
 *   this module.
 *
 * ### What is exported
 *
 * `ModerationQueueService` — for the A-1 landing tile ("items flagged for review"),
 * which `analytics` assembles. Nothing else: approving a photograph is an admin
 * decision behind an audited route, and no other module has any business doing it.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ModerationItem, IpBlock, PersonPhoto, TryOnJob, AuthAttempt, User]),
    AuditModule,
    NotificationsModule,
  ],
  controllers: [AdminModerationController, AdminAbuseController],
  providers: [ModerationQueueService, AbuseService, ModerationMonitorService],
  exports: [ModerationQueueService],
})
export class ModerationModule {}
