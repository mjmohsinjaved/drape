import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { User } from '@api/modules/users/entities/user.entity';
import { ROLE_ENUM_VALUES, Role } from '@api/modules/users/enums/role.enum';

/**
 * ARCHITECTURE §4.5 — `sessions`.
 *
 * Rows are hard-deleted by the retention cron 30 days after `absoluteExpiresAt`.
 */
@Index('UQ_sessions_tokenHash', ['tokenHash'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('IDX_sessions_userId_revokedAt', ['userId', 'revokedAt'])
@Index('IDX_sessions_expiresAt', ['expiresAt'])
@Entity('sessions')
export class Session extends BaseEntity {
  @Column({ type: 'uuid' })
  userId: string;

  /** sha256 of the opaque 32-byte cookie value; the raw value is never stored. */
  @Column({ type: 'char', length: 64 })
  tokenHash: string;

  /** Random hex, HMAC key for the double-submit token. */
  @Column({ type: 'char', length: 64 })
  csrfSecret: string;

  /** Snapshot for fast reads; `users.role` remains authoritative and is re-read every request. */
  @Column({ type: 'enum', enum: ROLE_ENUM_VALUES, enumName: 'role_enum' })
  role: Role;

  @Column({ type: 'inet' })
  ip: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;

  /** Sliding idle expiry: +12 h admin, +30 d consumer (S-7). */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Hard ceiling: +7 d admin, +90 d consumer. */
  @Column({ type: 'timestamptz' })
  absoluteExpiresAt: Date;

  /** Set at login when 2FA is on; only `/auth/2fa/challenge` is reachable. */
  @Column({ type: 'boolean', default: false })
  twofaPending: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  twofaVerifiedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  /** `LOGOUT`, `LOGOUT_ALL`, `PASSWORD_CHANGED`, `DEACTIVATED`, `SUSPENDED`, `ADMIN_REVOKED`. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  revokedReason: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;
}
