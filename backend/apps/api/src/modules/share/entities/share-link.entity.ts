import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { User } from '@api/modules/users/entities/user.entity';

/**
 * ARCHITECTURE §4.21 — `share_links`.
 *
 * A share view resolves the owner's **live** shortlist (`LOVE_IT` + `MAYBE`, by
 * rank) and returns only `{ garment title, category, price if public, render url }`
 * per item. It never returns her photo, her other renders, her name, her contact
 * details, her notes, or any other consumer's data (C-33). There is no snapshot
 * table — revoking the link is the control.
 */
@Index('UQ_share_links_tokenHash', ['tokenHash'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('IDX_share_links_userId', ['userId'])
@Index('IDX_share_links_expiresAt', ['expiresAt'])
@Entity('share_links')
export class ShareLink extends BaseEntity {
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'char', length: 64 })
  tokenHash: string;

  /** "Ammi", "Sisters". */
  @Column({ type: 'varchar', length: 60, nullable: true })
  label: string | null;

  /** Created at `now + 30 days` (C-34). */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** C-34. */
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  viewCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastViewedAt: Date | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;
}
