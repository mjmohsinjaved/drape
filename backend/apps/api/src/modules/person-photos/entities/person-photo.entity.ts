import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { User } from '@api/modules/users/entities/user.entity';

import { PhotoModerationState } from '../enums/photo-moderation-state.enum';

/**
 * ARCHITECTURE §4.16 — `person_photos`.
 *
 * **No admin-facing query may ever select `storageKey` from this table** (S-10).
 * The consumer-management repository methods select an explicit column list that
 * excludes it, and an E-7 test asserts the serialized admin response contains no
 * `person-photos/` key and no signed URL for one.
 */
@Index('UQ_person_photos_active', ['userId'], {
  unique: true,
  where: '"isActive" = true AND "deletedAt" IS NULL',
})
@Index('IDX_person_photos_userId', ['userId'])
@Index('IDX_person_photos_purgeAfter', ['purgeAfter'])
@Index('IDX_person_photos_hash', ['hash'])
@Entity('person_photos')
export class PersonPhoto extends BaseEntity {
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 512 })
  storageKey: string;

  /** The **only** derivative an admin can ever see (S-10, A-34). */
  @Column({ type: 'varchar', length: 512, nullable: true })
  blurredThumbnailKey: string | null;

  /** The `personPhotoHash` half of the cache key (§3.7). */
  @Column({ type: 'char', length: 64 })
  hash: string;

  /** C-16. */
  @Column({ type: 'boolean', default: false })
  isActive: boolean;

  /** User-chosen, e.g. "daylight". */
  @Column({ type: 'varchar', length: 60, nullable: true })
  label: string | null;

  @Column({ type: 'timestamptz' })
  uploadedAt: Date;

  /** `users.lastActiveAt + 30 days`, recomputed by the purge cron (§9.3). */
  @Column({ type: 'timestamptz' })
  purgeAfter: Date;

  @Column({
    type: 'enum',
    enum: PhotoModerationState,
    enumName: 'photo_moderation_state_enum',
    default: PhotoModerationState.PENDING,
  })
  moderationState: PhotoModerationState;

  @Column({ type: 'int' })
  width: number;

  @Column({ type: 'int' })
  height: number;

  @Column({ type: 'int' })
  byteSize: number;

  @Column({ type: 'varchar', length: 64 })
  mimeType: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;
}
