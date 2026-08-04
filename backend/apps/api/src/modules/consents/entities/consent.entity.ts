import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AppendOnlyEntity } from '@library/database';

import { User } from '@api/modules/users/entities/user.entity';
import { Locale } from '@api/modules/users/enums/locale.enum';

import { PolicyVersion } from './policy-version.entity';

/**
 * ARCHITECTURE §4.11 — `consents` · **append-only**.
 *
 * Consent is current when a row exists for the user whose `policyVersionId` is the
 * current policy; otherwise `CONSENT_REQUIRED` (none at all) or `CONSENT_STALE`
 * (an older version) (C-12). No unique index — re-consent appends.
 */
@Index('IDX_consents_userId_createdAt', ['userId', 'createdAt'])
@Index('IDX_consents_policyVersionId', ['policyVersionId'])
@Entity('consents')
export class Consent extends AppendOnlyEntity {
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid' })
  policyVersionId: string;

  /** Denormalised snapshot so the record reads on its own. */
  @Column({ type: 'varchar', length: 20 })
  policyVersion: string;

  @Column({ type: 'timestamptz' })
  grantedAt: Date;

  @Column({ type: 'inet' })
  ip: string;

  @Column({ type: 'varchar', length: 512 })
  userAgent: string;

  /** Which translation she actually read. */
  @Column({ type: 'enum', enum: Locale, enumName: 'locale_enum' })
  locale: Locale;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => PolicyVersion, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'policyVersionId' })
  policyVersionRecord: PolicyVersion;
}
