import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AppendOnlyEntity } from '@library/database';

import { User } from '@api/modules/users/entities/user.entity';

import { Enquiry } from './enquiry.entity';

/**
 * ARCHITECTURE §4.25 — `enquiry_notes` · **append-only**.
 *
 * Admin-only, never returned on a consumer route (A-24) — enforced by a separate
 * response DTO, not by a flag.
 */
@Index('IDX_enquiry_notes_enquiryId_createdAt', ['enquiryId', 'createdAt'])
@Index('IDX_enquiry_notes_authorId', ['authorId'])
@Entity('enquiry_notes')
export class EnquiryNote extends AppendOnlyEntity {
  @Column({ type: 'uuid' })
  enquiryId: string;

  @Column({ type: 'uuid', nullable: true })
  authorId: string | null;

  @Column({ type: 'text' })
  body: string;

  @ManyToOne(() => Enquiry, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'enquiryId' })
  enquiry: Enquiry;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'authorId' })
  author: User | null;
}
