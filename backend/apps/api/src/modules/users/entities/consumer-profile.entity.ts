import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { BudgetBand } from '../enums/budget-band.enum';
import { EventType } from '../enums/event-type.enum';

import { User } from './user.entity';

/** C-7 notification preferences, stored as `jsonb`. */
export interface NotificationPreferences {
  /** default true */
  emailOnResultReady: boolean;
  /** default true */
  emailOnEnquiryUpdate: boolean;
  /** default false */
  emailOnNewArrivals: boolean;
  /** default false */
  smsOnEnquiryUpdate: boolean;
}

/** ARCHITECTURE §4.4 — `consumer_profiles`. */
@Index('UQ_consumer_profiles_userId', ['userId'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Entity('consumer_profiles')
export class ConsumerProfile extends BaseEntity {
  @Column({ type: 'uuid' })
  userId: string;

  /** True calendar date, not a timestamp (§4.0 rule 2). */
  @Column({ type: 'date', nullable: true })
  eventDate: Date | null;

  @Column({ type: 'enum', enum: EventType, enumName: 'event_type_enum', nullable: true })
  eventType: EventType | null;

  @Column({ type: 'enum', enum: BudgetBand, enumName: 'budget_band_enum', nullable: true })
  budgetBand: BudgetBand | null;

  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  preferredCategories: string[];

  /** A-18 — null means use the global default. */
  @Column({ type: 'int', nullable: true })
  monthlyQuotaOverride: number | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  notificationPreferences: NotificationPreferences;

  @Column({ type: 'timestamptz', nullable: true })
  onboardingCompletedAt: Date | null;

  @OneToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;
}
