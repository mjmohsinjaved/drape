import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { User } from '@api/modules/users/entities/user.entity';
import { ROLE_ENUM_VALUES, Role } from '@api/modules/users/enums/role.enum';

/** ARCHITECTURE §4.9 — `invites` (S-5). */
@Index('UQ_invites_tokenHash', ['tokenHash'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('UQ_invites_email_pending', ['email'], {
  unique: true,
  where: '"consumedAt" IS NULL AND "deletedAt" IS NULL',
})
@Index('IDX_invites_invitedBy', ['invitedBy'])
@Index('IDX_invites_consumedByUserId', ['consumedByUserId'])
@Entity('invites')
export class Invite extends BaseEntity {
  /** Lower-cased. */
  @Column({ type: 'varchar', length: 320 })
  email: string;

  /** Always `ADMIN` in V1 (S-5). */
  @Column({ type: 'enum', enum: ROLE_ENUM_VALUES, enumName: 'role_enum' })
  role: Role;

  @Column({ type: 'char', length: 64 })
  tokenHash: string;

  /** 7 days. */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @Column({ type: 'uuid' })
  invitedBy: string;

  @Column({ type: 'uuid', nullable: true })
  consumedByUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'invitedBy' })
  inviter: User;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'consumedByUserId' })
  consumedByUser: User | null;
}
