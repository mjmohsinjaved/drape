import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '@api/modules/users/users.module';

import { InvitesController } from './controllers/invites.controller';
import { Invite } from './entities/invite.entity';
import { InvitesService } from './services/invites.service';

/**
 * `invites` — admin invitations (S-5, ARCHITECTURE §5.3).
 *
 * Owns `invites` and nothing else (§4.33).
 *
 * `UsersModule` is imported rather than the `User` entity file, per §2.9 rule 5:
 * `InvitesService` needs to answer one question — "does an account already sign in
 * with this address?" — and `UsersModule` re-exports `TypeOrmModule`, so the
 * repository arrives through the module boundary.
 *
 * ### Exported for `auth`
 *
 * `InvitesService`, for one method:
 *
 * ```ts
 * consumeToken(rawToken: string, consumedByUserId: string, options?: {
 *   manager?: EntityManager;
 *   now?: Date;
 * }): Promise<InviteAcceptance>
 * ```
 *
 * `auth` owns `POST /invites/token/:token/accept` and calls this from inside its own
 * transaction, creating the account for the returned `email` and `role` — both read
 * from the invite row, never from the request body. That is what keeps the emailed
 * token, rather than the caller, in charge of who becomes an admin (S-5, S-4).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Invite]), UsersModule],
  controllers: [InvitesController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
