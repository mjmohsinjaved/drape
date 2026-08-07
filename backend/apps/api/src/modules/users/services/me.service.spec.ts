import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AppException,
  ErrorCode,
  Locale,
  Role,
  UserStatus,
  type ICurrentUser,
} from '@library/common';

import { buildUser } from '../../../../test/factories';
import { createInMemoryRepository } from '../../../../test/fixtures';
import { ConsumerProfile } from '../entities/consumer-profile.entity';
import { type User } from '../entities/user.entity';
import { EventType } from '../enums/event-type.enum';

import { MeService } from './me.service';

import type { Repository, SelectQueryBuilder } from 'typeorm';

/**
 * **PRD E-7 — the cross-account test.**
 *
 * > "one consumer cannot read another's profile or data"
 *
 * On `/me/**` that property is structural before it is behavioural: no route takes a
 * user id, so the only thing a request can name is itself. What is left to prove is
 * that the **service** honours the same rule — that it filters by the session's id
 * rather than by whatever row it happened to load, and that the §9.2 object-level
 * check fires if a row ever arrives that belongs to somebody else.
 *
 * The `users` query builder in this file is a real filter, not a canned answer: it
 * matches on the `userId` parameter the service passes. A test that stubbed
 * `getOne()` to return "the right user" would prove nothing about scoping.
 */
describe('MeService — cross-account isolation (E-7, §9.2)', () => {
  const ayeshaId = 'c0000000-0000-4000-8000-00000000000a';
  const faridaId = 'c0000000-0000-4000-8000-00000000000f';

  let users: Repository<User> & { $rows: User[] };
  let profiles: Repository<ConsumerProfile> & { $rows: ConsumerProfile[] };
  let events: EventEmitter2;
  let service: MeService;

  function session(userId: string, role: Role = Role.CONSUMER): ICurrentUser {
    return {
      id: userId,
      role,
      email: `${userId}@example.invalid`,
      name: 'Session Holder',
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      phoneVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      sessionId: '11112222-3333-4444-8555-666677778888',
      locale: Locale.EN,
    };
  }

  function buildProfile(overrides: Partial<ConsumerProfile>): ConsumerProfile {
    return Object.assign(new ConsumerProfile(), {
      id: `p-${overrides.userId ?? 'x'}`,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null,
      eventDate: null,
      eventType: null,
      budgetBand: null,
      preferredCategories: [],
      monthlyQuotaOverride: null,
      notificationPreferences: {},
      onboardingCompletedAt: null,
      ...overrides,
    });
  }

  /**
   * A query builder that actually applies the `userId` predicate the service passes,
   * so "returns the caller's row" is a property of the query rather than of the stub.
   */
  function attachSelfBuilder(repository: Repository<User>, rows: User[]): { lastUserId?: string } {
    const captured: { lastUserId?: string } = {};

    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      where: (_condition: string, parameters?: Record<string, unknown>) => {
        if (typeof parameters?.userId === 'string') {
          captured.lastUserId = parameters.userId;
        }
        return builder;
      },
      andWhere: () => builder,
      getOne: () =>
        Promise.resolve(
          rows.find((row) => row.id === captured.lastUserId && row.deletedAt === null) ?? null,
        ),
    });

    (repository as unknown as Record<string, unknown>).createQueryBuilder =
      (): SelectQueryBuilder<User> => builder as unknown as SelectQueryBuilder<User>;

    return captured;
  }

  beforeEach(() => {
    users = createInMemoryRepository<User>({
      rows: [
        buildUser({
          id: ayeshaId,
          name: 'Ayesha',
          email: 'ayesha@example.invalid',
          phone: '+923001110000',
        }),
        buildUser({
          id: faridaId,
          name: 'Farida',
          email: 'farida@example.invalid',
          phone: '+923002220000',
        }),
      ],
    });

    profiles = createInMemoryRepository<ConsumerProfile>({
      create: (input) => buildProfile(input),
    });

    attachSelfBuilder(users, users.$rows);

    events = new EventEmitter2();
    service = new MeService(users, profiles, events);
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
   * One consumer cannot read another's account
   * ------------------------------------------------------------------------------------ */

  describe('GET /me', () => {
    it("returns the caller's own account, never the other consumer's", async () => {
      const ayesha = await service.findMe(session(ayeshaId));
      const farida = await service.findMe(session(faridaId));

      expect(ayesha.id).toBe(ayeshaId);
      expect(ayesha.name).toBe('Ayesha');
      expect(farida.id).toBe(faridaId);
      expect(farida.email).toBe('farida@example.invalid');
      expect(ayesha.email).not.toBe(farida.email);
    });

    it('serialises no credential, even to the account that owns it', async () => {
      const response = await service.findMe(session(ayeshaId));
      const serialised = JSON.stringify(response);

      expect(Object.keys(response)).not.toContain('passwordHash');
      expect(serialised).not.toContain('argon2');
      // The boolean the UI needs, not the secret behind it.
    });

    it('reports a session whose account is gone as USER_NOT_FOUND, not as a 401', async () => {
      const code = await errorCodeOf(
        service.findMe(session('c0000000-0000-4000-8000-999999999999')),
      );

      expect(code).toBe(ErrorCode.USER_NOT_FOUND);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * One consumer cannot read another's profile
   * ------------------------------------------------------------------------------------ */

  describe('GET /me/profile', () => {
    beforeEach(() => {
      profiles.$rows.push(
        buildProfile({ userId: faridaId, eventType: EventType.WALIMA, monthlyQuotaOverride: 40 }),
      );
    });

    it("does not return the other consumer's profile to a caller who has none", async () => {
      const profile = await service.findMyProfile(session(ayeshaId));

      expect(profile.eventType).toBeNull();
      expect(profile.monthlyQuotaOverride).toBeNull();
      expect(profile.preferredCategories).toEqual([]);
    });

    it('returns the caller their own profile', async () => {
      const profile = await service.findMyProfile(session(faridaId));

      expect(profile.eventType).toBe(EventType.WALIMA);
      expect(profile.monthlyQuotaOverride).toBe(40);
    });

    it('queries by the session id, never by anything the request supplied', async () => {
      await service.findMyProfile(session(ayeshaId));

      expect(profiles.findOne).toHaveBeenCalledWith({ where: { userId: ayeshaId } });
    });
  });

  /* ---------------------------------------------------------------------------------------
   * One consumer cannot write to another's profile
   * ------------------------------------------------------------------------------------ */

  describe('PATCH /me/profile', () => {
    it("writes only to the caller's own row, with userId in the predicate (§9.2)", async () => {
      profiles.$rows.push(buildProfile({ userId: ayeshaId }));

      await service.updateMyProfile(session(ayeshaId), { eventType: EventType.NIKKAH });

      expect(profiles.update).toHaveBeenCalledWith(
        { id: `p-${ayeshaId}`, userId: ayeshaId },
        expect.objectContaining({ eventType: EventType.NIKKAH }),
      );
    });

    it('refuses to write when the loaded row belongs to someone else, and masks the refusal', async () => {
      const faridasProfile = buildProfile({ userId: faridaId });
      profiles.$rows.push(faridasProfile);
      // Simulate the lookup going wrong in any way at all — the object-level check is
      // the backstop that decides, not the query that produced the row.
      (profiles.findOne as jest.Mock).mockResolvedValueOnce(faridasProfile);

      const code = await errorCodeOf(
        service.updateMyProfile(session(ayeshaId), { eventType: EventType.NIKKAH }),
      );

      expect(code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
      expect(profiles.update).not.toHaveBeenCalled();
    });

    it('distinguishes an omitted field from an explicit null (C-2)', async () => {
      profiles.$rows.push(
        buildProfile({ userId: ayeshaId, eventType: EventType.BARAAT, budgetBand: null }),
      );

      await service.updateMyProfile(session(ayeshaId), { eventDate: null });

      const [, changes] = (profiles.update as jest.Mock).mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(changes).toEqual({ eventDate: null });
      expect(changes).not.toHaveProperty('eventType');
    });

    it('writes nothing at all when the payload is empty', async () => {
      profiles.$rows.push(buildProfile({ userId: ayeshaId }));

      await service.updateMyProfile(session(ayeshaId), {});

      expect(profiles.update).not.toHaveBeenCalled();
    });

    it('creates the profile row lazily — signup does not ask for these fields', async () => {
      await service.updateMyProfile(session(ayeshaId), { eventType: EventType.MEHNDI });

      expect(profiles.save).toHaveBeenCalled();
      expect(profiles.$rows.map((row) => row.userId)).toContain(ayeshaId);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * PATCH /me — what is and is not writable
   * ------------------------------------------------------------------------------------ */

  describe('PATCH /me', () => {
    it('writes only name, phone and locale — never role, status or email (S-4)', async () => {
      await service.updateMe(session(ayeshaId), { name: 'Ayesha K.', locale: Locale.UR });

      const [criteria, changes] = (users.update as jest.Mock).mock.calls[0] as [
        Record<string, unknown>,
        Record<string, unknown>,
      ];

      expect(criteria).toEqual({ id: ayeshaId });
      expect(Object.keys(changes).sort()).toEqual(['locale', 'name']);
      expect(changes).not.toHaveProperty('role');
      expect(changes).not.toHaveProperty('status');
      expect(changes).not.toHaveProperty('email');
      expect(changes).not.toHaveProperty('passwordHash');
    });

    it('clears phone verification when the number changes (C-3)', async () => {
      await service.updateMe(session(ayeshaId), { phone: '+923009998888' });

      const [, changes] = (users.update as jest.Mock).mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(changes).toEqual({ phone: '+923009998888', phoneVerifiedAt: null });
    });

    it('refuses a number that already belongs to another account', async () => {
      const code = await errorCodeOf(
        service.updateMe(session(ayeshaId), { phone: '+923002220000' }),
      );

      expect(code).toBe(ErrorCode.PHONE_ALREADY_EXISTS);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('accepts the caller re-sending their own number', async () => {
      await expect(
        service.updateMe(session(ayeshaId), { phone: '+923001110000' }),
      ).resolves.toBeDefined();

      expect(users.update).not.toHaveBeenCalled();
    });

    it('refuses any change once deletion has been requested (C-38)', async () => {
      users.$rows[0].deletionRequestedAt = new Date('2026-08-14T00:00:00.000Z');

      const code = await errorCodeOf(service.updateMe(session(ayeshaId), { name: 'New Name' }));

      expect(code).toBe(ErrorCode.DELETION_IN_PROGRESS);
    });

    it('emits only the names of the changed fields, never their values (E-12)', async () => {
      const seen: unknown[] = [];
      events.onAny((_name, payload) => seen.push(payload));

      await service.updateMe(session(ayeshaId), { name: 'Ayesha K.' });

      expect(JSON.stringify(seen)).toContain('"changedFields":["name"]');
      expect(JSON.stringify(seen)).not.toContain('Ayesha K.');
    });
  });

  /* ---------------------------------------------------------------------------------------
   * C-7 notification preferences
   * ------------------------------------------------------------------------------------ */

  describe('notification preferences (C-7)', () => {
    it('reports the defaults for an account that has never set them', async () => {
      const preferences = await service.findMyNotificationPreferences(session(ayeshaId));

      expect(preferences).toEqual({
        emailOnResultReady: true,
        emailOnEnquiryUpdate: true,
        emailOnNewArrivals: false,
        smsOnEnquiryUpdate: false,
      });
    });

    it('defaults the promotional channel to off — consent is opt-in', async () => {
      const preferences = await service.findMyNotificationPreferences(session(ayeshaId));

      expect(preferences.emailOnNewArrivals).toBe(false);
    });

    it('merges a partial patch instead of replacing the whole object', async () => {
      profiles.$rows.push(
        buildProfile({
          userId: ayeshaId,
          notificationPreferences: {
            emailOnResultReady: false,
            emailOnEnquiryUpdate: true,
            emailOnNewArrivals: true,
            smsOnEnquiryUpdate: false,
          },
        }),
      );

      await service.updateMyNotificationPreferences(session(ayeshaId), {
        smsOnEnquiryUpdate: true,
      });

      const [, changes] = (profiles.update as jest.Mock).mock.calls[0] as [
        unknown,
        { notificationPreferences: Record<string, boolean> },
      ];

      expect(changes.notificationPreferences).toEqual({
        emailOnResultReady: false,
        emailOnEnquiryUpdate: true,
        emailOnNewArrivals: true,
        smsOnEnquiryUpdate: true,
      });
    });

    it("does not read another account's preferences", async () => {
      profiles.$rows.push(
        buildProfile({
          userId: faridaId,
          notificationPreferences: {
            emailOnResultReady: false,
            emailOnEnquiryUpdate: false,
            emailOnNewArrivals: true,
            smsOnEnquiryUpdate: true,
          },
        }),
      );

      const preferences = await service.findMyNotificationPreferences(session(ayeshaId));

      expect(preferences.emailOnNewArrivals).toBe(false);
      expect(preferences.smsOnEnquiryUpdate).toBe(false);
    });
  });
});
