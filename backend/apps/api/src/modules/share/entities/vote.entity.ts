import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { Garment } from '@api/modules/garments/entities/garment.entity';

import { Reaction } from '../enums/reaction.enum';

import { ShareLink } from './share-link.entity';

/**
 * ARCHITECTURE §4.22 — `votes`.
 *
 * A second comment on the same item by the same visitor is `VOTE_ALREADY_CAST`;
 * changing the reaction updates the row.
 */
@Index('UQ_votes_link_voter_garment', ['shareLinkId', 'voterFingerprint', 'garmentId'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_votes_shareLinkId', ['shareLinkId'])
@Index('IDX_votes_garmentId', ['garmentId'])
@Entity('votes')
export class Vote extends BaseEntity {
  @Column({ type: 'uuid' })
  shareLinkId: string;

  @Column({ type: 'uuid' })
  garmentId: string;

  /** The name the visitor typed; no account required (C-33). */
  @Column({ type: 'varchar', length: 60 })
  voterLabel: string;

  /** sha256 of a first-party cookie value; prevents trivial double voting. */
  @Column({ type: 'char', length: 64 })
  voterFingerprint: string;

  @Column({ type: 'enum', enum: Reaction, enumName: 'reaction_enum' })
  reaction: Reaction;

  /** One per item (C-33). */
  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @ManyToOne(() => ShareLink, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'shareLinkId' })
  shareLink: ShareLink;

  @ManyToOne(() => Garment, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'garmentId' })
  garment: Garment;
}
