import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity, decimalTransformer } from '@library/database';

import { Garment } from '@api/modules/garments/entities/garment.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';

import { Enquiry } from './enquiry.entity';

/**
 * ARCHITECTURE §4.24 — `enquiry_items`.
 *
 * **This table is the sole basis on which an admin may view a render** (S-10). The
 * admin renders query joins `enquiry_items → tryon_results`; there is no other path
 * from an admin route to a `renders/**` signed URL, and an E-7 test asserts it.
 */
@Index('UQ_enquiry_items_enquiry_rank', ['enquiryId', 'rank'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_enquiry_items_garmentId', ['garmentId'])
@Index('IDX_enquiry_items_resultId', ['resultId'])
@Entity('enquiry_items')
export class EnquiryItem extends BaseEntity {
  @Column({ type: 'uuid' })
  enquiryId: string;

  @Column({ type: 'uuid', nullable: true })
  garmentId: string | null;

  /** The render the admin is allowed to see (S-10). */
  @Column({ type: 'uuid', nullable: true })
  resultId: string | null;

  /** Her order at submission time. */
  @Column({ type: 'int' })
  rank: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 160 })
  garmentTitleSnapshot: string;

  @Column({ type: 'varchar', length: 64 })
  garmentSkuSnapshot: string;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  garmentPriceSnapshot: number | null;

  @ManyToOne(() => Enquiry, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'enquiryId' })
  enquiry: Enquiry;

  @ManyToOne(() => Garment, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'garmentId' })
  garment: Garment | null;

  @ManyToOne(() => TryOnResult, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'resultId' })
  result: TryOnResult | null;
}
