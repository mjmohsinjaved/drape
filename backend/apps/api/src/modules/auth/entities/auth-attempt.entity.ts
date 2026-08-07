import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AppendOnlyEntity } from '@library/database';

import { User } from '@api/modules/users/entities/user.entity';

import { AuthOutcome } from '../enums/auth-outcome.enum';

/**
 * ARCHITECTURE §4.7 — `auth_attempts` · **append-only**.
 *
 * Backoff (S-6): lockout after 5 failures inside 15 minutes,
 * `lockedUntil = now + 2^(n-5)` minutes capped at 60, counted per `emailHash`
 * **and** per `ip` independently.
 *
 * No unique index. No `deletedAt` — see `AppendOnlyEntity` (§2.1).
 */
@Index('IDX_auth_attempts_emailHash_createdAt', ['emailHash', 'createdAt'])
@Index('IDX_auth_attempts_ip_createdAt', ['ip', 'createdAt'])
@Index('IDX_auth_attempts_outcome_createdAt', ['outcome', 'createdAt'])
@Index('IDX_auth_attempts_userId', ['userId'])
@Entity('auth_attempts')
export class AuthAttempt extends AppendOnlyEntity {
  /** sha256 of the lower-cased email; the address itself is never stored here (E-12). */
  @Column({ type: 'char', length: 64 })
  emailHash: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'inet' })
  ip: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  @Column({ type: 'enum', enum: AuthOutcome, enumName: 'auth_outcome_enum' })
  outcome: AuthOutcome;

  /** `LOGIN`, `SIGNUP`, `PASSWORD_RESET`, `OTP`. Retired rows may also carry `TWOFA`. */
  @Column({ type: 'varchar', length: 64 })
  route: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User | null;
}
