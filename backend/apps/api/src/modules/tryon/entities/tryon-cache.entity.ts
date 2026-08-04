import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { Garment } from '@api/modules/garments/entities/garment.entity';

/**
 * ARCHITECTURE §4.19 — `tryon_cache` (§3.7, PRD §8.1 step 4).
 *
 * `cacheKey = sha256(`${garmentSourceHash}:${personPhotoHash}:${TRYON_API_VERSION}`)`.
 * On a hit the render file is copied into the requesting user's own namespace and a
 * new `tryon_results` row is written for her — it is never shared by reference.
 */
@Index('UQ_tryon_cache_cacheKey', ['cacheKey'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('IDX_tryon_cache_personPhotoHash', ['personPhotoHash'])
@Index('IDX_tryon_cache_garmentId', ['garmentId'])
@Entity('tryon_cache')
export class TryOnCache extends BaseEntity {
  @Column({ type: 'char', length: 64 })
  cacheKey: string;

  @Column({ type: 'char', length: 64 })
  garmentSourceHash: string;

  @Column({ type: 'char', length: 64 })
  personPhotoHash: string;

  @Column({ type: 'varchar', length: 32 })
  apiVersion: string;

  @Column({ type: 'uuid', nullable: true })
  garmentId: string | null;

  /** Canonical render, copied per user on a hit (§3.7). */
  @Column({ type: 'varchar', length: 512 })
  storageKey: string;

  @Column({ type: 'int' })
  width: number;

  @Column({ type: 'int' })
  height: number;

  @Column({ type: 'int', default: 0 })
  hitCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastHitAt: Date | null;

  @ManyToOne(() => Garment, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'garmentId' })
  garment: Garment | null;
}
