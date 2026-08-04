import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { Garment } from '@api/modules/garments/entities/garment.entity';
import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { User } from '@api/modules/users/entities/user.entity';

import { JobOrigin } from '../enums/job-origin.enum';
import { JobStatus } from '../enums/job-status.enum';

import { ReferenceModel } from './reference-model.entity';

/**
 * ARCHITECTURE §4.17 — `tryon_jobs`.
 *
 * `UQ_tryon_jobs_idem` is the idempotency mechanism: a duplicate insert raises a
 * unique violation, which the service converts to `IDEMPOTENCY_IN_FLIGHT` when
 * the existing job is `QUEUED`/`RUNNING`, or returns the completed result when it
 * is `SUCCEEDED`. Jobs are prunable after 90 days — which is exactly why
 * `tryon_results` carries its own denormalised columns.
 */
@Index('UQ_tryon_jobs_idem', ['userId', 'idempotencyKey'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_tryon_jobs_userId_status', ['userId', 'status'])
@Index('IDX_tryon_jobs_status_createdAt', ['status', 'createdAt'])
@Index('IDX_tryon_jobs_batchId', ['batchId'])
@Index('IDX_tryon_jobs_garmentId', ['garmentId'])
@Index('IDX_tryon_jobs_personPhotoId', ['personPhotoId'])
@Index('IDX_tryon_jobs_referenceModelId', ['referenceModelId'])
@Entity('tryon_jobs')
export class TryOnJob extends BaseEntity {
  /** The consumer, or the admin who ran the test render. */
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid', nullable: true })
  garmentId: string | null;

  @Column({ type: 'uuid', nullable: true })
  personPhotoId: string | null;

  /** Set instead of `personPhotoId` for a test render. */
  @Column({ type: 'uuid', nullable: true })
  referenceModelId: string | null;

  @Column({ type: 'enum', enum: JobOrigin, enumName: 'job_origin_enum' })
  origin: JobOrigin;

  /** Kept per PRD §12; always equals `origin = TEST_RENDER`. */
  @Column({ type: 'boolean', default: false })
  isTestRender: boolean;

  /** Client-supplied (§8.1 step 1). */
  @Column({ type: 'varchar', length: 80 })
  idempotencyKey: string;

  @Column({
    type: 'enum',
    enum: JobStatus,
    enumName: 'job_status_enum',
    default: JobStatus.QUEUED,
  })
  status: JobStatus;

  @Column({ type: 'boolean', default: false })
  cacheHit: boolean;

  @Column({ type: 'char', length: 64, nullable: true })
  cacheKey: string | null;

  /** An `ErrorCode` value. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  errorCode: string | null;

  /** Max 3 (§8.3). */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** A-12 bulk test renders. */
  @Column({ type: 'uuid', nullable: true })
  batchId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  /** Feeds `tryon.latency_ms` (E-13). */
  @Column({ type: 'int', nullable: true })
  durationMs: number | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => Garment, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'garmentId' })
  garment: Garment | null;

  @ManyToOne(() => PersonPhoto, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'personPhotoId' })
  personPhoto: PersonPhoto | null;

  @ManyToOne(() => ReferenceModel, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'referenceModelId' })
  referenceModel: ReferenceModel | null;
}
