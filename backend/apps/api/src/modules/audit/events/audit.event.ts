import type { Role } from '@api/modules/users/enums/role.enum';
import type { AuditAction, AuditTargetType } from '@api/shared/constants/audit-actions.constant';

/**
 * The EventEmitter2 event other modules emit instead of importing `AuditService`
 * (ARCHITECTURE §2.9 rule 4). Named `domain.action` per §2.2.
 *
 * ```typescript
 * this.events.emit(AUDIT_RECORD_EVENT, new AuditRecordEvent({
 *   action: AUDIT_ACTIONS.GARMENT_PUBLISHED,
 *   targetType: AUDIT_TARGET_TYPES.GARMENT,
 *   actorId: user.id,
 *   actorRole: user.role,
 *   targetId: garment.id,
 *   targetLabel: garment.title,
 *   metadata: { from, to },
 * }));
 * ```
 *
 * Emit **after** `commitTransaction()` — a listener that fires on a transaction that
 * later rolls back has told the world a lie.
 */
export const AUDIT_RECORD_EVENT = 'audit.record';

/**
 * Everything an `audit_log` row (§4.30) can hold.
 *
 * `metadata` is redacted by `AuditService.record()` before it is stored, so a caller
 * may hand over a diff without first auditing it themselves — but the redactor is a
 * backstop, not a licence: never deliberately put a photo key, an email, a phone
 * number or a token in here (E-12).
 */
export interface AuditRecordInput {
  /** A member of the closed `AUDIT_ACTIONS` registry. */
  readonly action: AuditAction;
  /** A member of the closed `AUDIT_TARGET_TYPES` registry. */
  readonly targetType: AuditTargetType;
  /** `null` for system actions — a cron purge, a seeded change. */
  readonly actorId?: string | null;
  readonly actorRole?: Role | null;
  readonly targetId?: string | null;
  /** Human-readable snapshot so the row still reads after the target is deleted. */
  readonly targetLabel?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  /** Mirrors `X-Request-Id`, so an audit row correlates with the request log (E-12). */
  readonly requestId?: string | null;
}

/** The typed envelope carried by {@link AUDIT_RECORD_EVENT}. */
export class AuditRecordEvent {
  constructor(readonly input: AuditRecordInput) {}
}
