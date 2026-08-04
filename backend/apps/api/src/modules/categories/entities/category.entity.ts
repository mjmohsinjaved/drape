import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

/**
 * ARCHITECTURE §4.12 — `categories`.
 *
 * Depth is enforced in the service: a category whose `parentId` is set may not
 * itself be a parent (`CATEGORY_DEPTH_EXCEEDED`, A-5).
 */
@Index('UQ_categories_slug', ['slug'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('IDX_categories_parentId_position', ['parentId', 'position'])
@Index('IDX_categories_archived', ['archived'])
@Entity('categories')
export class Category extends BaseEntity {
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  nameUr: string | null;

  @Column({ type: 'varchar', length: 96 })
  slug: string;

  /** One level only (A-5). */
  @Column({ type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  coverImageKey: string | null;

  /** Drives the browse order (A-6). */
  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'boolean', default: false })
  archived: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  /** Denormalised, maintained on publish-state change; the A-7 delete guard reads it. */
  @Column({ type: 'int', default: 0 })
  publishedGarmentCount: number;

  @ManyToOne(() => Category, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'parentId' })
  parent: Category | null;
}
