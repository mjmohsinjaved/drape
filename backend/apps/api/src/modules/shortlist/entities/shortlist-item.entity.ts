import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { Garment } from '@api/modules/garments/entities/garment.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { User } from '@api/modules/users/entities/user.entity';

import { RejectReason } from '../enums/reject-reason.enum';
import { Verdict } from '../enums/verdict.enum';

/**
 * ARCHITECTURE §4.20 — `shortlist_items`.
 *
 * **Verdict semantics.** Every verdict from the result view (C-20) upserts one row
 * keyed `(userId, garmentId)`.
 * - The Shortlist screen shows `LOVE_IT` and `MAYBE`, ordered by `rank`.
 * - `NOT_FOR_ME` rows are retained for A-38 rejection-reason analytics; they never
 *   appear on the shortlist, never count toward the budget total, and are excluded
 *   from enquiries.
 * - Changing a verdict updates the same row. There is no second verdict column
 *   anywhere.
 */
@Index('UQ_shortlist_items_user_garment', ['userId', 'garmentId'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_shortlist_items_userId_rank', ['userId', 'rank'])
@Index('IDX_shortlist_items_garmentId_verdict', ['garmentId', 'verdict'])
@Index('IDX_shortlist_items_latestResultId', ['latestResultId'])
@Entity('shortlist_items')
export class ShortlistItem extends BaseEntity {
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid' })
  garmentId: string;

  @Column({ type: 'enum', enum: Verdict, enumName: 'verdict_enum' })
  verdict: Verdict;

  /** Drag-to-rank (C-32); null for `NOT_FOR_ME`. */
  @Column({ type: 'int', nullable: true })
  rank: number | null;

  /** C-21. */
  @Column({
    type: 'enum',
    enum: RejectReason,
    enumName: 'reject_reason_enum',
    nullable: true,
  })
  rejectReason: RejectReason | null;

  /** Per-item note (C-32). */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** The render shown beside the item. */
  @Column({ type: 'uuid', nullable: true })
  latestResultId: string | null;

  @Column({ type: 'timestamptz' })
  verdictAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => Garment, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'garmentId' })
  garment: Garment;

  @ManyToOne(() => TryOnResult, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'latestResultId' })
  latestResult: TryOnResult | null;
}
