import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, IsNull, Not, Repository, type EntityManager } from 'typeorm';

import {
  ConflictException,
  ErrorCode,
  MILLISECONDS_PER_DAY,
  NotFoundException,
  randomToken,
  Role,
  sha256Hex,
  UserStatus,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';
import { paginate, runInTransaction } from '@library/database';
import { NotificationsService, TemplateId } from '@library/notifications';

import { User } from '@api/modules/users/entities/user.entity';

import {
  INVITE_EVENTS,
  type InviteAcceptedEvent,
  type InviteIssuedEvent,
  type InviteRevokedEvent,
} from '../constants/invite-events.constant';
import { Invite } from '../entities/invite.entity';
import { InviteStatus } from '../enums/invite-status.enum';
import { toInviteResponse, toInviteTokenPreview } from '../mappers/invite.mapper';

import type { CreateInviteDto } from '../dto/create-invite.dto';
import type { InviteQueryDto } from '../dto/invite-query.dto';
import type { InviteResponseDto, InviteTokenPreviewResponseDto } from '../dto/invite-response.dto';
import type {
  ConsumeInviteOptions,
  InviteAcceptance,
} from '../interfaces/invite-acceptance.interface';

/** 32 random bytes, base64url. Long enough that guessing is not a strategy. */
const INVITE_TOKEN_BYTES = 32;

/** The columns a list or lookup reads. `tokenHash` is never among them. */
const INVITE_COLUMNS = [
  'id',
  'email',
  'role',
  'expiresAt',
  'consumedAt',
  'invitedBy',
  'consumedByUserId',
  'createdAt',
  'deletedAt',
] as const;

/** A freshly issued token: the raw value to email, and the digest to store. */
interface IssuedToken {
  readonly raw: string;
  readonly hash: string;
}

/**
 * Admin invitations — PRD S-5, ARCHITECTURE §5.3.
 *
 * > "Admin accounts are created only by the deployment seed script or by invitation
 * > from an existing Admin, accepted through a single-use emailed token."
 *
 * ### The token
 *
 * 32 random bytes, base64url, emailed once and **never stored**. What the row holds
 * is `sha256(token)`, so a database dump does not contain a working invitation. A
 * lookup hashes the presented value and matches on the digest — the same shape
 * `sessions.tokenHash` uses (§4.5), and the reason `resend` issues a *new* token
 * rather than re-sending the old one: nothing in this system can recover the
 * original.
 *
 * ### Single use
 *
 * `consumeToken` stamps `consumedAt` with `consumedAt IS NULL` in the WHERE clause
 * and checks the affected-row count. Two requests racing on the same token cannot
 * both win — the second updates zero rows and is refused — without an advisory lock
 * or a serializable transaction.
 *
 * ### What this module cannot do
 *
 * Create a `users` row, hash a password, or open a session. `auth` calls
 * `consumeToken` from inside its own transaction and does all three (see
 * `invite-acceptance.interface.ts`). And no route here is reachable by a consumer:
 * the four management routes are `@Roles(Role.ADMIN)` and the two public ones only
 * read a token's own state.
 */
@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    @InjectRepository(Invite) private readonly invites: Repository<Invite>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  /* -----------------------------------------------------------------------------------------
   * Admin routes
   * -------------------------------------------------------------------------------------- */

  /**
   * `GET /invites` — pending, consumed, expired and revoked (§5.3).
   *
   * The status is a predicate over `consumedAt`, `expiresAt` and `deletedAt`, not a
   * column (§4.9). `REVOKED` is the only filter that reads soft-deleted rows, so
   * `withDeleted()` is applied for that case alone — a revoked invite is history an
   * admin should be able to see, not a row that should reappear everywhere else.
   */
  async list(query: InviteQueryDto): Promise<IPaginated<InviteResponseDto>> {
    const now = new Date();
    const qb = this.invites
      .createQueryBuilder('invite')
      .select(INVITE_COLUMNS.map((column) => `invite.${column}`));

    switch (query.status) {
      case InviteStatus.REVOKED:
        qb.withDeleted().where('invite.deletedAt IS NOT NULL');
        break;
      case InviteStatus.CONSUMED:
        qb.where('invite.deletedAt IS NULL').andWhere('invite.consumedAt IS NOT NULL');
        break;
      case InviteStatus.EXPIRED:
        qb.where('invite.deletedAt IS NULL')
          .andWhere('invite.consumedAt IS NULL')
          .andWhere('invite.expiresAt <= :now', { now });
        break;
      case InviteStatus.PENDING:
        qb.where('invite.deletedAt IS NULL')
          .andWhere('invite.consumedAt IS NULL')
          .andWhere('invite.expiresAt > :now', { now });
        break;
      default:
        qb.where('invite.deletedAt IS NULL');
        break;
    }

    if (query.search !== undefined) {
      qb.andWhere('invite.email ILIKE :search', { search: `%${query.search}%` });
    }

    const page = await paginate(qb, query, {
      sortableColumns: ['createdAt', 'expiresAt', 'email', 'consumedAt'],
      alias: 'invite',
    });

    return { items: page.items.map((invite) => toInviteResponse(invite, now)), meta: page.meta };
  }

  /**
   * `POST /invites` — invite an admin by email (S-5, A-2).
   *
   * An expired invitation for the same address is revoked and replaced rather than
   * refused: `UQ_invites_email_pending` covers every unconsumed row, so a lapsed
   * invite would otherwise block the address for ever. Both writes are in one
   * transaction, so the address is never left with no invite at all.
   */
  async create(actor: ICurrentUser, dto: CreateInviteDto): Promise<InviteResponseDto> {
    const email = dto.email;
    await this.assertNoActiveAccount(email);

    const existing = await this.invites.findOne({ where: { email, consumedAt: IsNull() } });
    const now = new Date();

    if (existing !== null && existing.expiresAt.getTime() > now.getTime()) {
      throw new ConflictException(ErrorCode.RESOURCE_CONFLICT, {
        message: 'An invitation for this address is already open. Resend it or revoke it first.',
      });
    }

    const token = issueToken();
    const expiresAt = this.expiryFrom(now);

    const invite = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<Invite> => {
        const repository = manager.getRepository(Invite);

        if (existing !== null) {
          // Lapsed, and in the way of the one-pending-invite index. Clear it first.
          await repository.softDelete({ id: existing.id });
        }

        return repository.save(
          repository.create({
            email,
            // Read from S-5, never from the request body. There is no role field on the DTO.
            role: Role.ADMIN,
            tokenHash: token.hash,
            expiresAt,
            consumedAt: null,
            invitedBy: actor.id,
            consumedByUserId: null,
          }),
        );
      },
      { label: 'invites.create' },
    );

    const emailDelivered = await this.sendInviteEmail(actor, invite, token.raw);

    const event: InviteIssuedEvent = {
      inviteId: invite.id,
      email: invite.email,
      actorId: actor.id,
      occurredAt: now,
      expiresAt: invite.expiresAt,
      emailDelivered,
    };
    this.events.emit(INVITE_EVENTS.CREATED, event);

    return toInviteResponse(invite, now);
  }

  /**
   * `POST /invites/:inviteId/resend` — "re-issue the token and reset the expiry"
   * (§5.3).
   *
   * A **new** token, not the old one: the original was never stored, only its
   * digest. That is a feature — the previous link stops working the moment this
   * succeeds, so a forwarded email cannot be redeemed after the admin decided to
   * send a fresh one.
   */
  async resend(actor: ICurrentUser, inviteId: string): Promise<InviteResponseDto> {
    const invite = await this.requireOpenInvite(inviteId);

    const token = issueToken();
    const now = new Date();
    const expiresAt = this.expiryFrom(now);

    await this.invites.update({ id: invite.id }, { tokenHash: token.hash, expiresAt });
    const refreshed = { ...invite, tokenHash: token.hash, expiresAt } as Invite;

    const emailDelivered = await this.sendInviteEmail(actor, refreshed, token.raw);

    const event: InviteIssuedEvent = {
      inviteId: invite.id,
      email: invite.email,
      actorId: actor.id,
      occurredAt: now,
      expiresAt,
      emailDelivered,
    };
    this.events.emit(INVITE_EVENTS.RESENT, event);

    return toInviteResponse(refreshed, now);
  }

  /**
   * `DELETE /invites/:inviteId` — revoke a pending invite (§5.3).
   *
   * Soft delete, so the row stays auditable and the derived status becomes
   * `REVOKED`. A consumed invite cannot be revoked: the admin account it produced
   * already exists, and deactivating that account is a different decision on a
   * different endpoint (A-2).
   */
  async revoke(actor: ICurrentUser, inviteId: string): Promise<InviteResponseDto> {
    const invite = await this.requireOpenInvite(inviteId);

    await this.invites.softDelete({ id: invite.id });

    const now = new Date();
    const event: InviteRevokedEvent = {
      inviteId: invite.id,
      email: invite.email,
      actorId: actor.id,
      occurredAt: now,
    };
    this.events.emit(INVITE_EVENTS.REVOKED, event);

    return toInviteResponse({ ...invite, deletedAt: now } as Invite, now);
  }

  /* -----------------------------------------------------------------------------------------
   * Public token routes
   * -------------------------------------------------------------------------------------- */

  /**
   * `GET /invites/token/:token` — validate a token for the acceptance form (§5.3).
   *
   * Read-only. It does not consume anything, so the form can be reloaded, and it
   * returns three fields chosen for what they omit (see the DTO).
   */
  async previewToken(
    rawToken: string,
    now: Date = new Date(),
  ): Promise<InviteTokenPreviewResponseDto> {
    return toInviteTokenPreview(await this.validateToken(rawToken, now));
  }

  /**
   * **The method `auth` calls.** Validates a token and burns it, atomically.
   *
   * ```ts
   * const acceptance = await runInTransaction(dataSource, async (manager) => {
   *   return invites.consumeToken(rawToken, user.id, { manager });
   *   //  → { inviteId, email, role, invitedBy, expiresAt, acceptedEvent }
   * });
   * invites.announceAccepted(acceptance.acceptedEvent);   // after the commit
   * ```
   *
   * **Nothing is emitted here.** The `INVITE_ACCEPTED` event is returned on the
   * result and the caller emits it once the transaction has committed — see
   * {@link announceAccepted}.
   *
   * `auth` must create the account for `acceptance.email` and with
   * `acceptance.role` — both read from the row, never from the request body. That is
   * what makes the emailed token, and not the caller, the thing that decides a new
   * account is an admin (S-5, S-4).
   *
   * The update carries `consumedAt IS NULL` in its WHERE clause and asserts on the
   * affected count, so two requests racing on one token cannot both succeed:
   * whichever loses sees `INVITE_ALREADY_CONSUMED`.
   *
   * @throws `TOKEN_INVALID` — malformed, or no row matches the digest.
   * @throws `INVITE_NOT_FOUND` — the row was revoked.
   * @throws `INVITE_EXPIRED` — past `expiresAt`.
   * @throws `INVITE_ALREADY_CONSUMED` — used already, or lost the race.
   */
  async consumeToken(
    rawToken: string,
    consumedByUserId: string,
    options: ConsumeInviteOptions = {},
  ): Promise<InviteAcceptance> {
    const now = options.now ?? new Date();
    const invite = await this.validateToken(rawToken, now, options.manager);

    const repository =
      options.manager === undefined ? this.invites : options.manager.getRepository(Invite);

    const outcome = await repository.update(
      { id: invite.id, consumedAt: IsNull() },
      { consumedAt: now, consumedByUserId },
    );

    if ((outcome.affected ?? 0) === 0) {
      // Someone else consumed it between the read and the write.
      throw new ConflictException(ErrorCode.INVITE_ALREADY_CONSUMED);
    }

    return {
      inviteId: invite.id,
      email: invite.email,
      role: invite.role,
      invitedBy: invite.invitedBy,
      expiresAt: invite.expiresAt,
      // Prepared, deliberately not emitted — see `announceAccepted`.
      acceptedEvent: {
        inviteId: invite.id,
        email: invite.email,
        actorId: consumedByUserId,
        occurredAt: now,
        consumedByUserId,
      },
    };
  }

  /**
   * Emits `INVITE_ACCEPTED`. **Call this after the transaction has committed.**
   *
   * `consumeToken` used to emit inline. It runs inside `auth`'s `runInTransaction`
   * block, and `EventEmitter2` has no idea a transaction exists: the audit listener
   * wrote its row the moment the token was burnt, so an account creation that failed
   * afterwards rolled the burn back and left `INVITE_ACCEPTED` in the log for an
   * acceptance that never happened. A-3's log is evidence; an entry for an event that
   * did not occur is worse than a missing one.
   *
   * Separating the two makes the ordering explicit at the call site instead of
   * implicit in this method.
   */
  announceAccepted(event: InviteAcceptedEvent): void {
    this.events.emit(INVITE_EVENTS.ACCEPTED, event);
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * Hash, look up, then check state in the §2.4 order: invalid → revoked → consumed
   * → expired.
   *
   * A token that does not match any digest is `TOKEN_INVALID`, which is the same
   * answer a forged token gets. Nothing here reveals whether an address has ever
   * been invited.
   */
  private async validateToken(
    rawToken: string,
    now: Date,
    manager?: EntityManager,
  ): Promise<Invite> {
    if (typeof rawToken !== 'string' || rawToken.length < INVITE_TOKEN_BYTES) {
      throw new ConflictException(ErrorCode.TOKEN_INVALID);
    }

    const repository = manager === undefined ? this.invites : manager.getRepository(Invite);
    const invite = await repository.findOne({
      where: { tokenHash: sha256Hex(rawToken) },
      withDeleted: true,
    });

    if (invite === null) {
      throw new NotFoundException(ErrorCode.INVITE_NOT_FOUND);
    }
    if (invite.deletedAt !== null) {
      // Revoked. Indistinguishable from "never existed", by design.
      throw new NotFoundException(ErrorCode.INVITE_NOT_FOUND);
    }
    if (invite.consumedAt !== null) {
      throw new ConflictException(ErrorCode.INVITE_ALREADY_CONSUMED);
    }
    if (invite.expiresAt.getTime() <= now.getTime()) {
      throw new ConflictException(ErrorCode.INVITE_EXPIRED);
    }

    return invite;
  }

  /** A revocable, resendable invite: exists, not consumed, not already revoked. */
  private async requireOpenInvite(inviteId: string): Promise<Invite> {
    const invite = await this.invites.findOne({ where: { id: inviteId } });

    if (invite === null) {
      throw new NotFoundException(ErrorCode.INVITE_NOT_FOUND);
    }
    if (invite.consumedAt !== null) {
      throw new ConflictException(ErrorCode.INVITE_ALREADY_CONSUMED);
    }
    return invite;
  }

  /**
   * `EMAIL_ALREADY_EXISTS` — inviting an address that already signs in would either
   * fail on the unique index at acceptance or, worse, look like a way to attach an
   * admin role to somebody's existing consumer account.
   *
   * Deactivated accounts count: they are reactivated (A-2), not re-invited.
   */
  private async assertNoActiveAccount(email: string): Promise<void> {
    const exists = await this.users.exists({
      where: { email, status: Not(UserStatus.DEACTIVATED) },
    });
    if (exists) {
      throw new ConflictException(ErrorCode.EMAIL_ALREADY_EXISTS);
    }
  }

  private expiryFrom(now: Date): Date {
    const ttlDays = this.config.get<number>('INVITE_TTL_DAYS') ?? 7;
    return new Date(now.getTime() + ttlDays * MILLISECONDS_PER_DAY);
  }

  /**
   * Sends the D-13 invitation email. Returns whether it was delivered.
   *
   * A failed send does **not** fail the request: the row is already committed, and
   * `NotificationsService` resolves rather than rejects (E-11). The admin sees the
   * invite in the list and can resend it — which is a better outcome than a 500 that
   * leaves them unsure whether an invitation exists.
   *
   * **Seam:** once `NotificationsModule`'s outbox lands (§4.32) this becomes an
   * outbox row written inside the same transaction as the invite.
   */
  private async sendInviteEmail(
    actor: ICurrentUser,
    invite: Invite,
    rawToken: string,
  ): Promise<boolean> {
    const webUrl = this.config.getOrThrow<string>('APP_WEB_URL');
    const acceptUrl = `${webUrl.replace(/\/+$/, '')}/invite/${encodeURIComponent(rawToken)}`;

    const result = await this.notifications.sendTemplatedEmail({
      to: invite.email,
      template: TemplateId.ADMIN_INVITE,
      props: { inviterName: actor.name, acceptUrl, expiresAt: invite.expiresAt },
      correlationId: invite.id,
    });

    if (!result.ok) {
      this.logger.warn(
        `Invitation email for invite ${invite.id} was not delivered ` +
          `(${result.failure?.code ?? 'UNKNOWN'}). The invite itself is committed and can be resent.`,
      );
    }
    return result.ok;
  }
}

/** A raw token and its digest. The raw value exists only long enough to be emailed. */
function issueToken(): IssuedToken {
  const raw = randomToken(INVITE_TOKEN_BYTES);
  return { raw, hash: sha256Hex(raw) };
}
