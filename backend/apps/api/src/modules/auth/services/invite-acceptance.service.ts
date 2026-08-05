import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { DataSource, type EntityManager } from 'typeorm';

import { isAdmin, Locale } from '@library/common';
import { runInTransaction } from '@library/database';

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
 */
@Injectable()
export class InviteAcceptanceService {
  private readonly logger = new Logger(InviteAcceptanceService.name);

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

    const user = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<AuthUser> => {
        const acceptance = await this.invites.consumeToken(rawToken, userId, { manager, now });

        return this.accounts.createInvitedAccount(
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
      },
      { label: 'auth.acceptInvitation' },
    );

    if (isAdmin(user.role)) {
      // S-8: mandatory for admins, and impossible to enrol before the account exists.
      // The session below is what lets the console send them straight to `/auth/2fa/setup`.
      this.logger.warn(
        `admin ${user.id} accepted an invitation and has no second factor yet (S-8)`,
      );
    }

    // Not `twofaPending`: there is no secret to challenge against, and a pending
    // session is refused everywhere except the two challenge routes — which would
    // leave a brand-new admin unable to reach the enrolment the invitation exists for.
    const issued = await this.sessionService.issue({
      user,
      ip: facts.ip,
      userAgent: facts.userAgent,
      twofaPending: false,
      now,
    });

    return { body: toAuthUserDto(user), issued };
  }
}
