import type { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AppException,
  ErrorCode,
  Locale,
  Role,
  UserStatus,
  type ICurrentUser,
} from '@library/common';
import { NotificationErrorCode, TemplateId } from '@library/notifications';
import type { NotificationsService, SendResult } from '@library/notifications';
import type { SignedUrlService } from '@library/storage';

import { DeletionLogEntry } from '@api/modules/retention/entities/deletion-log-entry.entity';
import { DeletionInitiator } from '@api/modules/retention/enums/deletion-initiator.enum';
import { DeletionSubject } from '@api/modules/retention/enums/deletion-subject.enum';

import { buildUser } from '../../../../test/factories';
import { createInMemoryRepository, createMock } from '../../../../test/fixtures';
import { USER_EVENTS } from '../constants/user-events.constant';
import { ConsumerProfile } from '../entities/consumer-profile.entity';
import { User } from '../entities/user.entity';
import {
  createFakeEntityManager,
  createTransactionalDataSource,
  type EntityClass,
  type TransactionState,
} from '../testing/query-doubles';

import { AdminConsumersService } from './admin-consumers.service';
import { type ConsumerQueryService } from './consumer-query.service';

import type { ConsumerDetailRow } from '../interfaces/consumer-rows.interface';
import type { SessionRevocationPort } from '../interfaces/session-revocation.interface';
import type { Repository } from 'typeorm';

/**
 * Consumer management — PRD A-16 … A-20.
 *
 * The S-10 assertions here are the **outward** half of the pair: the query-layer
 * spec proves the database is never asked for a photo, and this one proves nothing
 * photo-shaped can appear in a serialised admin response either — including the
 * storage keys that renders legitimately need internally in order to be signed.
 */
describe('AdminConsumersService — A-16 … A-20', () => {
  const adminId = 'a0000000-0000-4000-8000-00000000000a';
  const consumerId = 'c0000000-0000-4000-8000-00000000000c';
  const now = new Date('2026-08-15T12:00:00.000Z');

  let users: Repository<User> & { $rows: User[] };
  let profiles: Repository<ConsumerProfile> & { $rows: ConsumerProfile[] };
  let deletionLog: Repository<DeletionLogEntry> & { $rows: DeletionLogEntry[] };
  let consumerQuery: jest.Mocked<ConsumerQueryService>;
  let signedUrls: jest.Mocked<SignedUrlService>;
  let notifications: jest.Mocked<NotificationsService>;
  let sessions: jest.Mocked<SessionRevocationPort>;
  let events: EventEmitter2;
  let emitted: Array<{ name: string; payload: unknown }>;
  let state: TransactionState;
  let service: AdminConsumersService;

  const actor: ICurrentUser = {
    id: adminId,
    role: Role.ADMIN,
    email: 'admin@example.invalid',
    name: 'Ayesha',
    status: UserStatus.ACTIVE,
    emailVerifiedAt: now,
    phoneVerifiedAt: now,
    sessionId: '11112222-3333-4444-8555-666677778888',
    locale: Locale.EN,
  };

  const sent = (): SendResult => ({
    ok: true,
    channel: 'EMAIL',
    provider: 'console-email',
    messageId: 'm1',
    recipient: 'f***@example.invalid',
    attempts: 1,
    durationMs: 1,
  });

  function consumerRow(overrides: Partial<User> = {}): User {
    return buildUser({
      id: consumerId,
      name: 'Farida Iqbal',
      email: 'farida@example.invalid',
      phone: '+923001234567',
      status: UserStatus.ACTIVE,
      ...overrides,
    });
  }

  function detailRow(user: User): ConsumerDetailRow {
    return {
      user,
      profile: null,
      aggregates: { generationsThisMonth: 4, shortlistSize: 7, enquiryCount: 2 },
      enquiries: [
        {
          id: 'e1',
          reference: 'ENQ-2026-000137',
          status: 'NEW',
          createdAt: now,
          firstRespondedAt: null,
          closedAt: null,
          totalValueSnapshot: 370000,
        },
      ],
    };
  }

  const pageMeta = {
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
    sortBy: 'createdAt',
    sortOrder: 'DESC' as const,
  };

  beforeEach(() => {
    users = createInMemoryRepository<User>({ rows: [consumerRow()] });
    profiles = createInMemoryRepository<ConsumerProfile>({
      create: (input) => Object.assign(new ConsumerProfile(), { deletedAt: null }, input),
    });
    deletionLog = createInMemoryRepository<DeletionLogEntry>({
      create: (input) => Object.assign(new DeletionLogEntry(), input),
    });

    consumerQuery = createMock<ConsumerQueryService>([
      'listConsumers',
      'findConsumerDetail',
      'findConsumer',
      'findProfile',
      'listEnquirySummaries',
      'listEnquiryLinkedRenders',
      'listShortlist',
      'aggregatesFor',
    ]);
    consumerQuery.findConsumer.mockImplementation((userId: string) =>
      Promise.resolve(users.$rows.find((row) => row.id === userId) ?? null),
    );
    consumerQuery.findConsumerDetail.mockImplementation((userId: string) => {
      const user = users.$rows.find((row) => row.id === userId);
      return Promise.resolve(user === undefined ? null : detailRow(user));
    });

    signedUrls = createMock<SignedUrlService>(['issueUrl']);
    signedUrls.issueUrl.mockImplementation(
      (_key: string, options?: { subject?: string }) =>
        `https://api.test/api/v1/files/signed-for-${options?.subject ?? 'nobody'}`,
    );

    notifications = createMock<NotificationsService>(['sendTemplatedEmail']);
    notifications.sendTemplatedEmail.mockResolvedValue(sent());

    sessions = createMock<SessionRevocationPort>(['revokeAllForUser']);
    sessions.revokeAllForUser.mockResolvedValue(2);

    events = new EventEmitter2();
    emitted = [];
    events.onAny((name, payload) => emitted.push({ name: String(name), payload }));

    const transactional = createTransactionalDataSource(
      createFakeEntityManager(
        new Map<EntityClass, unknown>([
          [User, users],
          [ConsumerProfile, profiles],
          [DeletionLogEntry, deletionLog],
        ]),
      ),
    );
    state = transactional.state;

    const config = {
      get: jest.fn((key: string) => (key === 'DELETION_SLA_HOURS' ? 24 : undefined)),
      getOrThrow: jest.fn(() => 'https://drape.example'),
    } as unknown as ConfigService;

    service = new AdminConsumersService(
      users,
      profiles,
      consumerQuery,
      transactional.dataSource,
      events,
      config,
      signedUrls,
      notifications,
      sessions,
    );

    jest.useFakeTimers({ now });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function errorCodeOf(work: Promise<unknown>): Promise<ErrorCode | undefined> {
    try {
      await work;
      return undefined;
    } catch (error) {
      return error instanceof AppException ? error.errorCode : undefined;
    }
  }

  /* ---------------------------------------------------------------------------------------
   * S-10 — the serialised response
   * ------------------------------------------------------------------------------------ */

  describe('consumer detail (A-17, S-10)', () => {
    it('carries no photo field and no storage key of any kind', async () => {
      const detail = await service.findOne(consumerId);
      const serialised = JSON.stringify(detail);

      expect(Object.keys(detail)).not.toContain('photo');
      expect(Object.keys(detail)).not.toContain('personPhoto');
      expect(Object.keys(detail)).not.toContain('photos');
      expect(serialised).not.toContain('person-photos/');
      expect(serialised).not.toContain('storageKey');
      expect(serialised).not.toContain('blurredThumbnailKey');
    });

    it('carries no render either — those live on the enquiry-scoped route', async () => {
      const detail = await service.findOne(consumerId);

      expect(Object.keys(detail)).not.toContain('renders');
      expect(JSON.stringify(detail)).not.toContain('renders/');
    });

    it('leaks no credential from the underlying users row', async () => {
      const serialised = JSON.stringify(await service.findOne(consumerId));

      expect(serialised).not.toContain('passwordHash');
      expect(serialised).not.toContain('argon2');
      expect(serialised).not.toContain('twofaSecret');
      expect(serialised).not.toContain('twofaRecoveryCodes');
    });

    it('reports the A-16 counts and the A-17 enquiry history', async () => {
      const detail = await service.findOne(consumerId);

      expect(detail).toMatchObject({
        generationsThisMonth: 4,
        shortlistSize: 7,
        enquiryCount: 2,
      });
      expect(detail.enquiries).toHaveLength(1);
      expect(detail.enquiries[0].reference).toBe('ENQ-2026-000137');
    });

    it('reports an unknown consumer as USER_NOT_FOUND', async () => {
      expect(await errorCodeOf(service.findOne('c0000000-0000-4000-8000-999999999999'))).toBe(
        ErrorCode.USER_NOT_FOUND,
      );
    });
  });

  describe('renders (A-17, S-10)', () => {
    beforeEach(() => {
      consumerQuery.listEnquiryLinkedRenders.mockResolvedValue({
        items: [
          {
            id: 'r1',
            createdAt: now,
            storageKey: 'renders/c0000000/abc.png',
            thumbnailKey: 'thumbnails/render/abc.webp',
            garmentTitleSnapshot: 'Zarrin Bridal Lehenga',
            garmentCategorySnapshot: 'Bridal',
            garmentPriceSnapshot: 185000,
            garmentCurrencySnapshot: 'PKR',
            width: 1024,
            height: 1536,
            enquiryId: 'e1',
            enquiryReference: 'ENQ-2026-000137',
          },
        ],
        meta: pageMeta,
      });
    });

    it('signs each URL for the requesting admin, not for the consumer (§3.4)', async () => {
      await service.listRenders(actor, consumerId, {
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      });

      for (const call of signedUrls.issueUrl.mock.calls) {
        expect(call[1]).toEqual({ subject: adminId });
        expect(call[1]).not.toEqual({ subject: consumerId });
      }
    });

    it('returns a finished URL and never the storage key behind it', async () => {
      const page = await service.listRenders(actor, consumerId, {
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      });

      const serialised = JSON.stringify(page.items);
      expect(Object.keys(page.items[0])).not.toContain('storageKey');
      expect(Object.keys(page.items[0])).not.toContain('thumbnailKey');
      expect(serialised).not.toContain('renders/c0000000/abc.png');
      expect(page.items[0].url).toBe(`https://api.test/api/v1/files/signed-for-${adminId}`);
    });

    it('carries the enquiry that authorises each render to be visible', async () => {
      const page = await service.listRenders(actor, consumerId, {
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      });

      expect(page.items[0].enquiryId).toBe('e1');
      expect(page.items[0].enquiryReference).toBe('ENQ-2026-000137');
    });

    it('refuses before querying when the id is not a consumer', async () => {
      const code = await errorCodeOf(
        service.listRenders(actor, 'c0000000-0000-4000-8000-999999999999', {
          page: 1,
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'DESC',
        }),
      );

      expect(code).toBe(ErrorCode.USER_NOT_FOUND);
      expect(consumerQuery.listEnquiryLinkedRenders).not.toHaveBeenCalled();
    });
  });

  describe('shortlist (A-17)', () => {
    it('exposes garments, never renders', async () => {
      consumerQuery.listShortlist.mockResolvedValue({
        items: [
          {
            id: 's1',
            garmentId: 'g1',
            verdict: 'LOVE_IT',
            rank: 1,
            note: 'the neckline',
            verdictAt: now,
            garmentTitle: 'Zarrin Bridal Lehenga',
            garmentSku: 'ZBL-001',
            garmentPrice: 185000,
            garmentCurrency: 'PKR',
          },
        ],
        meta: pageMeta,
      });

      const page = await service.listShortlist(consumerId, {
        page: 1,
        limit: 20,
        sortBy: 'rank',
        sortOrder: 'ASC',
      });

      const keys = Object.keys(page.items[0]);
      expect(keys).not.toContain('url');
      expect(keys).not.toContain('renderUrl');
      expect(keys).not.toContain('latestResultId');
      expect(JSON.stringify(page.items)).not.toContain('renders/');
    });
  });

  /* ---------------------------------------------------------------------------------------
   * A-18 — quota override
   * ------------------------------------------------------------------------------------ */

  describe('quota override (A-18)', () => {
    it('creates the profile row lazily and writes only the override field', async () => {
      await service.setQuotaOverride(actor, consumerId, { monthlyQuotaOverride: 40 });

      expect(profiles.$rows).toHaveLength(1);
      expect(profiles.$rows[0]).toMatchObject({ userId: consumerId, monthlyQuotaOverride: 40 });
    });

    it('updates an existing profile without touching her other fields', async () => {
      profiles.$rows.push(
        Object.assign(new ConsumerProfile(), {
          id: 'p1',
          userId: consumerId,
          deletedAt: null,
          preferredCategories: ['cat-1'],
          monthlyQuotaOverride: null,
          notificationPreferences: {},
        }),
      );

      await service.setQuotaOverride(actor, consumerId, { monthlyQuotaOverride: 25 });

      expect(profiles.update).toHaveBeenCalledWith({ id: 'p1' }, { monthlyQuotaOverride: 25 });
      expect(profiles.$rows[0].preferredCategories).toEqual(['cat-1']);
    });

    it('clears the override with null, returning the account to the global default', async () => {
      profiles.$rows.push(
        Object.assign(new ConsumerProfile(), {
          id: 'p1',
          userId: consumerId,
          deletedAt: null,
          monthlyQuotaOverride: 40,
          preferredCategories: [],
          notificationPreferences: {},
        }),
      );

      await service.setQuotaOverride(actor, consumerId, { monthlyQuotaOverride: null });

      expect(profiles.$rows[0].monthlyQuotaOverride).toBeNull();
    });

    it('emits the before/after so the quota module can append its balancing ledger row', async () => {
      await service.setQuotaOverride(actor, consumerId, { monthlyQuotaOverride: 40 });

      const event = emitted.find((entry) => entry.name === USER_EVENTS.QUOTA_OVERRIDE_CHANGED);
      expect(event?.payload).toMatchObject({ userId: consumerId, from: null, to: 40 });
    });

    it('writes no ledger row itself — the balance is the quota module’s to derive', async () => {
      await service.setQuotaOverride(actor, consumerId, { monthlyQuotaOverride: 40 });

      expect(JSON.stringify(profiles.$rows)).not.toContain('delta');
    });
  });

  /* ---------------------------------------------------------------------------------------
   * A-19 — suspension
   * ------------------------------------------------------------------------------------ */

  describe('suspend (A-19)', () => {
    const reason = 'Repeated uploads failing moderation review.';

    it('records the required reason and cuts live sessions in the same transaction', async () => {
      await service.suspend(actor, consumerId, { reason });

      const row = users.$rows[0];
      expect(row.status).toBe(UserStatus.SUSPENDED);
      expect(row.suspendedReason).toBe(reason);
      expect(row.suspendedAt).toEqual(now);
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
        consumerId,
        expect.objectContaining({ reason: 'SUSPENDED', manager: expect.anything() }),
      );
      expect(state).toMatchObject({ started: 1, committed: 1, rolledBack: 0, released: 1 });
    });

    it('preserves her data — nothing is deleted or anonymised', async () => {
      await service.suspend(actor, consumerId, { reason });

      expect(users.delete).not.toHaveBeenCalled();
      expect(users.softDelete).not.toHaveBeenCalled();
      expect(users.remove).not.toHaveBeenCalled();
      expect(users.$rows[0].email).toBe('farida@example.invalid');
      expect(users.$rows[0].phone).toBe('+923001234567');
    });

    it('tells her what happened, with the reason the admin actually wrote (D-7)', async () => {
      await service.suspend(actor, consumerId, { reason });

      expect(notifications.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'farida@example.invalid',
          template: TemplateId.ACCOUNT_SUSPENDED,
          props: expect.objectContaining({ reason, consumerName: 'Farida Iqbal' }),
        }),
      );
    });

    it('does not fail the suspension when the email cannot be delivered (E-11)', async () => {
      notifications.sendTemplatedEmail.mockResolvedValue({
        ...sent(),
        ok: false,
        failure: {
          code: NotificationErrorCode.NOTIFICATION_PROVIDER_UNAVAILABLE,
          message: 'provider unreachable',
          retryable: true,
        },
      });

      await expect(service.suspend(actor, consumerId, { reason })).resolves.toBeDefined();
      expect(users.$rows[0].status).toBe(UserStatus.SUSPENDED);
    });

    it('emits user.suspended carrying the reason, from and to', async () => {
      await service.suspend(actor, consumerId, { reason });

      const event = emitted.find((entry) => entry.name === USER_EVENTS.SUSPENDED);
      expect(event?.payload).toMatchObject({
        userId: consumerId,
        actorId: adminId,
        from: UserStatus.ACTIVE,
        to: UserStatus.SUSPENDED,
        reason,
        sessionsRevoked: 2,
      });
    });

    it('refuses to suspend an account that is already on hold', async () => {
      users.$rows[0].status = UserStatus.SUSPENDED;

      expect(await errorCodeOf(service.suspend(actor, consumerId, { reason }))).toBe(
        ErrorCode.RESOURCE_CONFLICT,
      );
    });

    it('lifts a hold and clears the reason', async () => {
      users.$rows[0].status = UserStatus.SUSPENDED;
      users.$rows[0].suspendedReason = reason;
      users.$rows[0].suspendedAt = now;

      await service.unsuspend(actor, consumerId);

      expect(users.$rows[0]).toMatchObject({
        status: UserStatus.ACTIVE,
        suspendedReason: null,
        suspendedAt: null,
      });
      expect(emitted.map((entry) => entry.name)).toContain(USER_EVENTS.UNSUSPENDED);
    });

    it('refuses to lift a hold that is not there', async () => {
      expect(await errorCodeOf(service.unsuspend(actor, consumerId))).toBe(
        ErrorCode.RESOURCE_CONFLICT,
      );
    });

    /**
     * **suspend → unsuspend was a resurrection (H7).**
     *
     * Requesting deletion sets `status = DEACTIVATED` and stamps `deletionRequestedAt`.
     * `suspend` only refused an account already `SUSPENDED`, so it happily took the
     * deletion-pending account to `SUSPENDED`; `unsuspend` then only checked that it *was*
     * `SUSPENDED`, and set it `ACTIVE`. The consumer could sign back into an account she had
     * asked us to delete — and if the sweep had already written the request off, for good.
     */
    it('refuses to suspend an account whose deletion has been requested (C-38)', async () => {
      users.$rows[0].status = UserStatus.DEACTIVATED;
      users.$rows[0].deletionRequestedAt = now;

      expect(await errorCodeOf(service.suspend(actor, consumerId, { reason }))).toBe(
        ErrorCode.DELETION_IN_PROGRESS,
      );
      expect(users.$rows[0].status).toBe(UserStatus.DEACTIVATED);
    });

    it('refuses to lift a hold on an account whose deletion has been requested', async () => {
      // The account was already on hold when the deletion was requested, so it never
      // passed through `suspend` — this is the other half of the same door.
      users.$rows[0].status = UserStatus.SUSPENDED;
      users.$rows[0].deletionRequestedAt = now;

      expect(await errorCodeOf(service.unsuspend(actor, consumerId))).toBe(
        ErrorCode.DELETION_IN_PROGRESS,
      );
      expect(users.$rows[0].status).toBe(UserStatus.SUSPENDED);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * A-20 — deletion
   * ------------------------------------------------------------------------------------ */

  describe('requestDeletion (A-20, D-17)', () => {
    it('refuses when the typed name does not match, and writes nothing', async () => {
      const code = await errorCodeOf(
        service.requestDeletion(actor, consumerId, { confirmName: 'Wrong Name' }),
      );

      expect(code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(deletionLog.$rows).toHaveLength(0);
      expect(users.$rows[0].deletionRequestedAt).toBeNull();
      expect(state.started).toBe(0);
    });

    it('accepts the name as a person types it — case and spacing forgiven', async () => {
      await expect(
        service.requestDeletion(actor, consumerId, { confirmName: '  farida   iqbal ' }),
      ).resolves.toBeDefined();
    });

    it('appends the A-20 confirmation record with completedAt still open', async () => {
      const receipt = await service.requestDeletion(actor, consumerId, {
        confirmName: 'Farida Iqbal',
      });

      expect(deletionLog.$rows).toHaveLength(1);
      expect(deletionLog.$rows[0]).toMatchObject({
        subjectType: DeletionSubject.USER,
        subjectId: consumerId,
        userId: consumerId,
        initiatedBy: DeletionInitiator.ADMIN,
        actorId: adminId,
        requestedAt: now,
        completedAt: null,
        rowsDeleted: {},
        storageKeysDeleted: 0,
        bytesReclaimed: '0',
      });
      expect(deletionLog.$rows[0].verificationHash).toHaveLength(64);
      expect(receipt.deletionLogId).toBe(deletionLog.$rows[0].id);
    });

    it('returns the 24-hour SLA deadline (A-20, C-38)', async () => {
      const receipt = await service.requestDeletion(actor, consumerId, {
        confirmName: 'Farida Iqbal',
      });

      expect(receipt.requestedAt).toEqual(now);
      expect(receipt.dueBy.getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000);
      expect(receipt.sessionsRevoked).toBe(2);
    });

    it('stamps the account and cuts its sessions in one transaction', async () => {
      await service.requestDeletion(actor, consumerId, { confirmName: 'Farida Iqbal' });

      expect(users.$rows[0].deletionRequestedAt).toEqual(now);
      expect(users.$rows[0].status).toBe(UserStatus.DEACTIVATED);
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
        consumerId,
        expect.objectContaining({ reason: 'DELETION_REQUESTED', manager: expect.anything() }),
      );
      expect(state).toMatchObject({ started: 1, committed: 1, rolledBack: 0, released: 1 });
    });

    it('does not purge anything itself — that is the retention module’s job', async () => {
      await service.requestDeletion(actor, consumerId, { confirmName: 'Farida Iqbal' });

      expect(users.delete).not.toHaveBeenCalled();
      expect(users.remove).not.toHaveBeenCalled();
      expect(users.$rows).toHaveLength(1);
    });

    it('emits user.deletion_requested so the retention module can pick the work up', async () => {
      await service.requestDeletion(actor, consumerId, { confirmName: 'Farida Iqbal' });

      const event = emitted.find((entry) => entry.name === USER_EVENTS.DELETION_REQUESTED);
      expect(event?.payload).toMatchObject({
        userId: consumerId,
        actorId: adminId,
        deletionLogId: deletionLog.$rows[0].id,
        requestedAt: now,
      });
    });

    it('refuses a second request while one is in flight', async () => {
      users.$rows[0].deletionRequestedAt = now;

      expect(
        await errorCodeOf(
          service.requestDeletion(actor, consumerId, { confirmName: 'Farida Iqbal' }),
        ),
      ).toBe(ErrorCode.DELETION_IN_PROGRESS);
    });
  });
});
