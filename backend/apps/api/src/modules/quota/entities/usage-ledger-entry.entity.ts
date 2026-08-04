import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AppendOnlyEntity } from '@library/database';

import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';
import { User } from '@api/modules/users/entities/user.entity';

import { UsageReason } from '../enums/usage-reason.enum';

/**
 * ARCHITECTURE §4.27 — `usage_ledger` · **append-only**.
 *
 * **There is no stored balance column** (§4.0 rule 10). The authoritative remaining
 * budget is always `SELECT SUM(delta) FROM usage_ledger WHERE period = $1`.
 *
 * Consumer try-ons (`CONSUMER_GENERATION`) and admin test renders (`TEST_RENDER`)
 * are separate reasons so A-33 can split them. Cache hits write **no** ledger row in
 * either table (C-22, §8.4).
 *
 * `UQ_usage_ledger_job` carries no `deletedAt` predicate — this table is append-only.
 */
@Index('IDX_usage_ledger_period_createdAt', ['period', 'createdAt'])
@Index('UQ_usage_ledger_job', ['jobId'], { unique: true, where: '"jobId" IS NOT NULL' })
@Index('IDX_usage_ledger_userId', ['userId'])
@Index('IDX_usage_ledger_actorId', ['actorId'])
@Entity('usage_ledger')
export class UsageLedgerEntry extends AppendOnlyEntity {
  @Column({ type: 'int' })
  delta: number;

  @Column({ type: 'enum', enum: UsageReason, enumName: 'usage_reason_enum' })
  reason: UsageReason;

  /** `YYYY-MM` in `Asia/Karachi`. */
  @Column({ type: 'char', length: 7 })
  period: string;

  @Column({ type: 'uuid', nullable: true })
  jobId: string | null;

  /** Who caused it, for the A-33 split. */
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  /**
   * **Advisory snapshot only.** Exists because PRD §12 lists it; it is a convenience
   * for the A-33 burn-rate chart and is never the authority. Any code that reads
   * `balanceAfter` to make a decision is a bug (§4.27).
   */
  @Column({ type: 'int' })
  balanceAfter: number;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @ManyToOne(() => TryOnJob, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'jobId' })
  job: TryOnJob | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actorId' })
  actor: User | null;
}
