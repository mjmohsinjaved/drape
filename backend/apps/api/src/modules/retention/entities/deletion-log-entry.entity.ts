import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AppendOnlyEntity } from '@library/database';

import { User } from '@api/modules/users/entities/user.entity';

import { DeletionInitiator } from '../enums/deletion-initiator.enum';
import { DeletionSubject } from '../enums/deletion-subject.enum';

/**
 * ARCHITECTURE §4.31 — `deletion_log` · **append-only**.
 *
 * The "verifiable deletion log" of §9.3 / A-20.
 */
@Index('IDX_deletion_log_subject', ['subjectType', 'subjectId'])
@Index('IDX_deletion_log_completedAt', ['completedAt'], { where: '"completedAt" IS NULL' })
@Index('IDX_deletion_log_userId', ['userId'])
@Index('IDX_deletion_log_actorId', ['actorId'])
@Entity('deletion_log')
export class DeletionLogEntry extends AppendOnlyEntity {
  @Column({
    type: 'enum',
    enum: DeletionSubject,
    enumName: 'deletion_subject_enum',
  })
  subjectType: DeletionSubject;

  /** Retained after the row itself is gone. */
  @Column({ type: 'uuid' })
  subjectId: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({
    type: 'enum',
    enum: DeletionInitiator,
    enumName: 'deletion_initiator_enum',
  })
  initiatedBy: DeletionInitiator;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'timestamptz' })
  requestedAt: Date;

  /** Must be within 24 h of `requestedAt` (C-38, A-20). */
  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  /** e.g. `{ "tryon_results": 42, "person_photos": 3 }`. */
  @Column({ type: 'jsonb' })
  rowsDeleted: Record<string, number>;

  @Column({ type: 'int' })
  storageKeysDeleted: number;

  /** `bigint` comes back from pg as a string; it is never arithmetic in the API. */
  @Column({ type: 'bigint' })
  bytesReclaimed: string;

  /** sha256 of the sorted deleted-key list; the "verifiable" in §9.3. */
  @Column({ type: 'char', length: 64 })
  verificationHash: string;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actorId' })
  actor: User | null;
}
