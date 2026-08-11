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

@Injectable()
export class InviteAcceptanceService {
  constructor(
    private readonly invites: InvitesService,
    @Inject(INVITED_ACCOUNT_DIRECTORY) private readonly accounts: InvitedAccountDirectory,
    private readonly passwordService: PasswordService,
    private readonly sessionService: SessionService,
    private readonly dataSource: DataSource,
  ) {}

  async accept(
    rawToken: string,
    dto: AcceptInviteDto,
    facts: RequestFacts,
  ): Promise<AuthResult<AuthUserDto>> {
    const now = new Date();

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

    this.invites.announceAccepted(acceptedEvent);

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
