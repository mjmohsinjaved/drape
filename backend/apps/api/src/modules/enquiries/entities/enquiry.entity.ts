import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity, decimalTransformer } from '@library/database';

import { User } from '@api/modules/users/entities/user.entity';
import { BudgetBand } from '@api/modules/users/enums/budget-band.enum';
import { EventType } from '@api/modules/users/enums/event-type.enum';

import { EnquiryStatus } from '../enums/enquiry-status.enum';

/**
 * ARCHITECTURE §4.23 — `enquiries`.
 *
 * Transitions: `NEW → CONTACTED → IN_DISCUSSION → CLOSED_WON | CLOSED_LOST`;
 * `NEW → CLOSED_LOST` is allowed. Anything else is `INVALID_ENQUIRY_TRANSITION`.
 */
@Index('UQ_enquiries_reference', ['reference'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('IDX_enquiries_status_createdAt', ['status', 'createdAt'])
@Index('IDX_enquiries_userId_createdAt', ['userId', 'createdAt'])
@Index('IDX_enquiries_firstRespondedAt', ['firstRespondedAt'], {
  where: '"firstRespondedAt" IS NULL',
})
@Index('IDX_enquiries_assignedTo', ['assignedTo'])
@Entity('enquiries')
export class Enquiry extends BaseEntity {
  /** `ENQ-2026-000137`, shown to both sides. */
  @Column({ type: 'varchar', length: 20 })
  reference: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'text' })
  message: string;

  @Column({
    type: 'enum',
    enum: EnquiryStatus,
    enumName: 'enquiry_status_enum',
    default: EnquiryStatus.NEW,
  })
  status: EnquiryStatus;

  /** Required on `CLOSED_LOST` (A-22). */
  @Column({ type: 'text', nullable: true })
  lostReason: string | null;

  /** True calendar date, not a timestamp (§4.0 rule 2). */
  @Column({ type: 'date', nullable: true })
  eventDate: Date | null;

  @Column({ type: 'enum', enum: EventType, enumName: 'event_type_enum', nullable: true })
  eventType: EventType | null;

  @Column({ type: 'enum', enum: BudgetBand, enumName: 'budget_band_enum', nullable: true })
  budgetBand: BudgetBand | null;

  /** Snapshot at submission (A-21). */
  @Column({ type: 'varchar', length: 120 })
  contactName: string;

  /** Verified address. */
  @Column({ type: 'varchar', length: 320 })
  contactEmail: string;

  /** Verified, C-3 gate. */
  @Column({ type: 'varchar', length: 24 })
  contactPhone: string;

  /** A-25 24-hour stale highlight. */
  @Column({ type: 'timestamptz', nullable: true })
  firstRespondedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  assignedTo: string | null;

  /** Sum of item prices at submission. */
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  totalValueSnapshot: number | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assignedTo' })
  assignee: User | null;
}
