import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository, type EntityManager } from 'typeorm';

import {
  ConflictException,
  ErrorCode,
  NotFoundException,
  sha256Hex,
  UserStatus,
  ValidationException,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';
import { runInTransaction } from '@library/database';
import { NotificationsService, TemplateId } from '@library/notifications';
import { SignedUrlService } from '@library/storage';

import { DeletionLogEntry } from '@api/modules/retention/entities/deletion-log-entry.entity';
import { DeletionInitiator } from '@api/modules/retention/enums/deletion-initiator.enum';
import { DeletionSubject } from '@api/modules/retention/enums/deletion-subject.enum';

import {
  USER_EVENTS,
  type UserDeletionRequestedEvent,
  type UserQuotaOverrideChangedEvent,
  type UserStatusChangedEvent,
} from '../constants/user-events.constant';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../dto/notification-preferences.dto';
import { ConsumerProfile } from '../entities/consumer-profile.entity';
import { User } from '../entities/user.entity';
import {
  SESSION_REVOCATION,
  type SessionRevocationPort,
} from '../interfaces/session-revocation.interface';
import {
  toConsumerDetail,
  toConsumerListItem,
  toConsumerRender,
  toConsumerShortlistItem,
} from '../mappers/consumer.mapper';

import { ConsumerQueryService } from './consumer-query.service';

import type { ConsumerQueryDto } from '../dto/consumer-query.dto';
import type {
  ConsumerRenderQueryDto,
  ConsumerRenderResponseDto,
} from '../dto/consumer-render-response.dto';
import type {
  ConsumerDetailResponseDto,
  ConsumerListItemResponseDto,
} from '../dto/consumer-response.dto';
import type {
  ConsumerShortlistItemResponseDto,
  ConsumerShortlistQueryDto,
} from '../dto/consumer-shortlist-response.dto';
import type { DeleteConsumerDto, DeletionReceiptResponseDto } from '../dto/delete-consumer.dto';
import type { SetQuotaOverrideDto } from '../dto/set-quota-override.dto';
import type { SuspendConsumerDto } from '../dto/suspend-consumer.dto';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/**
 * `verification_hash` at request time.
 *
 * §4.31 defines it as "sha256 of the sorted deleted-key list". At the moment the
 * request is recorded that list is empty, and the column is `char(64)` NOT NULL —
 * so the digest of the empty list is the honest value. The retention module
 * overwrites it with the real digest when the purge completes.
 */
const EMPTY_DELETION_MANIFEST_HASH = sha256Hex('');

/**
 * Consumer management for the admin console — PRD A-16 … A-20, ARCHITECTURE §5.2.
 *
 * **Reads go through `ConsumerQueryService`, never through a repository here.** That
 * is where S-10 is enforced: no `person_photos` handle, renders reachable only
 * through `enquiry_items`, explicit column allow-lists. Routing every admin read
 * through one class is what makes "an admin can never see her photo" a property of
 * the code rather than a promise about it.
 *
 * Writes stay in this class, and every multi-table write runs inside
 * `runInTransaction` with its session revocation in the same unit of work.
 */
@Injectable()
export class AdminConsumersService {
  private readonly logger = new Logger(AdminConsumersService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ConsumerProfile) private readonly profiles: Repository<ConsumerProfile>,
    private readonly consumerQuery: ConsumerQueryService,
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
    private readonly signedUrls: SignedUrlService,
    private readonly notifications: NotificationsService,
    @Inject(SESSION_REVOCATION) private readonly sessions: SessionRevocationPort,
  ) {}

  /* -----------------------------------------------------------------------------------------
   * Reads (A-16, A-17)
   * -------------------------------------------------------------------------------------- */

  /** `GET /admin/consumers` (A-16). */
  async list(query: ConsumerQueryDto): Promise<IPaginated<ConsumerListItemResponseDto>> {
    const page = await this.consumerQuery.listConsumers(query);
    return { items: page.items.map(toConsumerListItem), meta: page.meta };
  }

  /** `GET /admin/consumers/:userId` (A-17). Carries no photo — see `ConsumerQueryService`. */
  async findOne(userId: string): Promise<ConsumerDetailResponseDto> {
    const row = await this.consumerQuery.findConsumerDetail(userId);
    if (row === null) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }
    return toConsumerDetail(row);
  }

  /**
   * `GET /admin/consumers/:userId/renders` — renders attached to her enquiries only
   * (A-17, S-10).
   *
   * Each URL is signed for the **requesting admin's** id, so it is unusable by
   * anyone else and expires with `STORAGE_URL_TTL_RENDER_SECONDS` (§3.4). The
   * storage key itself never leaves this method.
   */
  async listRenders(
    actor: ICurrentUser,
    userId: string,
    query: ConsumerRenderQueryDto,
  ): Promise<IPaginated<ConsumerRenderResponseDto>> {
    await this.requireConsumer(userId);

    const page = await this.consumerQuery.listEnquiryLinkedRenders(userId, query);
    const signUrl = (key: string): string => this.signedUrls.issueUrl(key, { subject: actor.id });

    return { items: page.items.map((row) => toConsumerRender(row, signUrl)), meta: page.meta };
  }

  /** `GET /admin/consumers/:userId/shortlist` (A-17). No renders here, by design (S-10). */
  async listShortlist(
    userId: string,
    query: ConsumerShortlistQueryDto,
  ): Promise<IPaginated<ConsumerShortlistItemResponseDto>> {
    await this.requireConsumer(userId);

    const page = await this.consumerQuery.listShortlist(userId, query);
    return { items: page.items.map(toConsumerShortlistItem), meta: page.meta };
  }

  /* -----------------------------------------------------------------------------------------
   * A-18 — per-consumer quota override
   * -------------------------------------------------------------------------------------- */

  /**
   * `PATCH /admin/consumers/:userId/quota` (A-18).
   *
   * Writes the field and nothing else. **Seam:** the arithmetic that turns an
   * override into an actual allowance — the lazy `MONTHLY_GRANT`, and the
   * mid-period `OVERRIDE_GRANT` for the difference when an override is raised —
   * belongs to `QuotaModule` and its append-only ledger (§4.26). That module does
   * not exist yet, so this endpoint writes through the entity and emits
   * `user.quota_override_changed`; when `QuotaModule` lands it should listen for
   * that event (or be called here) to append the balancing ledger row. Until then a
   * mid-period raise takes effect at the next period boundary.
   */
  async setQuotaOverride(
    actor: ICurrentUser,
    userId: string,
    dto: SetQuotaOverrideDto,
  ): Promise<ConsumerDetailResponseDto> {
    await this.requireConsumer(userId);

    const profile = await this.profiles.findOne({ where: { userId } });
    const previous = profile?.monthlyQuotaOverride ?? null;

    if (profile === null) {
      await this.profiles.save(
        this.profiles.create({
          userId,
          preferredCategories: [],
          notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
          monthlyQuotaOverride: dto.monthlyQuotaOverride,
        }),
      );
    } else {
      await this.profiles.update(
        { id: profile.id },
        { monthlyQuotaOverride: dto.monthlyQuotaOverride },
      );
    }

    const event: UserQuotaOverrideChangedEvent = {
      userId,
      actorId: actor.id,
      occurredAt: new Date(),
      from: previous,
      to: dto.monthlyQuotaOverride,
    };
    this.events.emit(USER_EVENTS.QUOTA_OVERRIDE_CHANGED, event);

    return this.findOne(userId);
  }

  /* -----------------------------------------------------------------------------------------
   * A-19 — suspension
   * -------------------------------------------------------------------------------------- */

  /**
   * `POST /admin/consumers/:userId/suspend` (A-19).
   *
   * > "Suspend an account with a required reason. Suspension blocks generation and
   * > enquiry but preserves data pending review."
   *
   * Nothing is deleted and nothing is anonymised. The block is enforced by
   * `ACCOUNT_SUSPENDED` at guard 3 and at step 2 of the try-on guard chain (§2.4);
   * all this method does is set the status, record the reason, and cut the live
   * sessions in the same transaction so the block starts now rather than at her next
   * sign-in.
   */
  async suspend(
    actor: ICurrentUser,
    userId: string,
    dto: SuspendConsumerDto,
  ): Promise<ConsumerDetailResponseDto> {
    const target = await this.requireConsumer(userId);

    if (target.status === UserStatus.SUSPENDED) {
      throw new ConflictException(ErrorCode.RESOURCE_CONFLICT, {
        message: 'This account is already on hold.',
      });
    }

    const suspendedAt = new Date();
    // Captured before the write: the loaded row is identity-mapped, so reading
    // `target.status` after the update can report the value we just set.
    const previousStatus = target.status;
    const sessionsRevoked = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<number> => {
        await manager.getRepository(User).update(
          { id: userId },
          {
            status: UserStatus.SUSPENDED,
            suspendedReason: dto.reason,
            suspendedAt,
          },
        );
        return this.sessions.revokeAllForUser(userId, { manager, reason: 'SUSPENDED' });
      },
      { label: 'consumers.suspend' },
    );

    const event: UserStatusChangedEvent = {
      userId,
      actorId: actor.id,
      occurredAt: suspendedAt,
      from: previousStatus,
      to: UserStatus.SUSPENDED,
      reason: dto.reason,
      sessionsRevoked,
    };
    this.events.emit(USER_EVENTS.SUSPENDED, event);

    await this.notifySuspended(target, suspendedAt, dto.reason);

    return this.findOne(userId);
  }

  /** `POST /admin/consumers/:userId/unsuspend` — lifts the hold and clears the reason. */
  async unsuspend(actor: ICurrentUser, userId: string): Promise<ConsumerDetailResponseDto> {
    const target = await this.requireConsumer(userId);

    if (target.status !== UserStatus.SUSPENDED) {
      throw new ConflictException(ErrorCode.RESOURCE_CONFLICT, {
        message: 'This account is not on hold.',
      });
    }

    await this.users.update(
      { id: userId },
      { status: UserStatus.ACTIVE, suspendedReason: null, suspendedAt: null },
    );

    const event: UserStatusChangedEvent = {
      userId,
      actorId: actor.id,
      occurredAt: new Date(),
      from: UserStatus.SUSPENDED,
      to: UserStatus.ACTIVE,
      reason: null,
      sessionsRevoked: 0,
    };
    this.events.emit(USER_EVENTS.UNSUSPENDED, event);

    return this.findOne(userId);
  }

  /* -----------------------------------------------------------------------------------------
   * A-20 — deletion
   * -------------------------------------------------------------------------------------- */

  /**
   * `DELETE /admin/consumers/:userId` (A-20, D-17).
   *
   * > "Delete a consumer and all associated photos, renders and shortlists.
   * > Completes within 24 hours with a confirmation record."
   *
   * **This endpoint requests the deletion; it does not perform it.** The purge —
   * cascading the rows, unlinking the storage keys, hashing the manifest — belongs
   * to `RetentionModule`, which owns `deletion_log` and the §9.3 purge job. That
   * module does not exist yet, so what happens here is:
   *
   * 1. the D-17 name confirmation is verified server-side;
   * 2. `users.deletionRequestedAt` is stamped and the account is deactivated, so
   *    nothing more can be created against it;
   * 3. every live session is revoked;
   * 4. a `deletion_log` row is appended with `completedAt = null` — the A-20
   *    confirmation record, and the retention module's work queue;
   * 5. `user.deletion_requested` is emitted after the commit.
   *
   * **Seam:** until `RetentionModule` lands, no purge runs. The row and the event
   * are the durable request, so nothing is lost — but the 24-hour SLA is not met by
   * this module alone, and `deletion_log.completedAt` stays null until it is.
   */
  async requestDeletion(
    actor: ICurrentUser,
    userId: string,
    dto: DeleteConsumerDto,
  ): Promise<DeletionReceiptResponseDto> {
    const target = await this.requireConsumer(userId);

    if (!namesMatch(dto.confirmName, target.name)) {
      throw new ValidationException(ErrorCode.VALIDATION_ERROR, {
        message: 'The name you typed does not match this account.',
        errors: [
          {
            field: 'confirmName',
            message: 'Type the account name exactly as it appears to confirm.',
            code: 'CONFIRMATION_MISMATCH',
          },
        ],
      });
    }

    if (target.deletionRequestedAt !== null) {
      throw new ConflictException(ErrorCode.DELETION_IN_PROGRESS);
    }

    const requestedAt = new Date();
    const slaHours = this.config.get<number>('DELETION_SLA_HOURS') ?? 24;
    const dueBy = new Date(requestedAt.getTime() + slaHours * MILLISECONDS_PER_HOUR);

    const outcome = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager) => {
        await manager.getRepository(User).update(
          { id: userId },
          {
            deletionRequestedAt: requestedAt,
            // Nothing more may be created against an account that is being deleted.
            status: UserStatus.DEACTIVATED,
          },
        );

        const logRepository = manager.getRepository(DeletionLogEntry);
        const entry = await logRepository.save(
          logRepository.create({
            subjectType: DeletionSubject.USER,
            subjectId: userId,
            userId,
            initiatedBy: DeletionInitiator.ADMIN,
            actorId: actor.id,
            requestedAt,
            completedAt: null,
            rowsDeleted: {},
            storageKeysDeleted: 0,
            bytesReclaimed: '0',
            verificationHash: EMPTY_DELETION_MANIFEST_HASH,
            failureReason: null,
          }),
        );

        const sessionsRevoked = await this.sessions.revokeAllForUser(userId, {
          manager,
          reason: 'DELETION_REQUESTED',
        });

        return { deletionLogId: entry.id, sessionsRevoked };
      },
      { label: 'consumers.requestDeletion' },
    );

    const event: UserDeletionRequestedEvent = {
      userId,
      actorId: actor.id,
      occurredAt: requestedAt,
      deletionLogId: outcome.deletionLogId,
      requestedAt,
      dueBy,
      sessionsRevoked: outcome.sessionsRevoked,
    };
    this.events.emit(USER_EVENTS.DELETION_REQUESTED, event);

    return {
      deletionLogId: outcome.deletionLogId,
      subjectType: DeletionSubject.USER,
      subjectId: userId,
      initiatedBy: DeletionInitiator.ADMIN,
      requestedAt,
      dueBy,
      sessionsRevoked: outcome.sessionsRevoked,
    };
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * Loads a consumer or refuses with `USER_NOT_FOUND`.
   *
   * An admin's id addressed through `/admin/consumers/**` is a 404, not a 403:
   * these routes are the consumer section, and confirming "that id exists, it just
   * isn't a consumer" tells a caller something they did not ask for (S-9).
   */
  private async requireConsumer(userId: string): Promise<User> {
    const user = await this.consumerQuery.findConsumer(userId);
    if (user === null) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }
    return user;
  }

  /**
   * A-19 / D-7: tell her what happened, what is safe, and who to ask.
   *
   * A failed send never fails the suspension — `NotificationsService` resolves
   * rather than rejects, and the outcome is logged (E-11).
   *
   * **Seam:** once `NotificationsModule`'s outbox lands (§4.32) this becomes an
   * outbox row written inside the transaction and delivered by the processor,
   * which survives a crash between the commit and the send.
   */
  private async notifySuspended(target: User, suspendedAt: Date, reason: string): Promise<void> {
    const result = await this.notifications.sendTemplatedEmail({
      to: target.email,
      template: TemplateId.ACCOUNT_SUSPENDED,
      props: { consumerName: target.name, suspendedAt, reason },
      locale: target.locale,
    });

    if (!result.ok) {
      this.logger.warn(
        `Suspension email for user ${target.id} was not delivered (${result.failure?.code ?? 'UNKNOWN'}). ` +
          'The suspension itself is committed.',
      );
    }
  }
}

/**
 * D-17's confirmation, compared the way a person types rather than the way a
 * database stores: case-insensitive, and tolerant of the double space between
 * "Ayesha  Khan" that nobody can see.
 */
function namesMatch(typed: string, actual: string): boolean {
  const normalise = (value: string): string =>
    value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return normalise(typed) === normalise(actual) && normalise(actual) !== '';
}
