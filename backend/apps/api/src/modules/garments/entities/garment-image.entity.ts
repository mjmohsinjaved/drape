import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { Garment } from './garment.entity';

/** ARCHITECTURE §4.14 — `garment_images`. */
@Index('IDX_garment_images_garmentId_position', ['garmentId', 'position'])
@Index('UQ_garment_images_source', ['garmentId'], {
  unique: true,
  where: '"isTryOnSource" = true AND "deletedAt" IS NULL',
})
@Index('IDX_garment_images_hash', ['hash'])
@Entity('garment_images')
export class GarmentImage extends BaseEntity {
  @Column({ type: 'uuid' })
  garmentId: string;

  @Column({ type: 'varchar', length: 512 })
  storageKey: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  thumbnailKey: string | null;

  /** The file sent upstream as `garment_image` (A-9). */
  @Column({ type: 'boolean', default: false })
  isTryOnSource: boolean;

  /** sha256; the `garmentSourceHash` half of the cache key (§3.7). */
  @Column({ type: 'char', length: 64 })
  hash: string;

  @Column({ type: 'int' })
  width: number;

  @Column({ type: 'int' })
  height: number;

  @Column({ type: 'int' })
  byteSize: number;

  @Column({ type: 'varchar', length: 64 })
  mimeType: string;

  /** Gallery order. */
  @Column({ type: 'int', default: 0 })
  position: number;

  /** D-20 alt text on catalog images. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  altText: string | null;

  @ManyToOne(() => Garment, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'garmentId' })
  garment: Garment;
}
