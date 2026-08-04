import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity, decimalTransformer } from '@library/database';

import { Garment } from '@api/modules/garments/entities/garment.entity';
import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';
import { User } from '@api/modules/users/entities/user.entity';

/**
 * ARCHITECTURE §4.18 — `tryon_results`. **The critical table.**
 * C-24 through C-31 all rest on it.
 *
 * All four foreign keys are nullable with `ON DELETE SET NULL` so history
 * survives photo deletion, job pruning and garment removal:
 *
 * - `personPhotoId` SET NULL + `personPhotoLabelSnapshot` — C-28: a render
 *   survives deletion or replacement of the photo it came from.
 * - `garmentId` SET NULL + the garment snapshots — C-29: a render stays in
 *   history when the garment is unpublished, archived or removed. **The history
 *   list renders exclusively from the snapshots** — it does not join `garments`.
 * - `jobId` SET NULL — jobs are pruned after 90 days; history is permanent (C-27).
 * - `userId` SET NULL — ownership is a single predicate. On account deletion the
 *   rows are hard-deleted along with their files, not orphaned; SET NULL is the
 *   safety net that keeps a foreign-key error from ever blocking a deletion.
 *
 * `deletedAt` (from `BaseEntity`) is how C-31 individual deletion works: soft-delete
 * the row, hard-delete the file and thumbnail immediately, write a `deletion_log`
 * row. **Renders carry no expiry** — there is deliberately no `purgeAfter` here
 * (C-27, §9.3).
 *
 * Verdicts are **not** stored here. They live on `shortlist_items`, keyed by
 * `(userId, garmentId)`, and the history DTO joins them in (§4.20).
 */
@Index('IDX_tryon_results_userId_createdAt', ['userId', 'createdAt'])
@Index('IDX_tryon_results_userId_garmentId', ['userId', 'garmentId'])
@Index('IDX_tryon_results_personPhotoId', ['personPhotoId'])
@Index('IDX_tryon_results_cacheKey', ['cacheKey'])
@Index('IDX_tryon_results_jobId', ['jobId'])
@Index('IDX_tryon_results_garmentId', ['garmentId'])
@Entity('tryon_results')
export class TryOnResult extends BaseEntity {
  @Column({ type: 'uuid', nullable: true })
  jobId: string | null;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'uuid', nullable: true })
  garmentId: string | null;

  @Column({ type: 'uuid', nullable: true })
  personPhotoId: string | null;

  /** The unwatermarked render, `renders/<userId>/<uuid>.png`. */
  @Column({ type: 'varchar', length: 512 })
  storageKey: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  thumbnailKey: string | null;

  @Column({ type: 'char', length: 64 })
  cacheKey: string;

  @Column({ type: 'varchar', length: 160 })
  garmentTitleSnapshot: string;

  @Column({ type: 'varchar', length: 80 })
  garmentCategorySnapshot: string;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  garmentPriceSnapshot: number | null;

  @Column({ type: 'char', length: 3, default: 'PKR' })
  garmentCurrencySnapshot: string;

  /** Lets C-30 grouping survive photo deletion. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  personPhotoLabelSnapshot: string | null;

  @Column({ type: 'boolean', default: false })
  isTestRender: boolean;

  @Column({ type: 'int' })
  width: number;

  @Column({ type: 'int' })
  height: number;

  @Column({ type: 'int' })
  byteSize: number;

  /** §9.3 per-render explicit opt-in for brand marketing. */
  @Column({ type: 'timestamptz', nullable: true })
  marketingOptInAt: Date | null;

  @ManyToOne(() => TryOnJob, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'jobId' })
  job: TryOnJob | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  @ManyToOne(() => Garment, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'garmentId' })
  garment: Garment | null;

  @ManyToOne(() => PersonPhoto, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'personPhotoId' })
  personPhoto: PersonPhoto | null;
}
