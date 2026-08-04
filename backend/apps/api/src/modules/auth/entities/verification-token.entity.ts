import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { User } from '@api/modules/users/entities/user.entity';

import { VerificationPurpose } from '../enums/verification-purpose.enum';

/** ARCHITECTURE §4.6 — `verification_tokens`. */
@Index('UQ_verification_tokens_tokenHash', ['tokenHash'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_verification_tokens_userId_purpose', ['userId', 'purpose'])
@Index('IDX_verification_tokens_expiresAt', ['expiresAt'])
@Entity('verification_tokens')
export class VerificationToken extends BaseEntity {
  /** Null for an invite acceptance before the account exists. */
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({
    type: 'enum',
    enum: VerificationPurpose,
    enumName: 'verification_purpose_enum',
  })
  purpose: VerificationPurpose;

  /** sha256 of the emailed token. */
  @Column({ type: 'char', length: 64 })
  tokenHash: string;

  /** sha256 of the 6-digit OTP (`PHONE_OTP` only). */
  @Column({ type: 'char', length: 64, nullable: true })
  codeHash: string | null;

  /** Email or E.164. */
  @Column({ type: 'varchar', length: 320 })
  destination: string;

  /** 30 min reset (S-6), 24 h email verify, 10 min OTP, 7 d invite. */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Single use. */
  @Column({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'inet', nullable: true })
  ip: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User | null;
}
