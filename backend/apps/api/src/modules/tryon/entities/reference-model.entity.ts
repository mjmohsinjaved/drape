import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '@library/database';

/**
 * ARCHITECTURE §4.15 — `reference_models` (E-4, A-11).
 *
 * These are the only person images an admin ever sends upstream; consumer photos
 * are never used for a test render.
 */
@Index('UQ_reference_models_default', ['isDefault'], {
  unique: true,
  where: '"isDefault" = true AND "deletedAt" IS NULL',
})
@Entity('reference_models')
export class ReferenceModel extends BaseEntity {
  @Column({ type: 'varchar', length: 80 })
  label: string;

  @Column({ type: 'varchar', length: 512 })
  storageKey: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  thumbnailKey: string | null;

  @Column({ type: 'char', length: 64 })
  hash: string;

  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}
