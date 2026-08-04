import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity, decimalTransformer } from '@library/database';

import { Category } from '@api/modules/categories/entities/category.entity';
import type { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { User } from '@api/modules/users/entities/user.entity';

import { EmbellishmentWeight } from '../enums/embellishment-weight.enum';
import { GarmentMode } from '../enums/garment-mode.enum';
import { PublishState } from '../enums/publish-state.enum';
import { TestRenderState } from '../enums/test-render-state.enum';

/** A-10 per-check outcome and remediation string, stored as `jsonb`. */
export interface QualityCheckResult {
  /** Stable check id, e.g. `LONG_EDGE`, `DOMINANT_GARMENT`, `BACKGROUND_UNIFORMITY`. */
  check: string;
  passed: boolean;
  /** 0–100 contribution of this check. */
  score: number;
  /** User-facing remediation copy shown when `passed` is false. */
  remediation: string | null;
}

/**
 * ARCHITECTURE §4.13 — `garments`.
 *
 * The counters are denormalised for A-14 sorting, A-15 catalog health and the
 * A-37 leaderboard. They are maintained by `@OnEvent` listeners and reconciled
 * nightly; analytics endpoints (A-36…A-39) compute from source tables, never
 * from these counters.
 *
 * The GIN indexes on `colors`/`sizes`/`styleTags` and the GIN trigram index on
 * `title` (C-17 search) cannot be expressed on the entity and live only in the
 * migration.
 */
@Index('UQ_garments_sku', ['sku'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('UQ_garments_slug', ['slug'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('IDX_garments_publishState_categoryId', ['publishState', 'categoryId'])
@Index('IDX_garments_publishState_createdAt', ['publishState', 'createdAt'])
@Index('IDX_garments_testRenderState', ['testRenderState'])
@Index('IDX_garments_flaggedForReview', ['flaggedForReview'], {
  where: '"flaggedForReview" = true',
})
@Index('IDX_garments_categoryId', ['categoryId'])
@Index('IDX_garments_testRenderId', ['testRenderId'])
@Index('IDX_garments_approvedBy', ['approvedBy'])
@Index('IDX_garments_qualityOverriddenBy', ['qualityOverriddenBy'])
@Entity('garments')
export class Garment extends BaseEntity {
  @Column({ type: 'varchar', length: 64 })
  sku: string;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  titleUr: string | null;

  @Column({ type: 'varchar', length: 200 })
  slug: string;

  @Column({ type: 'uuid' })
  categoryId: string;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  colors: string[];

  @Column({ type: 'varchar', length: 80, nullable: true })
  fabric: string | null;

  @Column({
    type: 'enum',
    enum: EmbellishmentWeight,
    enumName: 'embellishment_weight_enum',
  })
  embellishmentWeight: EmbellishmentWeight;

  @Column({ type: 'decimal', precision: 18, scale: 2, transformer: decimalTransformer })
  price: number;

  @Column({ type: 'char', length: 3, default: 'PKR' })
  currency: string;

  @Column({ type: 'enum', enum: GarmentMode, enumName: 'garment_mode_enum' })
  mode: GarmentMode;

  /** Required when `mode = RENTAL`. */
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  deposit: number | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true })
  descriptionUr: string | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  sizes: string[];

  /** Feeds C-17 search. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  styleTags: string[];

  @Column({
    type: 'enum',
    enum: PublishState,
    enumName: 'publish_state_enum',
    default: PublishState.DRAFT,
  })
  publishState: PublishState;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  /** 0–100 (A-10). */
  @Column({ type: 'int', nullable: true })
  qualityScore: number | null;

  @Column({ type: 'jsonb', nullable: true })
  qualityChecks: QualityCheckResult[] | null;

  /** A-10 override, audit-logged. */
  @Column({ type: 'uuid', nullable: true })
  qualityOverriddenBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  qualityOverriddenAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  testRenderId: string | null;

  @Column({
    type: 'enum',
    enum: TestRenderState,
    enumName: 'test_render_state_enum',
    default: TestRenderState.NONE,
  })
  testRenderState: TestRenderState;

  @Column({ type: 'timestamptz', nullable: true })
  testRenderApprovedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  approvedBy: string | null;

  /** Set by `UPSTREAM_NO_GARMENT_DETECTED`. */
  @Column({ type: 'boolean', default: false })
  flaggedForReview: boolean;

  @Column({ type: 'int', default: 0 })
  tryOnCount: number;

  @Column({ type: 'int', default: 0 })
  loveCount: number;

  @Column({ type: 'int', default: 0 })
  maybeCount: number;

  @Column({ type: 'int', default: 0 })
  rejectCount: number;

  @Column({ type: 'int', default: 0 })
  enquiryCount: number;

  @Column({ type: 'int', default: 0 })
  failureCount: number;

  /** A-15 "zero try-ons in 30 days". */
  @Column({ type: 'timestamptz', nullable: true })
  lastTriedAt: Date | null;

  @ManyToOne(() => Category, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'categoryId' })
  category: Category;

  /**
   * Declared by **entity name** rather than by class reference on purpose.
   * `garments → tryon_results → garments` is a genuine cycle in the §4 model
   * (§4.13 `testRenderId`, §4.18 `garmentId`); a value import here would turn it
   * into a module cycle as well. TypeORM resolves the name from the registered
   * entity set, and `import type` is erased at compile time, so the property stays
   * fully typed with no runtime edge.
   */
  @ManyToOne('TryOnResult', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'testRenderId' })
  testRender: TryOnResult | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'approvedBy' })
  approver: User | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'qualityOverriddenBy' })
  qualityOverrider: User | null;
}
