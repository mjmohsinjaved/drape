import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { DataSource, type EntityManager } from 'typeorm';

import { Locale } from '@library/common';
import { runInTransaction } from '@library/database';

import type { InviteAcceptedEvent } from '@api/modules/invites/constants/invite-events.constant';
import { InvitesService } from '@api/modules/invites/services/invites.service';

import { INVITED_ACCOUNT_DIRECTORY } from '../auth.constants';
import { toAuthUserDto } from '../mappers/auth.mapper';

import { PasswordService } from './password.service';
import { SessionService } from './session.service';

import type { AuthResult, RequestFacts } from './auth.service';
import type { AcceptInviteDto } from '../dto/accept-invite.dto';
import type { AuthUserDto } from '../dto/auth-response.dto';
import type { InvitedAccountDirectory } from '../interfaces/invited-account-directory.interface';
import type { AuthUser } from '../interfaces/user-directory.interface';

/**
 * `POST /invites/token/:token/accept` — PRD S-5, ARCHITECTURE §5.3.
 *
 * ### Why the endpoint is here and not in `invites`
 *
 * §5.3 lists the route under the invites path, but what it *does* is create an
 * account: apply the S-6 password policy, hash with Argon2id, open a session. All of
 * that is auth's, and `invites.controller.ts` says so in as many words. This service
 * is the other half of the seam `invites/interfaces/invite-acceptance.interface.ts`
 * describes.
 *
 * ### The one rule that matters
 *
 * > "Admin accounts are created only by the deployment seed script or by invitation
 * > from an existing Admin, accepted through a single-use emailed token." (S-5)
 *
 * The email, the role and the inviter all come from the consumed invite row. The
 * request body carries a name, a password and a locale — and `AcceptInviteDto` has no
 * other fields, so there is nothing a caller could send that reaches `users.role`.
 *
 * ### One transaction
 *
 * The account insert and the token burn share a `runInTransaction` block. The id is
 * generated up front so `consumeToken` can stamp `consumedByUserId` before the row
 * exists — which lets the burn happen *first*, with `consumedAt IS NULL` in its WHERE
 * clause. Two requests racing on one token therefore cannot both create an account:
 * the loser updates zero rows, `INVITE_ALREADY_CONSUMED` propagates, and its
 * transaction — account included — rolls back.
 *
 * The `INVITE_ACCEPTED` event is emitted **after** that commit, not from inside the
 * block. An `EventEmitter2` emit does not roll back, so a rolled-back acceptance would
 * otherwise leave a permanent audit row saying it succeeded.
 */
@Injectable()
export class InviteAcceptanceService {
  constructor(
    private readonly invites: InvitesService,
    @Inject(INVITED_ACCOUNT_DIRECTORY) private readonly accounts: InvitedAccountDirectory,
    private readonly passwordService: PasswordService,
    private readonly sessionService: SessionService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Consumes the token and creates the account it describes.
   *
   * @throws `PASSWORD_POLICY_VIOLATION`, `TOKEN_INVALID`, `INVITE_NOT_FOUND`,
   * `INVITE_EXPIRED`, `INVITE_ALREADY_CONSUMED`, `EMAIL_ALREADY_EXISTS`.
   */
  async accept(
    rawToken: string,
    dto: AcceptInviteDto,
    facts: RequestFacts,
  ): Promise<AuthResult<AuthUserDto>> {
    const now = new Date();

    // Before the transaction: rejecting a weak password must not burn the token, and
    // Argon2 is deliberately expensive — no reason to hold a transaction open for it.
    this.passwordService.assertMeetsPolicy(dto.password, 'password');
    const passwordHash = await this.passwordService.hash(dto.password);

    const userId = randomUUID();

    const { user, acceptedEvent } = await runInTransaction(
      this.dataSource,
      async (
        manager: EntityManager,
      ): Promise<{ user: AuthUser; acceptedEvent: InviteAcceptedEvent }> => {
        const acceptance = await this.invites.consumeToken(rawToken, userId, { manager, now });

        const created = await this.accounts.createInvitedAccount(
          {
            id: userId,
            // Every one of these three comes off the invite row (S-5, S-4).
            email: acceptance.email,
            role: acceptance.role,
            invitedBy: acceptance.invitedBy,
            name: dto.name.trim(),
            passwordHash,
            locale: dto.locale ?? Locale.EN,
            emailVerifiedAt: now,
          },
          { manager },
        );

        return { user: created, acceptedEvent: acceptance.acceptedEvent };
      },
      { label: 'auth.acceptInvitation' },
    );

    // After the commit, never inside it. `createInvitedAccount` above can still fail —
    // a duplicate address, a constraint — and roll the token burn back with it; an
    // `INVITE_ACCEPTED` audit row emitted from inside the block would have survived
    // that rollback and recorded an acceptance that never happened.
    this.invites.announceAccepted(acceptedEvent);

    const issued = await this.sessionService.issue({
      user,
      ip: facts.ip,
      userAgent: facts.userAgent,
      now,
    });

    return { body: toAuthUserDto(user), issued };
  }
}
