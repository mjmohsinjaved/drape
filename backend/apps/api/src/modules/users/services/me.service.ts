import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Not, Repository } from 'typeorm';

import {
  ConflictException,
  ErrorCode,
  NotFoundException,
  OwnershipException,
  type ICurrentUser,
} from '@library/common';

import { USER_EVENTS, type UserProfileUpdatedEvent } from '../constants/user-events.constant';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationPreferencesResponseDto,
} from '../dto/notification-preferences.dto';
import { ConsumerProfile, type NotificationPreferences } from '../entities/consumer-profile.entity';
import { User } from '../entities/user.entity';
import { toConsumerProfileResponse, toNotificationPreferences } from '../mappers/consumer.mapper';
import { toMeResponse } from '../mappers/user.mapper';

import type {
  ConsumerProfileResponseDto,
  UpdateConsumerProfileDto,
} from '../dto/consumer-profile.dto';
import type { MeResponseDto } from '../dto/me-response.dto';
import type { UpdateNotificationPreferencesDto } from '../dto/notification-preferences.dto';
import type { UpdateMeDto } from '../dto/update-me.dto';

/**
 * The `users` columns a self route reads. Same allow-list discipline as the admin
 * queries: an account reading its own row still gets no password hash, no 2FA
 * secret and no recovery code (§9.2).
 */
const SELF_USER_COLUMNS = [
  'id',
  'name',
  'email',
  'phone',
  'role',
  'status',
  'locale',
  'emailVerifiedAt',
  'phoneVerifiedAt',
  'twofaEnabledAt',
  'createdAt',
  'lastLoginAt',
  'deletionRequestedAt',
] as const;

/**
 * The caller's own account — `/me/**` (§5.2, C-2, C-7).
 *
 * **Ownership is never inferred from an id in the URL** (§9.2). Every method here
 * takes the caller from `ICurrentUser`, which only `SessionAuthGuard` populates
 * (S-3); there is no `:userId` on any of these routes to get wrong. Where a row is
 * loaded by something other than the caller's own id, the row's `userId` is checked
 * against the session before it is written — belt and braces, and the check is
 * covered by the cross-account test.
 *
 * What is deliberately **not** writable here: `email` (an identity change needing
 * re-verification — `auth` owns it), `role` and `status` (S-4), and
 * `monthlyQuotaOverride` (an admin control — A-18).
 */
@Injectable()
export class MeService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ConsumerProfile) private readonly profiles: Repository<ConsumerProfile>,
    private readonly events: EventEmitter2,
  ) {}

  /** `GET /me`. */
  async findMe(caller: ICurrentUser): Promise<MeResponseDto> {
    return toMeResponse(await this.requireSelf(caller));
  }

  /**
   * `PATCH /me` — name, phone, locale (C-7).
   *
   * Changing the phone number clears `phoneVerifiedAt`, so C-3 makes her verify the
   * new one before her next enquiry. That is decided here, not by the client: a
   * client that could send `phoneVerified: true` would have just verified its own
   * phone number.
   */
  async updateMe(caller: ICurrentUser, dto: UpdateMeDto): Promise<MeResponseDto> {
    const user = await this.requireSelf(caller);
    this.assertNotBeingDeleted(user.deletionRequestedAt);

    const changes: Partial<User> = {};
    const changedFields: string[] = [];

    if (dto.name !== undefined && dto.name !== user.name) {
      changes.name = dto.name;
      changedFields.push('name');
    }

    if (dto.locale !== undefined && dto.locale !== user.locale) {
      changes.locale = dto.locale;
      changedFields.push('locale');
    }

    if (dto.phone !== undefined && dto.phone !== user.phone) {
      await this.assertPhoneAvailable(dto.phone, user.id);
      changes.phone = dto.phone;
      changes.phoneVerifiedAt = null;
      changedFields.push('phone');
    }

    if (changedFields.length > 0) {
      await this.users.update({ id: user.id }, changes);

      const event: UserProfileUpdatedEvent = {
        userId: user.id,
        actorId: user.id,
        occurredAt: new Date(),
        // Names only. The values are personal data and belong nowhere near a log (E-12).
        changedFields,
      };
      this.events.emit(USER_EVENTS.PROFILE_UPDATED, event);
    }

    return toMeResponse(await this.requireSelf(caller));
  }

  /* -----------------------------------------------------------------------------------------
   * C-2 — the optional profile fields
   * -------------------------------------------------------------------------------------- */

  /** `GET /me/profile` (C-2). A missing row is normal and reports as all-null. */
  async findMyProfile(caller: ICurrentUser): Promise<ConsumerProfileResponseDto> {
    const profile = await this.profiles.findOne({ where: { userId: caller.id } });
    return toConsumerProfileResponse(profile);
  }

  /**
   * `PATCH /me/profile` (C-2).
   *
   * > "Event date, event type and budget band are optional and prompted later in
   * > context."
   *
   * So an absent key leaves the stored value alone and an explicit `null` clears it.
   * The two are different intentions and the API distinguishes them.
   */
  async updateMyProfile(
    caller: ICurrentUser,
    dto: UpdateConsumerProfileDto,
  ): Promise<ConsumerProfileResponseDto> {
    const user = await this.requireSelf(caller);
    this.assertNotBeingDeleted(user.deletionRequestedAt);

    const profile = await this.ensureProfile(caller.id);
    const changes: Partial<ConsumerProfile> = {};
    const changedFields: string[] = [];

    if (dto.eventDate !== undefined) {
      changes.eventDate = dto.eventDate === null ? null : toCalendarDate(dto.eventDate);
      changedFields.push('eventDate');
    }
    if (dto.eventType !== undefined) {
      changes.eventType = dto.eventType;
      changedFields.push('eventType');
    }
    if (dto.budgetBand !== undefined) {
      changes.budgetBand = dto.budgetBand;
      changedFields.push('budgetBand');
    }
    if (dto.preferredCategories !== undefined) {
      changes.preferredCategories = dto.preferredCategories;
      changedFields.push('preferredCategories');
    }

    if (changedFields.length > 0) {
      await this.updateOwnedProfile(profile, caller.id, changes);

      const event: UserProfileUpdatedEvent = {
        userId: caller.id,
        actorId: caller.id,
        occurredAt: new Date(),
        changedFields,
      };
      this.events.emit(USER_EVENTS.PROFILE_UPDATED, event);
    }

    return toConsumerProfileResponse(await this.profiles.findOne({ where: { userId: caller.id } }));
  }

  /* -----------------------------------------------------------------------------------------
   * C-7 — notification preferences
   * -------------------------------------------------------------------------------------- */

  /** `GET /me/notification-preferences` (C-7). */
  async findMyNotificationPreferences(
    caller: ICurrentUser,
  ): Promise<NotificationPreferencesResponseDto> {
    const profile = await this.profiles.findOne({ where: { userId: caller.id } });
    return toNotificationPreferences(profile);
  }

  /**
   * `PATCH /me/notification-preferences` (C-7).
   *
   * Only the toggles present in the payload are written, merged over the stored
   * object and the defaults. A client that knows about three switches cannot reset a
   * fourth it has never heard of — which is what a whole-object PUT would do the
   * first time a new preference shipped.
   */
  async updateMyNotificationPreferences(
    caller: ICurrentUser,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesResponseDto> {
    const profile = await this.ensureProfile(caller.id);

    const merged: NotificationPreferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(profile.notificationPreferences ?? {}),
      ...stripUndefined(dto),
    };

    await this.updateOwnedProfile(profile, caller.id, { notificationPreferences: merged });

    return toNotificationPreferences(await this.profiles.findOne({ where: { userId: caller.id } }));
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  private async requireSelf(caller: ICurrentUser): Promise<User> {
    const user = await this.users
      .createQueryBuilder('user')
      .select(SELF_USER_COLUMNS.map((column) => `user.${column}`))
      .where('user.id = :userId', { userId: caller.id })
      .andWhere('user.deletedAt IS NULL')
      .getOne();

    if (user === null) {
      // The session outlived the row. Not a 401 — the caller is authenticated; the
      // account they are authenticated as is gone.
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }
    return user;
  }

  /**
   * `consumer_profiles` is created lazily: signup asks for name, email, password and
   * phone (C-2) and nothing else, so the row appears the first time she answers one
   * of the optional prompts.
   *
   * §5.2 marks the notification-preference routes `ANY`, so an admin can own a row
   * here too. The table is named for its main tenant, not for a constraint.
   */
  private async ensureProfile(userId: string): Promise<ConsumerProfile> {
    const existing = await this.profiles.findOne({ where: { userId } });
    if (existing !== null) {
      return existing;
    }

    return this.profiles.save(
      this.profiles.create({
        userId,
        eventDate: null,
        eventType: null,
        budgetBand: null,
        preferredCategories: [],
        monthlyQuotaOverride: null,
        notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
        onboardingCompletedAt: null,
      }),
    );
  }

  /**
   * The §9.2 object-level check, written out rather than assumed.
   *
   * The row was loaded by `userId` so this can only fail if something upstream is
   * badly wrong — which is exactly when a cheap assertion earns its place. It throws
   * an `OwnershipException`, which the filter masks before the client sees it.
   */
  private async updateOwnedProfile(
    profile: ConsumerProfile,
    callerId: string,
    changes: Partial<ConsumerProfile>,
  ): Promise<void> {
    if (profile.userId !== callerId) {
      throw new OwnershipException(ErrorCode.RESOURCE_NOT_FOUND);
    }
    await this.profiles.update({ id: profile.id, userId: callerId }, changes);
  }

  /** `PHONE_ALREADY_EXISTS` — the unique index would say the same thing, less kindly. */
  private async assertPhoneAvailable(phone: string, selfId: string): Promise<void> {
    const taken = await this.users.exists({ where: { phone, id: Not(selfId) } });
    if (taken) {
      throw new ConflictException(ErrorCode.PHONE_ALREADY_EXISTS);
    }
  }

  /** C-38: once deletion is requested the account is a receipt, not a profile. */
  private assertNotBeingDeleted(deletionRequestedAt: Date | null): void {
    if (deletionRequestedAt !== null) {
      throw new ConflictException(ErrorCode.DELETION_IN_PROGRESS);
    }
  }
}

/** Drops the keys a PATCH omitted, so a merge cannot write `undefined` over a stored value. */
function stripUndefined(dto: UpdateNotificationPreferencesDto): Partial<NotificationPreferences> {
  const result: Partial<NotificationPreferences> = {};
  for (const [key, value] of Object.entries(dto)) {
    if (typeof value === 'boolean') {
      result[key as keyof NotificationPreferences] = value;
    }
  }
  return result;
}

/**
 * `consumer_profiles.eventDate` is a `date`, not a timestamp. Parsing `2027-01-14`
 * at UTC midnight and storing the calendar part keeps her wedding on the day she
 * chose in every timezone the API is ever read from.
 */
function toCalendarDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
