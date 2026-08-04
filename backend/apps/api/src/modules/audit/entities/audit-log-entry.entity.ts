import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AppendOnlyEntity } from '@library/database';

import { User } from '@api/modules/users/entities/user.entity';
import { ROLE_ENUM_VALUES, Role } from '@api/modules/users/enums/role.enum';

/**
 * ARCHITECTURE §4.30 — `audit_log` · **append-only**.
 *
 * Covered actions (A-3): catalog changes, publishes, deletions, role changes, quota
 * changes, consumer suspensions, moderation-queue views, settings changes — plus
 * `SIGNUP_ROLE_IGNORED` (S-4) and every quality override (A-10). `metadata` passes
 * through `redact.util.ts`; photo keys and personal data never reach it (E-12).
 *
 * Rows are written by an `@OnEvent` listener in the `audit` module, never inline in
 * a feature service (§2.9 rule 4).
 */
@Index('IDX_audit_log_actorId_createdAt', ['actorId', 'createdAt'])
@Index('IDX_audit_log_action_createdAt', ['action', 'createdAt'])
@Index('IDX_audit_log_target', ['targetType', 'targetId'])
@Entity('audit_log')
export class AuditLogEntry extends AppendOnlyEntity {
  /** Null for system actions. */
  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({
    type: 'enum',
    enum: ROLE_ENUM_VALUES,
    enumName: 'role_enum',
    nullable: true,
  })
  actorRole: Role | null;

  /** From the closed `AUDIT_ACTIONS` registry in `shared/constants`. */
  @Column({ type: 'varchar', length: 80 })
  action: string;

  /** `GARMENT`, `CATEGORY`, `USER`, `SETTING`, `MODERATION_ITEM`, … */
  @Column({ type: 'varchar', length: 60 })
  targetType: string;

  @Column({ type: 'uuid', nullable: true })
  targetId: string | null;

  /** Human-readable snapshot so the log reads after deletion. */
  @Column({ type: 'varchar', length: 160, nullable: true })
  targetLabel: string | null;

  /** Before/after diffs, redacted. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @Column({ type: 'inet', nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  @Column({ type: 'uuid', nullable: true })
  requestId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actorId' })
  actor: User | null;
}
