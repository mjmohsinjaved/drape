import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { Garment } from '@api/modules/garments/entities/garment.entity';

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

  @Column({ type: 'varchar', length: 16, nullable: true })
  driver: string | null;

  @Column({ type: 'uuid', nullable: true })
  garmentId: string | null;

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
