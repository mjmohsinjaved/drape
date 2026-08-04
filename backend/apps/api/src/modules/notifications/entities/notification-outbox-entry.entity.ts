import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { User } from '@api/modules/users/entities/user.entity';
import { Locale } from '@api/modules/users/enums/locale.enum';

import { NotificationChannel } from '../enums/notification-channel.enum';
import { NotificationStatus } from '../enums/notification-status.enum';

/**
 * ARCHITECTURE §4.32 — `notifications_outbox`.
 *
 * Written inside the same transaction as the business change (transactional
 * outbox), drained every 10 seconds by `notifications/processors/outbox.processor.ts`
 * with exponential backoff and a cap of 5 attempts. `channel = IN_APP` rows are the
 * in-app notification store — there is no second table.
 */
@Index('IDX_notifications_outbox_status_availableAt', ['status', 'availableAt'], {
  where: `"status" = 'PENDING'`,
})
@Index('IDX_notifications_outbox_recipient_read', ['recipientUserId', 'readAt'])
@Index('UQ_notifications_outbox_dedupe', ['dedupeKey'], {
  unique: true,
  where: '"dedupeKey" IS NOT NULL AND "deletedAt" IS NULL',
})
@Entity('notifications_outbox')
export class NotificationOutboxEntry extends BaseEntity {
  @Column({
    type: 'enum',
    enum: NotificationChannel,
    enumName: 'notification_channel_enum',
  })
  channel: NotificationChannel;

  /** Closed registry, e.g. `RESULT_READY`, `ENQUIRY_RECEIVED`, `BUDGET_BACK`. */
  @Column({ type: 'varchar', length: 80 })
  template: string;

  @Column({ type: 'enum', enum: Locale, enumName: 'locale_enum' })
  locale: Locale;

  @Column({ type: 'uuid', nullable: true })
  recipientUserId: string | null;

  /** Email or E.164; null for `IN_APP`. */
  @Column({ type: 'varchar', length: 320, nullable: true })
  recipientAddress: string | null;

  /** Template variables only, never a photo key. */
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: NotificationStatus,
    enumName: 'notification_status_enum',
    default: NotificationStatus.PENDING,
  })
  status: NotificationStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** Backoff schedule. */
  @Column({ type: 'timestamptz' })
  availableAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  /** `IN_APP` only. */
  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  lastError: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  dedupeKey: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'recipientUserId' })
  recipient: User | null;
}
