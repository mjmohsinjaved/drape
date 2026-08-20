import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository, type EntityManager } from 'typeorm';

import {
  ConflictException,
  ErrorCode,
  Locale,
  MILLISECONDS_PER_HOUR,
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

const EMPTY_DELETION_MANIFEST_HASH = sha256Hex('');

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

  async list(query: ConsumerQueryDto): Promise<IPaginated<ConsumerListItemResponseDto>> {
    const page = await this.consumerQuery.listConsumers(query);
    return { items: page.items.map(toConsumerListItem), meta: page.meta };
  }

  async findOne(userId: string): Promise<ConsumerDetailResponseDto> {
    const row = await this.consumerQuery.findConsumerDetail(userId);
    if (row === null) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }
    return toConsumerDetail(row);
  }

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

  async listShortlist(
    userId: string,
    query: ConsumerShortlistQueryDto,
  ): Promise<IPaginated<ConsumerShortlistItemResponseDto>> {
    await this.requireConsumer(userId);

    const page = await this.consumerQuery.listShortlist(userId, query);
    return { items: page.items.map(toConsumerShortlistItem), meta: page.meta };
  }

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

    this.assertNotBeingDeleted(target);

    const suspendedAt = new Date();
    const previousStatus = target.status;
    const sessionsRevoked = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<number> => {
        await manager.getRepository(User).update(
          { id: userId },
          {
            status: UserStatus.SUSPENDED,
            suspendedReason: dto.reason ?? null,
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
      reason: dto.reason ?? null,
      sessionsRevoked,
    };
    this.events.emit(USER_EVENTS.SUSPENDED, event);

    await this.notifySuspended(target, suspendedAt, dto.reason ?? null);

    return this.findOne(userId);
  }

  async approve(actor: ICurrentUser, userId: string): Promise<ConsumerDetailResponseDto> {
    const target = await this.requireConsumer(userId);

    if (target.status !== UserStatus.PENDING_APPROVAL) {
      throw new ConflictException(ErrorCode.RESOURCE_CONFLICT, {
        message: 'This account is not waiting for approval.',
      });
    }

    this.assertNotBeingDeleted(target);

    await this.users.update(
      { id: userId },
      { status: UserStatus.ACTIVE, suspendedReason: null, suspendedAt: null },
    );

    const event: UserStatusChangedEvent = {
      userId,
      actorId: actor.id,
      occurredAt: new Date(),
      from: UserStatus.PENDING_APPROVAL,
      to: UserStatus.ACTIVE,
      reason: null,
      sessionsRevoked: 0,
    };
    this.events.emit(USER_EVENTS.APPROVED, event);

    await this.notifyApproved(target);

    return this.findOne(userId);
  }

  async unsuspend(actor: ICurrentUser, userId: string): Promise<ConsumerDetailResponseDto> {
    const target = await this.requireConsumer(userId);

    if (target.status !== UserStatus.SUSPENDED) {
      throw new ConflictException(ErrorCode.RESOURCE_CONFLICT, {
        message: 'This account is not on hold.',
      });
    }

    this.assertNotBeingDeleted(target);

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

  private async requireConsumer(userId: string): Promise<User> {
    const user = await this.consumerQuery.findConsumer(userId);
    if (user === null) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }
    return user;
  }

  private assertNotBeingDeleted(target: User): void {
    if (target.deletionRequestedAt !== null) {
      throw new ConflictException(ErrorCode.DELETION_IN_PROGRESS);
    }
  }

  private async notifyApproved(target: User): Promise<void> {
    const webUrl = stripTrailingSlashes(this.config.get<string>('APP_WEB_URL') ?? '');
    const locale = target.locale === Locale.UR ? 'ur' : 'en';

    const result = await this.notifications.sendTemplatedEmail({
      to: target.email,
      template: TemplateId.ACCOUNT_APPROVED,
      props: { consumerName: target.name, signInUrl: `${webUrl}/${locale}/login` },
      locale: target.locale,
    });

    if (!result.ok) {
      this.logger.warn(
        `Approval email for user ${target.id} was not delivered (${result.failure?.code ?? 'UNKNOWN'}). ` +
          'The approval itself is committed.',
      );
    }
  }

  private async notifySuspended(
    target: User,
    suspendedAt: Date,
    reason: string | null,
  ): Promise<void> {
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

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function namesMatch(typed: string, actual: string): boolean {
  const normalise = (value: string): string =>
    value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return normalise(typed) === normalise(actual) && normalise(actual) !== '';
}
