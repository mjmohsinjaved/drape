import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { Locale } from '../enums/locale.enum';
import { ROLE_ENUM_VALUES, Role } from '../enums/role.enum';
import { UserStatus } from '../enums/user-status.enum';

/**
 * ARCHITECTURE §4.3 — `users`.
 *
 * One table holds both roles (PRD §12). There is no separate admins table and no
 * code path where `/signup` can produce `role = ADMIN` (S-4).
 *
 * `UQ_users_email UNIQUE (lower("email")) WHERE "deletedAt" IS NULL` is an
 * expression index and therefore lives only in the migration — TypeORM cannot
 * express it on the entity.
 */
@Index('IDX_users_role_status', ['role', 'status'])
@Index('IDX_users_lastActiveAt', ['lastActiveAt'])
@Index('UQ_users_phone', ['phone'], {
  unique: true,
  where: '"phone" IS NOT NULL AND "deletedAt" IS NULL',
})
@Index('IDX_users_invitedBy', ['invitedBy'])
@Entity('users')
export class User extends BaseEntity {
  @Column({ type: 'enum', enum: ROLE_ENUM_VALUES, enumName: 'role_enum' })
  role: Role;

  /** Stored lower-cased and trimmed. */
  @Column({ type: 'varchar', length: 320 })
  email: string;

  @Column({ type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  /** Argon2id (S-6). */
  @Column({ type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** E.164. */
  @Column({ type: 'varchar', length: 24, nullable: true })
  phone: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  phoneVerifiedAt: Date | null;

  /** AES-256-GCM ciphertext under `TWOFA_ENCRYPTION_KEY`, never plaintext. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  twofaSecret: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  twofaEnabledAt: Date | null;

  /** bcrypt hashes. */
  @Column({ type: 'text', array: true, nullable: true })
  twofaRecoveryCodes: string[] | null;

  @Column({
    type: 'enum',
    enum: UserStatus,
    enumName: 'user_status_enum',
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  /** A-19 — required on suspend. */
  @Column({ type: 'text', nullable: true })
  suspendedReason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  suspendedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  invitedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  /** Drives A-16 and the §9.3 30-day photo purge. */
  @Column({ type: 'timestamptz', nullable: true })
  lastActiveAt: Date | null;

  @Column({ type: 'int', default: 0 })
  failedLoginCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  @Column({ type: 'enum', enum: Locale, enumName: 'locale_enum', default: Locale.EN })
  locale: Locale;

  /** C-38 — purge completes within 24 h. */
  @Column({ type: 'timestamptz', nullable: true })
  deletionRequestedAt: Date | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'invitedBy' })
  inviter: User | null;
}
