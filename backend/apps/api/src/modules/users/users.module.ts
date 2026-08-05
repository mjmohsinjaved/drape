import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { INVITED_ACCOUNT_DIRECTORY, USER_DIRECTORY } from '@api/modules/auth/auth.constants';
import { EnquiryItem } from '@api/modules/enquiries/entities/enquiry-item.entity';
import { Enquiry } from '@api/modules/enquiries/entities/enquiry.entity';
import { QuotaLedgerEntry } from '@api/modules/quota/entities/quota-ledger-entry.entity';
import { DeletionLogEntry } from '@api/modules/retention/entities/deletion-log-entry.entity';
import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';

import { AdminConsumersController } from './controllers/admin-consumers.controller';
import { AdminUsersController } from './controllers/admin-users.controller';
import { MeController } from './controllers/me.controller';
import { ConsumerProfile } from './entities/consumer-profile.entity';
import { User } from './entities/user.entity';
import { AdminConsumersService } from './services/admin-consumers.service';
import { AdminUsersService } from './services/admin-users.service';
import { ConsumerQueryService } from './services/consumer-query.service';
import { InvitedAccountDirectoryService } from './services/invited-account-directory.service';
import { MeService } from './services/me.service';
import { UserDirectoryService } from './services/user-directory.service';

/**
 * `users` — admin management (A-2), consumer management (A-16 … A-20) and the self
 * routes (C-2, C-7). ARCHITECTURE §5.2.
 *
 * ### Entities registered here
 *
 * `User` and `ConsumerProfile` are owned by this module (§4.33). The other five are
 * **read-only dependencies** of the A-16 counts and the A-17 detail view, plus the
 * A-20 confirmation record:
 *
 * | Entity | Why | Access |
 * | --- | --- | --- |
 * | `ShortlistItem` | shortlist size, A-17 shortlist | read |
 * | `Enquiry`, `EnquiryItem` | enquiry count, A-17 history, **the S-10 render gate** | read |
 * | `QuotaLedgerEntry` | generations this month, derived with `SUM` (§4.0/10) | read |
 * | `DeletionLogEntry` | the A-20 confirmation record | append |
 *
 * §2.9 rule 5 says a module imports another module's *module*, not its entity file.
 * None of `shortlist`, `enquiries`, `quota` or `retention` exists yet, so these are
 * registered directly and every read is confined to `ConsumerQueryService`. When
 * those modules land, swap each block of queries for a call to the owning service
 * and drop the entity from this list. Registering an entity in two `forFeature()`
 * calls is harmless — the metadata is global to the connection.
 *
 * ### What is **not** registered here
 *
 * `PersonPhoto`. Deliberately, and it is the whole of S-10: this module holds no
 * handle on the table, so no admin route it exposes can read a consumer's photo —
 * not by mistake, not after a careless edit, not at all.
 *
 * ### The two seams this module fills for `auth`
 *
 * `auth` owns authentication but not the `users` table (§4.33), so it declares two
 * narrow ports and this module binds both:
 *
 * | Token | Implementation | For |
 * | --- | --- | --- |
 * | `USER_DIRECTORY` | {@link UserDirectoryService} | login, signup, `/auth/me`, session resolution |
 * | `INVITED_ACCOUNT_DIRECTORY` | {@link InvitedAccountDirectoryService} | `POST /invites/token/:token/accept` (S-5) |
 *
 * They are two classes rather than one with six methods, so the object bound to
 * `USER_DIRECTORY` — the one signup and login hold — has no admin-creating method on
 * it at all (S-4).
 *
 * `AuthModule` imports this module to reach them. The reverse edge does **not**
 * exist: `SESSION_REVOCATION` is bound by `AuthModule`, which is `@Global()`, so its
 * exports are already visible here. One direction, no cycle, no `forwardRef`.
 *
 * ### Seams this module still expects someone else to fill
 *
 * - `QuotaModule` owns the arithmetic behind `monthlyQuotaOverride` (A-18).
 * - `RetentionModule` executes the purge this module records (A-20).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      ConsumerProfile,
      ShortlistItem,
      Enquiry,
      EnquiryItem,
      QuotaLedgerEntry,
      DeletionLogEntry,
    ]),
  ],
  controllers: [AdminUsersController, AdminConsumersController, MeController],
  providers: [
    AdminUsersService,
    AdminConsumersService,
    ConsumerQueryService,
    MeService,
    UserDirectoryService,
    InvitedAccountDirectoryService,
    { provide: USER_DIRECTORY, useExisting: UserDirectoryService },
    { provide: INVITED_ACCOUNT_DIRECTORY, useExisting: InvitedAccountDirectoryService },
  ],
  // `TypeOrmModule` is re-exported because `invites` asks one question of the `users`
  // table — "does an account already sign in with this address?" — through the
  // repository, per the note in `invites.module.ts`. `auth` does not use it: it goes
  // through the two ports below.
  exports: [TypeOrmModule, MeService, USER_DIRECTORY, INVITED_ACCOUNT_DIRECTORY],
})
export class UsersModule {}
