import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SettingsModule } from '@api/modules/settings';
import { User } from '@api/modules/users/entities/user.entity';

import { MeNotificationsController } from './controllers/me-notifications.controller';
import { NotificationOutboxEntry } from './entities/notification-outbox-entry.entity';
import { BudgetAlertListener } from './listeners/budget-alert.listener';
import { OutboxProcessor } from './processors/outbox.processor';
import { AlertingService } from './services/alerting.service';
import { NotificationsInboxService } from './services/notifications-inbox.service';
import { OutboxService } from './services/outbox.service';

/**
 * `notifications` — PRD A-25, E-11, E-14 · ARCHITECTURE §4.32, §5.2.
 *
 * ### The property the whole module is built around
 *
 * **A notification row is written inside the transaction that made the thing it
 * announces true, and delivered by a different process afterwards.** Everything here
 * follows from that one sentence: {@link OutboxService} only ever inserts,
 * {@link OutboxProcessor} only ever delivers, and no request path anywhere in the
 * application waits on a mail server (E-11).
 *
 * ### Entities registered here
 *
 * `NotificationOutboxEntry` is owned by this module (§4.33). `User` is a **read-only
 * dependency** with two uses and no third:
 *
 * | Use | Why the table has to be reachable |
 * | --- | --- |
 * | Address resolution at delivery time | §4.32 lets `recipientAddress` be null when a `recipientUserId` is present; resolving late keeps one fewer copy of a personal identifier in a second table (E-12) and honours an address she corrected after the enqueue |
 * | The E-14 recipient list | An operator alert goes to "every active admin", which is a `role`/`status` query |
 *
 * `UsersModule` re-exports its `TypeOrmModule`, so this is the same accommodation
 * `quota.module.ts` documents in the other direction — except that this module does
 * not import `UsersModule` at all. It registers `User` directly, because importing
 * `UsersModule` would pull `MeService`, `AdminConsumersService` and the two auth
 * directory ports into the injector of a module whose only interest in `users` is one
 * email address and one role filter.
 *
 * ### What this module must never do
 *
 * **Import a feature module.** Everything that needs to notify depends on *this*; if
 * this depended back on any of them the graph would cycle the first time a second
 * module wanted an outbox row. The two inbound edges are therefore both events:
 * {@link BudgetAlertListener} listens for `quota`'s threshold crossings, and every
 * other alert arrives as a direct call on {@link AlertingService} from a module that
 * imports this one.
 *
 * `SettingsModule` is the single exception, and it is an infrastructure module rather
 * than a feature one: A-29's warn threshold is a setting, and an alert that names a
 * threshold should name the one actually in force.
 *
 * ### What is exported, and who wants it
 *
 * | Export | Consumer | For |
 * | --- | --- | --- |
 * | `OutboxService` | `enquiries`, `share`, `tryon`, `moderation`, `retention` | the transactional enqueue — the seam both `enquiries` and `share` documented and waited for |
 * | `AlertingService` | `moderation`, `retention`, `analytics` | the E-14 conditions those modules are the only ones able to detect |
 * | `NotificationsInboxService` | `retention` | removing an account's notifications on deletion (§9.3) |
 */
@Module({
  imports: [TypeOrmModule.forFeature([NotificationOutboxEntry, User]), SettingsModule],
  controllers: [MeNotificationsController],
  providers: [
    OutboxService,
    NotificationsInboxService,
    AlertingService,
    OutboxProcessor,
    BudgetAlertListener,
  ],
  exports: [OutboxService, NotificationsInboxService, AlertingService],
})
export class NotificationsModule {}
