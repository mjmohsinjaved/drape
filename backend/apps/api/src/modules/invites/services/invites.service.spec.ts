import type { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AppException,
  ErrorCode,
  Role,
  sha256Hex,
  UserStatus,
  type ICurrentUser,
} from '@library/common';
import { NotificationErrorCode } from '@library/notifications';
import type { NotificationsService, SendResult } from '@library/notifications';

import { type User } from '@api/modules/users/entities/user.entity';
import {
  createFakeEntityManager,
  createTransactionalDataSource,
  type EntityClass,
  type TransactionState,
} from '@api/modules/users/testing/query-doubles';

import { buildAdminUser, buildUser } from '../../../../test/factories';
import { createInMemoryRepository, createMock } from '../../../../test/fixtures';
import { INVITE_EVENTS } from '../constants/invite-events.constant';
import { Invite } from '../entities/invite.entity';
import { deriveInviteStatus, InviteStatus } from '../enums/invite-status.enum';

import { InvitesService } from './invites.service';

import type { Repository } from 'typeorm';

/**
 * **PRD S-5 — the invite token lifecycle.**
 *
 * > "Admin accounts are created only by the deployment seed script or by invitation
 * > from an existing Admin, accepted through a **single-use emailed token**."
 *
 * Four properties carry that sentence, and each has a test below:
 *
 * - **emailed** — the raw token leaves only in the email; these tests recover it the
 *   same way the invited person does, by reading the link out of the message;
 * - **hashed at rest** — the row stores `sha256(token)` and nothing that could be
 *   replayed;
 * - **expiring** — past `expiresAt`, the token is refused;
 * - **single-use** — the second acceptance loses, including when the two race.
 */
describe('InvitesService — S-5', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  let invites: Repository<Invite> & { $rows: Invite[] };
  let users: Repository<User> & { $rows: User[] };
  let notifications: jest.Mocked<NotificationsService>;
  let events: EventEmitter2;
  let emitted: Array<{ name: string; payload: unknown }>;
  let state: TransactionState;
  let service: InvitesService;

  const actor: ICurrentUser = {
    id: 'a0000000-0000-4000-8000-00000000000a',
    role: Role.ADMIN,
    email: 'inviter@example.invalid',
    name: 'Ayesha Khan',
    status: UserStatus.ACTIVE,
    emailVerifiedAt: now,
    phoneVerifiedAt: now,
    sessionId: '11112222-3333-4444-8555-666677778888',
    locale: 'EN' as ICurrentUser['locale'],
  };

  const sent = (): SendResult => ({
    ok: true,
    channel: 'EMAIL',
    provider: 'console-email',
    messageId: 'm1',
    recipient: 'n***@example.invalid',
    attempts: 1,
    durationMs: 1,
  });

  function buildInvite(overrides: Partial<Invite> = {}): Invite {
    return Object.assign(new Invite(), {
      id: `i-${Math.random().toString(16).slice(2, 10)}`,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      email: 'new.admin@example.invalid',
      role: Role.ADMIN,
      tokenHash: sha256Hex('seed-token'),
      expiresAt: new Date(now.getTime() + SEVEN_DAYS_MS),
      consumedAt: null,
      invitedBy: actor.id,
      consumedByUserId: null,
      ...overrides,
    });
  }

  beforeEach(() => {
    invites = createInMemoryRepository<Invite>({
      // The columns PostgreSQL would default. Without them `deletedAt` is `undefined`
      // rather than `null`, and every `!== null` check in the service reads a fresh row
      // as soft-deleted — a fixture artefact that would look like a real bug.
      create: (input) =>
        Object.assign(new Invite(), { createdAt: now, updatedAt: now, deletedAt: null }, input),
    });

    users = createInMemoryRepository<User>();

    notifications = createMock<NotificationsService>(['sendTemplatedEmail']);
    notifications.sendTemplatedEmail.mockResolvedValue(sent());

    events = new EventEmitter2();
    emitted = [];
    events.onAny((name, payload) => {
      emitted.push({ name: String(name), payload });
    });

    const repositories = new Map<EntityClass, unknown>([[Invite, invites]]);
    const transactional = createTransactionalDataSource(createFakeEntityManager(repositories));
    state = transactional.state;

    const config = {
      get: jest.fn((key: string) => (key === 'INVITE_TTL_DAYS' ? 7 : undefined)),
      getOrThrow: jest.fn(() => 'https://drape.example'),
    } as unknown as ConfigService;

    service = new InvitesService(
      invites,
      users,
      transactional.dataSource,
      events,
      config,
      notifications,
    );

    jest.useFakeTimers({ now });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** The token the invited person actually receives: read out of the email, as she would. */
  function emailedToken(): string {
    const call = notifications.sendTemplatedEmail.mock.calls.at(-1)?.[0];
    const acceptUrl = (call?.props as { acceptUrl: string }).acceptUrl;
    return decodeURIComponent(acceptUrl.split('/invite/')[1]);
  }

  async function errorCodeOf(work: Promise<unknown>): Promise<ErrorCode | undefined> {
    try {
      await work;
      return undefined;
    } catch (error) {
      return error instanceof AppException ? error.errorCode : undefined;
    }
  }

  /* ---------------------------------------------------------------------------------------
   * Issue
   * ------------------------------------------------------------------------------------ */

  describe('issue', () => {
    it('emails a token and stores only its sha256 digest', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });

      const token = emailedToken();
      const row = invites.$rows[0];

      expect(token.length).toBeGreaterThanOrEqual(43);
      expect(row.tokenHash).toBe(sha256Hex(token));
      // The raw value is nowhere in the row — a database dump holds no usable invitation.
      expect(JSON.stringify(row)).not.toContain(token);
    });

    it('reads the role from S-5, not from anything a caller could send', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });

      expect(invites.$rows[0].role).toBe(Role.ADMIN);
      expect(invites.$rows[0].invitedBy).toBe(actor.id);
    });

    it('expires the invite INVITE_TTL_DAYS out', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });

      expect(invites.$rows[0].expiresAt.getTime()).toBe(now.getTime() + SEVEN_DAYS_MS);
    });

    it('commits exactly one transaction and releases the runner', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });

      expect(state).toMatchObject({ started: 1, committed: 1, rolledBack: 0, released: 1 });
    });

    it('emits invite.created without the token or its hash in the payload', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });

      const event = emitted.find((entry) => entry.name === INVITE_EVENTS.CREATED);
      expect(event).toBeDefined();
      expect(JSON.stringify(event?.payload)).not.toContain(emailedToken());
      expect(JSON.stringify(event?.payload)).not.toContain(invites.$rows[0].tokenHash);
    });

    it('never returns the token, or the hash, in the response DTO', async () => {
      const response = await service.create(actor, { email: 'new.admin@example.invalid' });

      expect(Object.keys(response)).not.toContain('token');
      expect(Object.keys(response)).not.toContain('tokenHash');
      expect(JSON.stringify(response)).not.toContain(emailedToken());
    });

    it('refuses an address that already signs in (EMAIL_ALREADY_EXISTS)', async () => {
      users.$rows.push(buildUser({ email: 'taken@example.invalid', status: UserStatus.ACTIVE }));

      const code = await errorCodeOf(service.create(actor, { email: 'taken@example.invalid' }));

      expect(code).toBe(ErrorCode.EMAIL_ALREADY_EXISTS);
      expect(invites.$rows).toHaveLength(0);
    });

    it('refuses a second open invite for the same address', async () => {
      invites.$rows.push(buildInvite({ email: 'pending@example.invalid' }));

      const code = await errorCodeOf(service.create(actor, { email: 'pending@example.invalid' }));

      expect(code).toBe(ErrorCode.RESOURCE_CONFLICT);
    });

    it('replaces a lapsed invite rather than letting it block the address for ever', async () => {
      const lapsed = buildInvite({
        email: 'lapsed@example.invalid',
        expiresAt: new Date(now.getTime() - 1000),
      });
      invites.$rows.push(lapsed);

      await service.create(actor, { email: 'lapsed@example.invalid' });

      expect(invites.$rows.find((row) => row.id === lapsed.id)?.deletedAt).not.toBeNull();
      const live = invites.$rows.filter((row) => row.deletedAt === null);
      expect(live).toHaveLength(1);
      expect(live[0].expiresAt.getTime()).toBeGreaterThan(now.getTime());
    });

    it('keeps the invite when the email fails to send — it can be resent', async () => {
      notifications.sendTemplatedEmail.mockResolvedValue({
        ...sent(),
        ok: false,
        failure: {
          code: NotificationErrorCode.NOTIFICATION_PROVIDER_UNAVAILABLE,
          message: 'provider unreachable',
          retryable: true,
        },
      });

      await expect(
        service.create(actor, { email: 'new.admin@example.invalid' }),
      ).resolves.toBeDefined();

      expect(invites.$rows).toHaveLength(1);
      const event = emitted.find((entry) => entry.name === INVITE_EVENTS.CREATED);
      expect((event?.payload as { emailDelivered: boolean }).emailDelivered).toBe(false);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * Validate
   * ------------------------------------------------------------------------------------ */

  describe('validate', () => {
    it('accepts the emailed token and returns only what the form needs', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });

      const preview = await service.previewToken(emailedToken(), now);

      expect(preview).toEqual({
        email: 'new.admin@example.invalid',
        role: Role.ADMIN,
        expiresAt: invites.$rows[0].expiresAt,
      });
      expect(Object.keys(preview)).toEqual(['email', 'role', 'expiresAt']);
    });

    it('does not consume the token, so the form can be reloaded', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });
      const token = emailedToken();

      await service.previewToken(token, now);
      await service.previewToken(token, now);

      expect(invites.$rows[0].consumedAt).toBeNull();
    });

    it('refuses an unknown token the same way it refuses a forged one', async () => {
      const code = await errorCodeOf(service.previewToken('a'.repeat(43), now));

      expect(code).toBe(ErrorCode.INVITE_NOT_FOUND);
    });

    it('refuses a malformed token before it costs a database round trip', async () => {
      const code = await errorCodeOf(service.previewToken('short', now));

      expect(code).toBe(ErrorCode.TOKEN_INVALID);
      expect(invites.findOne).not.toHaveBeenCalled();
    });

    it('refuses an expired token with INVITE_EXPIRED', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });
      const token = emailedToken();
      const afterExpiry = new Date(now.getTime() + SEVEN_DAYS_MS + 1);

      const code = await errorCodeOf(service.previewToken(token, afterExpiry));

      expect(code).toBe(ErrorCode.INVITE_EXPIRED);
    });

    it('treats a revoked invite as not found, revealing nothing about who was invited', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });
      const token = emailedToken();
      await service.revoke(actor, invites.$rows[0].id);

      const code = await errorCodeOf(service.previewToken(token, now));

      expect(code).toBe(ErrorCode.INVITE_NOT_FOUND);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * Consume — the method auth calls
   * ------------------------------------------------------------------------------------ */

  describe('consume', () => {
    const newAdminId = 'b0000000-0000-4000-8000-00000000000b';

    it('burns the token and returns the identity auth must create the account with', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });
      const token = emailedToken();

      const acceptance = await service.consumeToken(token, newAdminId, { now });

      expect(acceptance).toEqual({
        inviteId: invites.$rows[0].id,
        email: 'new.admin@example.invalid',
        role: Role.ADMIN,
        invitedBy: actor.id,
        expiresAt: invites.$rows[0].expiresAt,
        // Carried, not emitted: the caller announces it once its transaction commits.
        acceptedEvent: {
          inviteId: invites.$rows[0].id,
          email: 'new.admin@example.invalid',
          actorId: newAdminId,
          occurredAt: now,
          consumedByUserId: newAdminId,
        },
      });
      expect(invites.$rows[0].consumedAt).toEqual(now);
      expect(invites.$rows[0].consumedByUserId).toBe(newAdminId);
    });

    /**
     * `consumeToken` runs inside `auth`'s transaction, and `EventEmitter2` has no idea a
     * transaction exists. Emitting inline meant the audit listener wrote `INVITE_ACCEPTED`
     * the moment the token was burnt — so an account creation that failed a line later rolled
     * the burn back and left a permanent audit row for an acceptance that never happened.
     * A-3's log is evidence; an entry for an event that did not occur is worse than a missing
     * one. The event is now prepared here and emitted by the caller after the commit.
     */
    it('prepares invite.accepted but does not emit it — the caller does, after the commit', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });

      const acceptance = await service.consumeToken(emailedToken(), newAdminId, { now });

      expect(emitted.find((entry) => entry.name === INVITE_EVENTS.ACCEPTED)).toBeUndefined();
      expect(acceptance.acceptedEvent).toMatchObject({ consumedByUserId: newAdminId });
    });

    it('emits it when announceAccepted is called', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });
      const acceptance = await service.consumeToken(emailedToken(), newAdminId, { now });

      service.announceAccepted(acceptance.acceptedEvent);

      const event = emitted.find((entry) => entry.name === INVITE_EVENTS.ACCEPTED);
      expect(event?.payload).toMatchObject({ consumedByUserId: newAdminId });
    });

    it('rejects reuse — the token is single-use (S-5)', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });
      const token = emailedToken();

      await service.consumeToken(token, newAdminId, { now });
      const code = await errorCodeOf(service.consumeToken(token, 'someone-else', { now }));

      expect(code).toBe(ErrorCode.INVITE_ALREADY_CONSUMED);
      // The first acceptance is untouched by the second attempt.
      expect(invites.$rows[0].consumedByUserId).toBe(newAdminId);
    });

    it('rejects the loser of a race, even when both pass validation', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });
      const token = emailedToken();

      // Both requests read an unconsumed row; the UPDATE ... WHERE consumedAt IS NULL
      // is what actually decides, and one of them affects zero rows.
      const update = invites.update as jest.MockedFunction<Repository<Invite>['update']>;
      update.mockResolvedValueOnce({ affected: 0, generatedMaps: [], raw: [] });

      const code = await errorCodeOf(service.consumeToken(token, newAdminId, { now }));

      expect(code).toBe(ErrorCode.INVITE_ALREADY_CONSUMED);
    });

    it('rejects an expired token', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });
      const token = emailedToken();

      const code = await errorCodeOf(
        service.consumeToken(token, newAdminId, {
          now: new Date(now.getTime() + SEVEN_DAYS_MS + 1),
        }),
      );

      expect(code).toBe(ErrorCode.INVITE_EXPIRED);
      expect(invites.$rows[0].consumedAt).toBeNull();
    });

    it('writes through a caller-supplied manager so auth can make it atomic', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });
      const token = emailedToken();

      const managerRepository = createInMemoryRepository<Invite>({ rows: invites.$rows });
      const manager = createFakeEntityManager(
        new Map<EntityClass, unknown>([[Invite, managerRepository]]),
      );

      await service.consumeToken(token, newAdminId, { now, manager });

      expect(managerRepository.update).toHaveBeenCalled();
      // The repository the service holds directly was not used for the write.
      expect(invites.update).not.toHaveBeenCalled();
    });
  });

  /* ---------------------------------------------------------------------------------------
   * Resend and revoke
   * ------------------------------------------------------------------------------------ */

  describe('resend', () => {
    it('issues a new token and invalidates the previous link', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });
      const original = emailedToken();

      await service.resend(actor, invites.$rows[0].id);
      const replacement = emailedToken();

      expect(replacement).not.toBe(original);
      expect(await errorCodeOf(service.previewToken(original, now))).toBe(
        ErrorCode.INVITE_NOT_FOUND,
      );
      await expect(service.previewToken(replacement, now)).resolves.toBeDefined();
    });

    it('refuses to resend a consumed invite', async () => {
      invites.$rows.push(buildInvite({ consumedAt: now, consumedByUserId: 'someone' }));

      const code = await errorCodeOf(service.resend(actor, invites.$rows[0].id));

      expect(code).toBe(ErrorCode.INVITE_ALREADY_CONSUMED);
    });
  });

  describe('revoke', () => {
    it('soft-deletes so the row stays auditable and reads as REVOKED', async () => {
      invites.$rows.push(buildInvite());

      const response = await service.revoke(actor, invites.$rows[0].id);

      expect(response.status).toBe(InviteStatus.REVOKED);
      expect(invites.$rows[0].deletedAt).not.toBeNull();
      expect(emitted.map((entry) => entry.name)).toContain(INVITE_EVENTS.REVOKED);
    });

    it('refuses to revoke a consumed invite — the account already exists', async () => {
      invites.$rows.push(buildInvite({ consumedAt: now }));

      const code = await errorCodeOf(service.revoke(actor, invites.$rows[0].id));

      expect(code).toBe(ErrorCode.INVITE_ALREADY_CONSUMED);
    });

    it('reports an unknown id as INVITE_NOT_FOUND', async () => {
      const code = await errorCodeOf(service.revoke(actor, 'nope'));

      expect(code).toBe(ErrorCode.INVITE_NOT_FOUND);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * Derived status (§4.9 — there is no status column)
   * ------------------------------------------------------------------------------------ */

  describe('deriveInviteStatus', () => {
    const future = new Date(now.getTime() + 1000);
    const past = new Date(now.getTime() - 1000);

    it('reads an open invite as PENDING', () => {
      expect(
        deriveInviteStatus({ consumedAt: null, expiresAt: future, deletedAt: null }, now),
      ).toBe(InviteStatus.PENDING);
    });

    it('reads a used invite as CONSUMED, for ever — expiry does not undo acceptance', () => {
      expect(deriveInviteStatus({ consumedAt: past, expiresAt: past, deletedAt: null }, now)).toBe(
        InviteStatus.CONSUMED,
      );
    });

    it('reads a lapsed invite as EXPIRED', () => {
      expect(deriveInviteStatus({ consumedAt: null, expiresAt: past, deletedAt: null }, now)).toBe(
        InviteStatus.EXPIRED,
      );
    });

    it("reads a revoked invite as REVOKED — an admin's decision outranks the clock", () => {
      expect(deriveInviteStatus({ consumedAt: past, expiresAt: past, deletedAt: past }, now)).toBe(
        InviteStatus.REVOKED,
      );
    });
  });

  /* ---------------------------------------------------------------------------------------
   * No escalation path
   * ------------------------------------------------------------------------------------ */

  describe('no code path escalates a role (S-4, S-5)', () => {
    it('creates no users row — this module cannot make an account', async () => {
      await service.create(actor, { email: 'new.admin@example.invalid' });
      await service.consumeToken(emailedToken(), 'b0000000-0000-4000-8000-00000000000b', { now });

      expect(users.save).not.toHaveBeenCalled();
      expect(users.insert).not.toHaveBeenCalled();
      expect(users.update).not.toHaveBeenCalled();
      expect(users.$rows).toHaveLength(0);
    });

    it('ignores an unexpected role on the payload object entirely', async () => {
      const smuggled = { email: 'new.admin@example.invalid', role: 'SUPERUSER' };

      await service.create(actor, smuggled);

      expect(invites.$rows[0].role).toBe(Role.ADMIN);
    });

    it('gives auth the invited address, so the account cannot be created for another one', async () => {
      users.$rows.push(buildAdminUser({ email: 'attacker@example.invalid' }));
      await service.create(actor, { email: 'new.admin@example.invalid' });

      const acceptance = await service.consumeToken(emailedToken(), 'b-id', { now });

      expect(acceptance.email).toBe('new.admin@example.invalid');
    });
  });
});
