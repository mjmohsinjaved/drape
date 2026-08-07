import type { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AppException,
  ErrorCode,
  Role,
  UserStatus,
  type ICurrentUser,
  type SessionResolutionContext,
} from '@library/common';
import type { NotificationsService } from '@library/notifications';
import type { SignedUrlService } from '@library/storage';

import { Session } from '@api/modules/auth/entities/session.entity';
import { CsrfService } from '@api/modules/auth/services/csrf.service';
import { SessionResolverService } from '@api/modules/auth/services/session-resolver.service';
import { SessionRevocationService } from '@api/modules/auth/services/session-revocation.service';
import { SessionService } from '@api/modules/auth/services/session.service';
import { testAuthConfig } from '@api/modules/auth/testing/auth-fixtures';
import { type ConsumerProfile } from '@api/modules/users/entities/consumer-profile.entity';
import { User } from '@api/modules/users/entities/user.entity';
import { AdminConsumersService } from '@api/modules/users/services/admin-consumers.service';
import { AdminUsersService } from '@api/modules/users/services/admin-users.service';
import type { ConsumerQueryService } from '@api/modules/users/services/consumer-query.service';
import { UserDirectoryService } from '@api/modules/users/services/user-directory.service';
import { createTransactionalDataSource } from '@api/modules/users/testing/query-doubles';

import { buildAdminUser, buildUser } from '../factories';
import { createInMemoryRepository, createMock, type InMemoryRepository } from '../fixtures';

import type { EntityManager, SelectQueryBuilder } from 'typeorm';

/**
 * **PRD A-2 and A-19, end to end across the `users`/`auth` seam.**
 *
 * > A-2: "Deactivation is immediate and revokes live sessions."
 * > A-19: "Suspend an account with a required reason." — §2.7: "Deactivating or
 * > suspending a user sets `revokedAt` on every `sessions` row for that user; guard 3
 * > rejects on their next request, so revocation is immediate."
 *
 * Every other test of this behaviour mocks one side of it. `admin-users.service.spec.ts`
 * asserts that `SESSION_REVOCATION.revokeAllForUser` was *called*; `session.service.spec.ts`
 * asserts that `SessionService` revokes rows when *asked*. Neither would have noticed
 * that the token was bound to a no-op which revoked nothing, logged at `error` and
 * returned `0` — the exact state this codebase was in.
 *
 * So nothing here is a mock of the path under test. `AdminUsersService` and
 * `AdminConsumersService` are the real services, they hold the real
 * `SessionRevocationService`, which holds the real `SessionService`, which writes to
 * the same in-memory `sessions` rows the real `SessionResolverService` then reads.
 * The chain runs from "an admin clicked deactivate" to "guard 3 refuses the cookie".
 *
 * The distinction the assertions turn on: after a status change, `SessionResolverService`
 * declines with **`SESSION_INVALID`**, not `ACCOUNT_DEACTIVATED`. Its checks run in the
 * §2.7 order — revoked before status — so `SESSION_INVALID` is reachable *only* if
 * `revokedAt` was actually written. A test that accepted either code would still pass
 * against a no-op revoker.
 */
describe('A-2 / A-19 — a status change revokes live sessions immediately', () => {
  const actorId = 'a0000000-0000-4000-8000-00000000000a';

  const actor: ICurrentUser = {
    id: actorId,
    role: Role.ADMIN,
    email: 'ayesha@example.invalid',
    name: 'Ayesha',
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
    phoneVerifiedAt: null,
    sessionId: '11112222-3333-4444-8555-666677778888',
    locale: 'EN' as ICurrentUser['locale'],
  };

  /** A protected route: the resolver must throw rather than resolve to nobody (§2.6). */
  const PROTECTED: SessionResolutionContext = {
    ip: '203.0.113.7',
    userAgent: 'jest/drape-test',
    method: 'GET',
    path: '/api/v1/me',
    isPublicRoute: false,
  };

  let users: InMemoryRepository<User>;
  let sessions: InMemoryRepository<Session>;
  let sessionService: SessionService;
  let resolver: SessionResolverService;
  let revocation: SessionRevocationService;
  /** Entities the services asked the *transactional* manager for, in order. */
  let managerLookups: string[];

  beforeEach(() => {
    users = createInMemoryRepository<User>();
    sessions = createInMemoryRepository<Session>();

    const config = testAuthConfig();
    sessionService = new SessionService(sessions, config, new CsrfService(config));
    revocation = new SessionRevocationService(sessionService);
    resolver = new SessionResolverService(sessionService, new UserDirectoryService(users));

    managerLookups = [];
  });

  /**
   * A manager that resolves to the same rows the services hold outside the
   * transaction — and records what it was asked for, which is how "the caller's
   * manager was used" becomes assertable rather than assumed.
   */
  function transactionalManager(): EntityManager {
    const repositories = new Map<unknown, unknown>([
      [User, users],
      [Session, sessions],
    ]);

    return {
      getRepository: (entity: { name: string }): unknown => {
        managerLookups.push(entity.name);
        const repository = repositories.get(entity);
        if (repository === undefined) {
          throw new Error(`No repository double registered for ${entity.name}.`);
        }
        return repository;
      },
    } as unknown as EntityManager;
  }

  /** The admin-directory query builder `AdminUsersService` uses for its reads. */
  function attachAdminBuilder(): void {
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
        getOne: () =>
          Promise.resolve(
            users.$rows.find((row) => row.id === parameters.userId && row.deletedAt === null) ??
              null,
          ),
      });

      return builder as unknown as SelectQueryBuilder<User>;
    };

    (users as unknown as Record<string, unknown>).createQueryBuilder = factory;
  }

  /** Mints a real session row for `user` and returns the opaque cookie value. */
  async function signIn(user: User): Promise<string> {
    const issued = await sessionService.issue({
      user: { id: user.id, role: user.role },
      ip: '203.0.113.7',
      userAgent: 'jest/drape-test',
      now: new Date(),
    });
    return issued.token;
  }

  async function declineCodeFor(token: string): Promise<ErrorCode | undefined> {
    try {
      await resolver.resolve(token, PROTECTED);
      return undefined;
    } catch (error) {
      return error instanceof AppException ? error.errorCode : undefined;
    }
  }

  /* ---------------------------------------------------------------------------------------
   * A-2 — deactivating an admin
   * ------------------------------------------------------------------------------------ */

  describe('A-2 — deactivating an admin account', () => {
    let service: AdminUsersService;
    let state: { started: number; committed: number; rolledBack: number };
    let target: User;

    beforeEach(() => {
      target = buildAdminUser({ status: UserStatus.ACTIVE });
      users.$seed([
        buildAdminUser({ id: actorId, status: UserStatus.ACTIVE }),
        target,
        // A second live admin, so `LAST_ADMIN_PROTECTED` does not fire.
        buildAdminUser({ status: UserStatus.ACTIVE }),
      ]);
      attachAdminBuilder();

      const transactional = createTransactionalDataSource(transactionalManager());
      state = transactional.state;

      service = new AdminUsersService(
        users,
        transactional.dataSource,
        new EventEmitter2(),
        revocation,
      );
    });

    it('a live cookie resolves before the deactivation', async () => {
      const token = await signIn(target);

      await expect(resolver.resolve(token, PROTECTED)).resolves.toMatchObject({
        id: target.id,
        role: Role.ADMIN,
      });
    });

    it('stops resolving the moment the account is deactivated', async () => {
      const token = await signIn(target);

      await service.deactivate(actor, target.id);

      // SESSION_INVALID, not ACCOUNT_DEACTIVATED: the resolver checks `revokedAt`
      // first, so this code is only reachable because the row really was revoked.
      expect(await declineCodeFor(token)).toBe(ErrorCode.SESSION_INVALID);
    });

    it('revokes every device, not just the one that was last used', async () => {
      const tokens = [await signIn(target), await signIn(target), await signIn(target)];

      await service.deactivate(actor, target.id);

      for (const token of tokens) {
        expect(await declineCodeFor(token)).toBe(ErrorCode.SESSION_INVALID);
      }
      expect(sessions.$rows.filter((row) => row.revokedAt !== null)).toHaveLength(3);
    });

    it('stamps the §4.5 reason on the revoked rows', async () => {
      await signIn(target);

      await service.deactivate(actor, target.id);

      expect(sessions.$rows.every((row) => row.revokedReason === 'DEACTIVATED')).toBe(true);
    });

    it('does the status change and the revocation in ONE transaction (§2.9 rule 3)', async () => {
      await signIn(target);

      await service.deactivate(actor, target.id);

      expect(state.started).toBe(1);
      expect(state.committed).toBe(1);
      expect(state.rolledBack).toBe(0);
      // Both tables were reached through the transactional manager. `Session` appearing
      // here is the proof that `RevokeSessionsOptions.manager` was honoured rather than
      // dropped — without it the revocation would have run on the pool connection,
      // outside the unit of work the status change commits in.
      expect(managerLookups).toContain('User');
      expect(managerLookups).toContain('Session');
    });

    it('leaves every other account signed in', async () => {
      const bystander = users.$rows[2];
      const bystanderToken = await signIn(bystander);
      await signIn(target);

      await service.deactivate(actor, target.id);

      await expect(resolver.resolve(bystanderToken, PROTECTED)).resolves.toMatchObject({
        id: bystander.id,
      });
    });
  });

  /* ---------------------------------------------------------------------------------------
   * A-19 — suspending a consumer
   * ------------------------------------------------------------------------------------ */

  describe('A-19 — suspending a consumer account', () => {
    let service: AdminConsumersService;
    let state: { started: number; committed: number; rolledBack: number };
    let target: User;

    beforeEach(() => {
      target = buildUser({ status: UserStatus.ACTIVE });
      users.$seed([target]);

      const consumerQuery = createMock<ConsumerQueryService>([
        'findConsumer',
        'findConsumerDetail',
      ]);
      consumerQuery.findConsumer.mockImplementation((userId: string) =>
        Promise.resolve(users.$rows.find((row) => row.id === userId) ?? null),
      );
      // `suspend` ends by re-reading the detail projection for its response. That
      // response shape is `admin-consumers.service.spec.ts`'s subject, not this
      // file's, so this returns the minimum the mapper needs and nothing more.
      consumerQuery.findConsumerDetail.mockImplementation((userId: string) => {
        const user = users.$rows.find((row) => row.id === userId);
        return Promise.resolve(
          user === undefined
            ? null
            : {
                user,
                profile: null,
                aggregates: { generationsThisMonth: 0, shortlistSize: 0, enquiryCount: 0 },
                enquiries: [],
              },
        );
      });

      // A-19 emails the consumer that her account is on hold. `NotificationsService`
      // never rejects (E-11), so the double resolves to a successful `SendResult`.
      const notifications = createMock<NotificationsService>(['sendTemplatedEmail']);
      notifications.sendTemplatedEmail.mockResolvedValue({
        ok: true,
        channel: 'EMAIL',
        provider: 'test-email',
        messageId: null,
        recipient: 'c***@example.invalid',
        attempts: 1,
        durationMs: 0,
      });

      const transactional = createTransactionalDataSource(transactionalManager());
      state = transactional.state;

      service = new AdminConsumersService(
        users,
        createInMemoryRepository<ConsumerProfile>(),
        consumerQuery,
        transactional.dataSource,
        new EventEmitter2(),
        {
          get: jest.fn(() => 24),
          getOrThrow: jest.fn(() => 'https://drape.example'),
        } as unknown as ConfigService,
        createMock<SignedUrlService>(['issueUrl']),
        notifications,
        revocation,
      );
    });

    it('stops resolving the moment the account is suspended', async () => {
      const token = await signIn(target);
      await expect(resolver.resolve(token, PROTECTED)).resolves.toMatchObject({ id: target.id });

      await suspend(service, target.id);

      expect(await declineCodeFor(token)).toBe(ErrorCode.SESSION_INVALID);
    });

    it('stamps SUSPENDED as the §4.5 reason, and records the A-19 reason on the account', async () => {
      await signIn(target);

      await suspend(service, target.id);

      expect(sessions.$rows.every((row) => row.revokedReason === 'SUSPENDED')).toBe(true);
      expect(users.$rows[0].status).toBe(UserStatus.SUSPENDED);
      expect(users.$rows[0].suspendedReason).toBe('Repeated uploads failing moderation.');
    });

    it('does the status change and the revocation in ONE transaction (§2.9 rule 3)', async () => {
      await signIn(target);

      await suspend(service, target.id);

      expect(state.started).toBe(1);
      expect(state.committed).toBe(1);
      expect(state.rolledBack).toBe(0);
      expect(managerLookups).toContain('User');
      expect(managerLookups).toContain('Session');
    });

    it('a session minted after the suspension does not resolve either', async () => {
      await suspend(service, target.id);

      // Nothing revoked it — it is newer than the revocation — so the resolver falls
      // through to the status check, which is the other half of §2.7 step 3.
      const token = await signIn(users.$rows[0]);

      expect(await declineCodeFor(token)).toBe(ErrorCode.ACCOUNT_SUSPENDED);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * The port itself
   * ------------------------------------------------------------------------------------ */

  describe('SessionRevocationService — the SESSION_REVOCATION contract', () => {
    it('reports how many sessions it revoked', async () => {
      const user = buildUser();
      users.$seed([user]);
      await signIn(user);
      await signIn(user);

      await expect(revocation.revokeAllForUser(user.id, { reason: 'DEACTIVATED' })).resolves.toBe(
        2,
      );
    });

    it('honours exceptSessionId, so an admin acting on themselves stays signed in', async () => {
      const user = buildAdminUser();
      users.$seed([user]);
      const keptToken = await signIn(user);
      await signIn(user);
      const kept = await sessionService.findByToken(keptToken);

      const revoked = await revocation.revokeAllForUser(user.id, {
        reason: 'ROLE_CHANGED',
        exceptSessionId: kept?.id,
      });

      expect(revoked).toBe(1);
      await expect(resolver.resolve(keptToken, PROTECTED)).resolves.toMatchObject({ id: user.id });
    });

    it('maps every port reason onto a §4.5 revokedReason value', async () => {
      const declared = ['ROLE_CHANGED', 'DEACTIVATED', 'SUSPENDED', 'DELETION_REQUESTED'] as const;
      const permitted = new Set([
        'LOGOUT',
        'LOGOUT_ALL',
        'PASSWORD_CHANGED',
        'DEACTIVATED',
        'SUSPENDED',
        'ADMIN_REVOKED',
      ]);

      for (const reason of declared) {
        const user = buildUser();
        users.$seed([user]);
        await signIn(user);

        await revocation.revokeAllForUser(user.id, { reason });

        const revoked = sessions.$rows.filter((row) => row.userId === user.id);
        expect(revoked).not.toHaveLength(0);
        for (const row of revoked) {
          expect(permitted.has(String(row.revokedReason))).toBe(true);
        }
      }
    });
  });

  function suspend(service: AdminConsumersService, userId: string): Promise<unknown> {
    return service.suspend(actor, userId, {
      reason: 'Repeated uploads failing moderation.',
    });
  }
});
