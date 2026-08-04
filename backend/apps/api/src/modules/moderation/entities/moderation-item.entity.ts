import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';
import { User } from '@api/modules/users/entities/user.entity';

import { ModerationSource } from '../enums/moderation-source.enum';
import { ModerationState } from '../enums/moderation-state.enum';

/**
 * ARCHITECTURE §4.29 — `moderation_items` (A-34).
 *
 * Every read of the list **and** every read of a blurred thumbnail writes
 * `MODERATION_ITEM_VIEWED` to `audit_log` (A-34, §9.3).
 */
@Index('IDX_moderation_items_state_createdAt', ['state', 'createdAt'])
@Index('IDX_moderation_items_userId', ['userId'])
@Index('UQ_moderation_items_photo_pending', ['personPhotoId'], {
  unique: true,
  where: `"state" = 'PENDING' AND "deletedAt" IS NULL`,
})
@Index('IDX_moderation_items_personPhotoId', ['personPhotoId'])
@Index('IDX_moderation_items_jobId', ['jobId'])
@Index('IDX_moderation_items_reviewedBy', ['reviewedBy'])
@Entity('moderation_items')
export class ModerationItem extends BaseEntity {
  @Column({ type: 'uuid', nullable: true })
  personPhotoId: string | null;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'uuid', nullable: true })
  jobId: string | null;

  @Column({
    type: 'enum',
    enum: ModerationSource,
    enumName: 'moderation_source_enum',
  })
  source: ModerationSource;

  /** Upstream code or internal heuristic id. */
  @Column({ type: 'varchar', length: 64 })
  reasonCode: string;

  @Column({
    type: 'enum',
    enum: ModerationState,
    enumName: 'moderation_state_enum',
    default: ModerationState.PENDING,
  })
  state: ModerationState;

  /** The only image an admin may open (A-34). */
  @Column({ type: 'varchar', length: 512, nullable: true })
  blurredThumbnailKey: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  decisionNote: string | null;

  @ManyToOne(() => PersonPhoto, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'personPhotoId' })
  personPhoto: PersonPhoto | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  @ManyToOne(() => TryOnJob, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'jobId' })
  job: TryOnJob | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reviewedBy' })
  reviewer: User | null;
}
