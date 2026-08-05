import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AppException,
  ErrorCode,
  Locale,
  Role,
  UserStatus,
  type ICurrentUser,
} from '@library/common';

import { buildAdminUser, buildUser } from '../../../../test/factories';
import { createInMemoryRepository, createMock } from '../../../../test/fixtures';
import { USER_EVENTS } from '../constants/user-events.constant';
import { User } from '../entities/user.entity';
import {
  createFakeEntityManager,
  createTransactionalDataSource,
  type EntityClass,
  type TransactionState,
} from '../testing/query-doubles';

import { AdminUsersService } from './admin-users.service';

import type { SessionRevocationPort } from '../interfaces/session-revocation.interface';
import type { Repository, SelectQueryBuilder } from 'typeorm';

/**
 * **PRD A-2 — admin management.**
 *
 * > "Admin management: invite by email, change role, deactivate. **Deactivation is
 * > immediate and revokes live sessions.** Accounts are deactivated, never
 * > hard-deleted."
 *
 * Three things are worth more than the happy paths here, and each has its own block:
 *
 * - **immediate** — the revocation happens inside the same transaction as the status
 *   change, so there is no window in which the account is deactivated but its
 *   session still works;
 * - **never hard-deleted** — nothing in this service removes a row;
 * - **the console cannot lock itself out** — `SELF_ROLE_CHANGE_FORBIDDEN` and
 *   `LAST_ADMIN_PROTECTED`, both counted rather than assumed.
 */
describe('AdminUsersService — A-2', () => {
  const actorId = 'a0000000-0000-4000-8000-00000000000a';
  const otherAdminId = 'a0000000-0000-4000-8000-00000000000b';
  const consumerId = 'c0000000-0000-4000-8000-00000000000c';

  let users: Repository<User> & { $rows: User[] };
  let sessions: jest.Mocked<SessionRevocationPort>;
  let events: EventEmitter2;
  let emitted: Array<{ name: string; payload: unknown }>;
  let state: TransactionState;
  let service: AdminUsersService;

  const actor: ICurrentUser = {
    id: actorId,
    role: Role.ADMIN,
    email: 'ayesha@example.invalid',
    name: 'Ayesha',
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
    phoneVerifiedAt: null,
    sessionId: '11112222-3333-4444-8555-666677778888',
    locale: Locale.EN,
  };

  /** A builder that applies the predicates the service passes, against live rows. */
  function attachBuilder(repository: Repository<User>, rows: User[]): void {
    const factory = (): SelectQueryBuilder<User> => {
      const parameters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {};

      const capture = (_condition: string, values?: Record<string, unknown>): unknown => {
        Object.assign(parameters, values ?? {});
        return builder;
      };

      Object.assign(builder, {
        alias: 'user',
        select: () => builder,
        where: capture,
        andWhere: capture,
        orderBy: () => builder,
        addOrderBy: () => builder,
        skip: () => builder,
        take: () => builder,
        getOne: () =>
          Promise.resolve(
            rows.find((row) => row.id === parameters.userId && row.deletedAt === null) ?? null,
          ),
        getManyAndCount: () => {
          const matched = rows.filter(
            (row) =>
              row.deletedAt === null &&
              (parameters.role === undefined || row.role === parameters.role) &&
              (parameters.status === undefined || row.status === parameters.status),
          );
          return Promise.resolve([matched, matched.length]);
        },
      });

      return builder as unknown as SelectQueryBuilder<User>;
    };

    (repository as unknown as Record<string, unknown>).createQueryBuilder = factory;
  }

  function seed(rows: User[]): void {
    users.$rows.length = 0;
    users.$rows.push(...rows);
  }

  beforeEach(() => {
    users = createInMemoryRepository<User>();
    attachBuilder(users, users.$rows);

    seed([
      buildAdminUser({ id: actorId, name: 'Ayesha', status: UserStatus.ACTIVE }),
      buildAdminUser({ id: otherAdminId, name: 'Bilal', status: UserStatus.ACTIVE }),
      buildUser({ id: consumerId, name: 'Consumer' }),
    ]);

    sessions = createMock<SessionRevocationPort>(['revokeAllForUser']);
    sessions.revokeAllForUser.mockResolvedValue(3);

    events = new EventEmitter2();
    emitted = [];
    events.onAny((name, payload) => emitted.push({ name: String(name), payload }));

    const transactional = createTransactionalDataSource(
      createFakeEntityManager(new Map<EntityClass, unknown>([[User, users]])),
    );
    state = transactional.state;

    service = new AdminUsersService(users, transactional.dataSource, events, sessions);
  });

  async function errorCodeOf(work: Promise<unknown>): Promise<ErrorCode | undefined> {
    try {
      await work;
      return undefined;
    } catch (error) {
      return error instanceof AppException ? error.errorCode : undefined;
    }
  }

  const listQuery = { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'DESC' as const };

  /* ---------------------------------------------------------------------------------------
   * The directory
   * ------------------------------------------------------------------------------------ */

  describe('list', () => {
    it('lists admins only', async () => {
      const page = await service.list(listQuery);

      expect(page.items.map((item) => item.id).sort()).toEqual([actorId, otherAdminId].sort());
      expect(page.items.every((item) => item.role === Role.ADMIN)).toBe(true);
    });

    it('returns the { items, meta } shape (§2.8)', async () => {
      const page = await service.list(listQuery);

      expect(page.meta).toMatchObject({ page: 1, limit: 20, total: 2, sortBy: 'createdAt' });
    });

    it('leaks no credential into the list response', async () => {
      const page = await service.list(listQuery);
      const serialised = JSON.stringify(page.items);

      expect(serialised).not.toContain('passwordHash');
      expect(serialised).not.toContain('twofaSecret');
      expect(serialised).not.toContain('twofaRecoveryCodes');
      expect(serialised).not.toContain('argon2');
      expect(Object.keys(page.items[0])).toContain('twofaEnabled');
    });
  });

  describe('findOne', () => {
    it('reports a consumer id as USER_NOT_FOUND — the directory is admins only (S-9)', async () => {
      expect(await errorCodeOf(service.findOne(consumerId))).toBe(ErrorCode.USER_NOT_FOUND);
    });

    it('reports an unknown id the same way', async () => {
      expect(await errorCodeOf(service.findOne('a0000000-0000-4000-8000-999999999999'))).toBe(
        ErrorCode.USER_NOT_FOUND,
      );
    });
  });

  /* ---------------------------------------------------------------------------------------
   * Role changes — and the escalation that must not exist
   * ------------------------------------------------------------------------------------ */

  describe('changeRole', () => {
    it('demotes an admin, revoking their sessions in the same transaction', async () => {
      await service.changeRole(actor, otherAdminId, { role: Role.CONSUMER });

      expect(users.$rows.find((row) => row.id === otherAdminId)?.role).toBe(Role.CONSUMER);
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
        otherAdminId,
        expect.objectContaining({ reason: 'ROLE_CHANGED', manager: expect.anything() }),
      );
      expect(state).toMatchObject({ started: 1, committed: 1, rolledBack: 0, released: 1 });
    });

    it('emits user.role_changed after the commit, with the session count', async () => {
      await service.changeRole(actor, otherAdminId, { role: Role.CONSUMER });

      const event = emitted.find((entry) => entry.name === USER_EVENTS.ROLE_CHANGED);
      expect(event?.payload).toMatchObject({
        userId: otherAdminId,
        actorId,
        from: Role.ADMIN,
        to: Role.CONSUMER,
        sessionsRevoked: 3,
      });
    });

    it('refuses to change your own role', async () => {
      expect(await errorCodeOf(service.changeRole(actor, actorId, { role: Role.CONSUMER }))).toBe(
        ErrorCode.SELF_ROLE_CHANGE_FORBIDDEN,
      );
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('refuses to demote the last active admin', async () => {
      users.$rows.find((row) => row.id === actorId)!.status = UserStatus.DEACTIVATED;

      expect(
        await errorCodeOf(service.changeRole(actor, otherAdminId, { role: Role.CONSUMER })),
      ).toBe(ErrorCode.LAST_ADMIN_PROTECTED);
      expect(users.$rows.find((row) => row.id === otherAdminId)?.role).toBe(Role.ADMIN);
    });

    it('cannot promote a consumer — an admin arrives by seed or invitation only (S-5)', async () => {
      const code = await errorCodeOf(service.changeRole(actor, consumerId, { role: Role.ADMIN }));

      expect(code).toBe(ErrorCode.USER_NOT_FOUND);
      expect(users.$rows.find((row) => row.id === consumerId)?.role).toBe(Role.CONSUMER);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('treats "make this admin an admin" as an accepted no-op', async () => {
      const response = await service.changeRole(actor, otherAdminId, { role: Role.ADMIN });

      expect(response.role).toBe(Role.ADMIN);
      expect(users.update).not.toHaveBeenCalled();
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  /* ---------------------------------------------------------------------------------------
   * Deactivation — immediate, and never a delete
   * ------------------------------------------------------------------------------------ */

  describe('deactivate', () => {
    it('sets the status and revokes live sessions atomically (A-2)', async () => {
      await service.deactivate(actor, otherAdminId);

      expect(users.$rows.find((row) => row.id === otherAdminId)?.status).toBe(
        UserStatus.DEACTIVATED,
      );
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
        otherAdminId,
        expect.objectContaining({ reason: 'DEACTIVATED', manager: expect.anything() }),
      );
      expect(state.committed).toBe(1);
    });

    it('never hard-deletes: the row survives, and so does its history', async () => {
      await service.deactivate(actor, otherAdminId);

      expect(users.$rows.some((row) => row.id === otherAdminId)).toBe(true);
      expect(users.delete).not.toHaveBeenCalled();
      expect(users.remove).not.toHaveBeenCalled();
      expect(users.softDelete).not.toHaveBeenCalled();
    });

    it('refuses to deactivate the last active admin', async () => {
      users.$rows.find((row) => row.id === otherAdminId)!.status = UserStatus.DEACTIVATED;

      expect(await errorCodeOf(service.deactivate(actor, actorId))).toBe(
        ErrorCode.LAST_ADMIN_PROTECTED,
      );
    });

    it('is idempotent — deactivating a deactivated account changes nothing', async () => {
      users.$rows.find((row) => row.id === otherAdminId)!.status = UserStatus.DEACTIVATED;

      const response = await service.deactivate(actor, otherAdminId);

      expect(response.status).toBe(UserStatus.DEACTIVATED);
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
      expect(state.started).toBe(0);
    });

    it('emits user.deactivated', async () => {
      await service.deactivate(actor, otherAdminId);

      expect(emitted.map((entry) => entry.name)).toContain(USER_EVENTS.DEACTIVATED);
    });
  });

  describe('reactivate', () => {
    it('restores a deactivated admin', async () => {
      users.$rows.find((row) => row.id === otherAdminId)!.status = UserStatus.DEACTIVATED;

      const response = await service.reactivate(actor, otherAdminId);

      expect(response.status).toBe(UserStatus.ACTIVE);
      expect(emitted.map((entry) => entry.name)).toContain(USER_EVENTS.REACTIVATED);
    });

    it('refuses a suspended account — lifting a hold is a different decision (A-19)', async () => {
      users.$rows.find((row) => row.id === otherAdminId)!.status = UserStatus.SUSPENDED;

      expect(await errorCodeOf(service.reactivate(actor, otherAdminId))).toBe(
        ErrorCode.RESOURCE_CONFLICT,
      );
    });
  });

  /* ---------------------------------------------------------------------------------------
   * The seam, now bound
   * ------------------------------------------------------------------------------------ */

  // `SESSION_REVOCATION` used to resolve to a no-op that revoked nothing and logged at
  // `error`. It is now bound to `auth`'s `SessionRevocationService`, and the end-to-end
  // proof that a deactivated or suspended account really does stop resolving lives in
  // `apps/api/test/integration/account-status-revocation.spec.ts` — a place where both
  // sides of the port are real objects rather than a mock of one of them.
});
