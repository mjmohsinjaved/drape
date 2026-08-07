import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository, type EntityManager } from 'typeorm';

import {
  ConflictException,
  ErrorCode,
  ForbiddenException,
  NotFoundException,
  isAdmin,
  Role,
  UserStatus,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';
import { paginate, runInTransaction } from '@library/database';

import {
  USER_EVENTS,
  type UserRoleChangedEvent,
  type UserStatusChangedEvent,
} from '../constants/user-events.constant';
import { AdminUserResponseDto } from '../dto/admin-user-response.dto';
import { User } from '../entities/user.entity';
import {
  SESSION_REVOCATION,
  type SessionRevocationPort,
} from '../interfaces/session-revocation.interface';
import { toAdminUserResponse } from '../mappers/user.mapper';

import type { AdminUserQueryDto } from '../dto/admin-user-query.dto';
import type { ChangeUserRoleDto } from '../dto/change-user-role.dto';

/**
 * `users` columns an admin-directory query reads.
 *
 * An allow-list, not a convenience: `passwordHash` is never selected, so no mapper,
 * log line or debugger session in this code path can reach it.
 */
export const ADMIN_USER_COLUMNS = [
  'id',
  'name',
  'email',
  'role',
  'status',
  'locale',
  'emailVerifiedAt',
  'lastLoginAt',
  'lastActiveAt',
  'suspendedAt',
  'invitedBy',
  'createdAt',
] as const;

/**
 * Admin account management — PRD A-2, ARCHITECTURE §5.2.
 *
 * > "Admin management: invite by email, change role, deactivate. Deactivation is
 * > immediate and revokes live sessions. Accounts are deactivated, never
 * > hard-deleted."
 *
 * Three invariants run through every method:
 *
 * 1. **Nothing is hard-deleted.** There is no `remove()` in this file. An admin who
 *    leaves is `DEACTIVATED`, so the audit trail, the invites they sent and the
 *    enquiries they answered all still resolve to a name.
 * 2. **Revocation is immediate.** A status change and the matching session
 *    revocation happen in one transaction (§2.9 rule 3) through the
 *    {@link SESSION_REVOCATION} port; guard 3 then rejects that account's next
 *    request (§2.7).
 * 3. **This service cannot create an admin.** S-5 permits exactly two origins — the
 *    deployment seed and an accepted invitation. `changeRole` will not promote a
 *    consumer, whatever the payload asks for.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
    @Inject(SESSION_REVOCATION) private readonly sessions: SessionRevocationPort,
  ) {}

  /** `GET /admin/users` — the admin directory (A-2). */
  async list(query: AdminUserQueryDto): Promise<IPaginated<AdminUserResponseDto>> {
    const qb = this.users
      .createQueryBuilder('user')
      .select(ADMIN_USER_COLUMNS.map((column) => `user.${column}`))
      .where('user.role = :role', { role: Role.ADMIN })
      .andWhere('user.deletedAt IS NULL');

    if (query.status !== undefined) {
      qb.andWhere('user.status = :status', { status: query.status });
    }
    if (query.search !== undefined) {
      qb.andWhere('(user.name ILIKE :search OR user.email ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    const page = await paginate(qb, query, {
      sortableColumns: ['createdAt', 'lastActiveAt', 'lastLoginAt', 'name', 'email', 'status'],
      alias: 'user',
    });

    return { items: page.items.map(toAdminUserResponse), meta: page.meta };
  }

  /** `GET /admin/users/:userId`. */
  async findOne(userId: string): Promise<AdminUserResponseDto> {
    return toAdminUserResponse(await this.requireAdmin(userId));
  }

  /**
   * `PATCH /admin/users/:userId/role` (A-2).
   *
   * The only transition this endpoint performs is `ADMIN → CONSUMER`. Asking for
   * `ADMIN` on an account that already holds it is an accepted no-op; asking to
   * promote anyone is impossible, because a target that is not already an admin is
   * not addressable here at all (S-5).
   *
   * Two refusals guard the console against locking itself out:
   * `SELF_ROLE_CHANGE_FORBIDDEN` and `LAST_ADMIN_PROTECTED`.
   */
  async changeRole(
    actor: ICurrentUser,
    userId: string,
    dto: ChangeUserRoleDto,
  ): Promise<AdminUserResponseDto> {
    const target = await this.requireAdmin(userId);

    if (isAdmin(dto.role)) {
      return toAdminUserResponse(target);
    }

    if (target.id === actor.id) {
      throw new ForbiddenException(ErrorCode.SELF_ROLE_CHANGE_FORBIDDEN);
    }

    await this.assertNotLastActiveAdmin(target);

    // Captured **before** the write: the loaded entity is the ORM's identity-mapped row,
    // so reading `target.role` afterwards can return the value we just set. An event
    // that reports `from: CONSUMER, to: CONSUMER` is an audit trail that says nothing.
    const previousRole = target.role;

    const sessionsRevoked = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<number> => {
        await manager.getRepository(User).update({ id: target.id }, { role: dto.role });
        // A demoted admin must not keep an admin-shaped session (S-7 durations differ too).
        return this.sessions.revokeAllForUser(target.id, { manager, reason: 'ROLE_CHANGED' });
      },
      { label: 'users.changeRole' },
    );

    const event: UserRoleChangedEvent = {
      userId: target.id,
      actorId: actor.id,
      occurredAt: new Date(),
      from: previousRole,
      to: dto.role,
      sessionsRevoked,
    };
    this.events.emit(USER_EVENTS.ROLE_CHANGED, event);

    return toAdminUserResponse(await this.requireUser(target.id));
  }

  /**
   * `POST /admin/users/:userId/deactivate` (A-2).
   *
   * Idempotent: deactivating an already-deactivated account returns it unchanged
   * rather than raising, because the console's intent — "this person should not be
   * able to sign in" — is already satisfied.
   */
  async deactivate(actor: ICurrentUser, userId: string): Promise<AdminUserResponseDto> {
    const target = await this.requireAdmin(userId);

    if (target.status === UserStatus.DEACTIVATED) {
      return toAdminUserResponse(target);
    }

    await this.assertNotLastActiveAdmin(target);

    // Captured before the write — see the note in `changeRole`.
    const previousStatus = target.status;

    const sessionsRevoked = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<number> => {
        await manager
          .getRepository(User)
          .update({ id: target.id }, { status: UserStatus.DEACTIVATED });
        return this.sessions.revokeAllForUser(target.id, { manager, reason: 'DEACTIVATED' });
      },
      { label: 'users.deactivate' },
    );

    this.emitStatusChange(USER_EVENTS.DEACTIVATED, {
      target,
      actor,
      from: previousStatus,
      to: UserStatus.DEACTIVATED,
      reason: null,
      sessionsRevoked,
    });

    return toAdminUserResponse(await this.requireUser(target.id));
  }

  /**
   * `POST /admin/users/:userId/reactivate`.
   *
   * Only from `DEACTIVATED`. Lifting a **suspension** is a different decision with a
   * different audit trail (A-19), so it has its own endpoint and this one refuses.
   */
  async reactivate(actor: ICurrentUser, userId: string): Promise<AdminUserResponseDto> {
    const target = await this.requireAdmin(userId);

    if (target.status === UserStatus.ACTIVE) {
      return toAdminUserResponse(target);
    }

    if (target.status !== UserStatus.DEACTIVATED) {
      throw new ConflictException(ErrorCode.RESOURCE_CONFLICT, {
        message: 'This account is suspended. Lift the suspension instead.',
      });
    }

    const previousStatus = target.status;
    await this.users.update({ id: target.id }, { status: UserStatus.ACTIVE });

    this.emitStatusChange(USER_EVENTS.REACTIVATED, {
      target,
      actor,
      from: previousStatus,
      to: UserStatus.ACTIVE,
      reason: null,
      sessionsRevoked: 0,
    });

    return toAdminUserResponse(await this.requireUser(target.id));
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * Loads an admin account or refuses.
   *
   * A consumer id reaching an `/admin/users/**` route gets `USER_NOT_FOUND`, not a
   * 403: the admin directory should not confirm the existence of accounts outside
   * it, and the consumer routes are where a consumer is addressable (S-9).
   */
  private async requireAdmin(userId: string): Promise<User> {
    const user = await this.selectUser(userId);
    if (user === null || !isAdmin(user.role)) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }
    return user;
  }

  /** Re-reads a row after a write. Role may have changed, so this does not re-assert it. */
  private async requireUser(userId: string): Promise<User> {
    const user = await this.selectUser(userId);
    if (user === null) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }
    return user;
  }

  private selectUser(userId: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .select(ADMIN_USER_COLUMNS.map((column) => `user.${column}`))
      .where('user.id = :userId', { userId })
      .andWhere('user.deletedAt IS NULL')
      .getOne();
  }

  /**
   * `LAST_ADMIN_PROTECTED` — "at least one admin must stay active."
   *
   * Counted rather than assumed. The check only bites when the target is currently
   * active; demoting an already-deactivated admin cannot reduce the live count.
   */
  private async assertNotLastActiveAdmin(target: User): Promise<void> {
    if (target.status !== UserStatus.ACTIVE) {
      return;
    }

    const activeAdmins = await this.users.count({
      where: { role: Role.ADMIN, status: UserStatus.ACTIVE },
    });

    if (activeAdmins <= 1) {
      throw new ConflictException(ErrorCode.LAST_ADMIN_PROTECTED);
    }
  }

  /** `from` is passed in rather than read off `target`, which the write may already have moved. */
  private emitStatusChange(
    name: string,
    change: {
      target: User;
      actor: ICurrentUser;
      from: UserStatus;
      to: UserStatus;
      reason: string | null;
      sessionsRevoked: number;
    },
  ): void {
    const event: UserStatusChangedEvent = {
      userId: change.target.id,
      actorId: change.actor.id,
      occurredAt: new Date(),
      from: change.from,
      to: change.to,
      reason: change.reason,
      sessionsRevoked: change.sessionsRevoked,
    };
    this.events.emit(name, event);
  }
}
