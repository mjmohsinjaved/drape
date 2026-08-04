import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { User } from '@api/modules/users/entities/user.entity';

/** ARCHITECTURE §4.8 — `ip_blocks` (A-35). */
@Index('UQ_ip_blocks_cidr', ['cidr'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('IDX_ip_blocks_createdBy', ['createdBy'])
@Entity('ip_blocks')
export class IpBlock extends BaseEntity {
  @Column({ type: 'cidr' })
  cidr: string;

  @Column({ type: 'varchar', length: 255 })
  reason: string;

  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  /** Null means indefinite. */
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdBy' })
  creator: User | null;
}
