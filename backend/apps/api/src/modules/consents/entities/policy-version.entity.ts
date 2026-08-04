import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '@library/database';

/** C-11 retention summary, stored as `jsonb`. */
export interface PolicyRetention {
  photoDays: number;
  rendersLifetime: boolean;
}

/** ARCHITECTURE §4.10 — `policy_versions` (C-11, C-12). */
@Index('UQ_policy_versions_version', ['version'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('UQ_policy_versions_current', ['isCurrent'], {
  unique: true,
  where: '"isCurrent" = true AND "deletedAt" IS NULL',
})
@Entity('policy_versions')
export class PolicyVersion extends BaseEntity {
  /** e.g. `2026.08.1`. */
  @Column({ type: 'varchar', length: 20 })
  version: string;

  @Column({ type: 'timestamptz' })
  effectiveFrom: Date;

  @Column({ type: 'boolean', default: false })
  isCurrent: boolean;

  /** Markdown; covers all five C-11 statements. */
  @Column({ type: 'text' })
  bodyEn: string;

  @Column({ type: 'text' })
  bodyUr: string;

  @Column({ type: 'text' })
  summaryEn: string;

  @Column({ type: 'text' })
  summaryUr: string;

  @Column({ type: 'jsonb' })
  retentionSummary: PolicyRetention;
}
