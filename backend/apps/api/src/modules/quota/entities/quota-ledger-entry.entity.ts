import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AppendOnlyEntity } from '@library/database';

import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';
import { User } from '@api/modules/users/entities/user.entity';

import { QuotaReason } from '../enums/quota-reason.enum';

/**
 * ARCHITECTURE §4.26 — `quota_ledger` · **append-only**.
 *
 * **There is no stored balance column and there never will be one** (§4.0 rule 10).
 * Remaining quota is derived:
 *
 * ```sql
 * SELECT COALESCE(SUM(delta), 0) FROM quota_ledger WHERE "userId" = $1 AND period = $2;
 * ```
 *
 * The monthly grant is lazy: the first quota read in a new period inserts a
 * `MONTHLY_GRANT` row of
 * `consumer_profiles.monthlyQuotaOverride ?? settings['quota.defaultMonthly']`
 * inside a transaction guarded by the same period. Raising an override mid-period
 * appends an `OVERRIDE_GRANT` for the difference — it never rewrites the earlier row.
 *
 * `UQ_quota_ledger_job` carries **no `deletedAt` predicate** — this table is
 * append-only and has no `deletedAt`. That index is what makes a double consumption
 * physically impossible.
 */
@Index('IDX_quota_ledger_userId_period', ['userId', 'period'])
@Index('UQ_quota_ledger_job', ['jobId'], { unique: true, where: '"jobId" IS NOT NULL' })
@Index('IDX_quota_ledger_actorId', ['actorId'])
@Entity('quota_ledger')
export class QuotaLedgerEntry extends AppendOnlyEntity {
  @Column({ type: 'uuid' })
  userId: string;

  /** Positive grants, negative consumption. */
  @Column({ type: 'int' })
  delta: number;

  @Column({ type: 'enum', enum: QuotaReason, enumName: 'quota_reason_enum' })
  reason: QuotaReason;

  /** `YYYY-MM` in `Asia/Karachi`. */
  @Column({ type: 'char', length: 7 })
  period: string;

  @Column({ type: 'uuid', nullable: true })
  jobId: string | null;

  /** The admin, for `ADMIN_ADJUSTMENT`. */
  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => TryOnJob, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'jobId' })
  job: TryOnJob | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actorId' })
  actor: User | null;
}
