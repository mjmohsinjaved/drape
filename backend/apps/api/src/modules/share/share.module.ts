import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GarmentsModule } from '@api/modules/garments/garments.module';
import { SettingsModule } from '@api/modules/settings';
import { ShortlistModule } from '@api/modules/shortlist/shortlist.module';
import { UsersModule } from '@api/modules/users/users.module';

import { PublicShareController } from './controllers/public-share.controller';
import { ShareLinksController } from './controllers/share-links.controller';
import { ShareLink } from './entities/share-link.entity';
import { Vote } from './entities/vote.entity';
import { ShareNotificationsListener } from './listeners/share-notifications.listener';
import { PublicShareService } from './services/public-share.service';
import { ShareLinksService } from './services/share-links.service';
import { ShareTokenService } from './services/share-token.service';

/**
 * `share` — PRD C-33, C-34, A-30 · ARCHITECTURE §5.14, §4.21, §4.22.
 *
 * ### The module boundary is part of the privacy guarantee
 *
 * C-33 promises a recipient sees "only the renders on that shortlist … not her photo,
 * her other renders, or her contact details". Two of those three are enforced by the
 * query in `queries/public-share.scope.ts`. The **first** is enforced here, by
 * omission: `PersonPhotosModule` is not imported, `PersonPhoto` is not registered, and
 * so no code in this module — present or future — has a repository for the table. A
 * developer who tried to add a photo to the share page would have to change this file
 * first, which is exactly the review moment that rule deserves.
 *
 * ### Entities registered here
 *
 * `ShareLink` and `Vote` — the two tables this module owns (§4.33).
 *
 * ### What it imports, and why each one
 *
 * | Module | For |
 * | --- | --- |
 * | `ShortlistModule` | `shortlist_items`, the live set behind a link (§4.21 — there is no snapshot table) |
 * | `GarmentsModule` | garment titles on the owner's vote list |
 * | `SettingsModule` | `sharing.enabled` (A-30) and `catalog.showPricesPublicly` — "price if public" |
 * | `UsersModule` | the owner's address, for the comment email — reachable only from the listener |
 *
 * `Category` and `TryOnResult` appear in the share query as join targets. They are not
 * registered here and no repository for either is injected: the join is expressed
 * against the entity class, and `autoLoadEntities` has already put both on the
 * connection through the modules that own them.
 *
 * ### Seams this module leaves open
 *
 * - **The comment email becomes an outbox row.** Once `NotificationsModule` lands
 *   (§4.32) `ShareNotificationsListener` writes a `notifications_outbox` row inside the
 *   vote's transaction instead of sending inline, which also delivers the in-app copy.
 * - **Vote analytics.** Reaction counts per garment are an `analytics` question; the
 *   rows are here and carry everything that rollup needs.
 * - **Moderation of visitor text.** `voterLabel` and `comment` are untrusted input from
 *   somebody with no account. They are length-capped, escaped by the notification
 *   layout and never interpolated into SQL — but nothing screens them for abuse. The
 *   natural fill is a `moderation_items` row raised from `PublicShareService.castVote`,
 *   with the owner able to remove a comment from her own link.
 * - **Retention.** `share_links` and `votes` are `CASCADE` from `users`, so account
 *   deletion takes them. An expired link's rows are kept for the owner's history; a
 *   sweep that prunes them belongs to `retention`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ShareLink, Vote]),
    ShortlistModule,
    GarmentsModule,
    SettingsModule,
    UsersModule,
  ],
  controllers: [ShareLinksController, PublicShareController],
  providers: [ShareLinksService, PublicShareService, ShareTokenService, ShareNotificationsListener],
  exports: [ShareLinksService],
})
export class ShareModule {}
