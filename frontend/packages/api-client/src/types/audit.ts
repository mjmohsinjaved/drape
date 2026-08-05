/**
 * ARCHITECTURE.md §5.19 `audit` and §4.30. Append-only, filterable by actor, action and date (A-3).
 *
 * `metadata` passes through `redact.util.ts` server-side: photo keys and personal data never reach
 * it (E-12). It is still `Record<string, unknown>` here — the shape varies per action and the UI
 * must narrow before rendering.
 *
 * `ip` and `userAgent` are stored on `audit_log` (§4.30) but **never projected** by
 * `AuditLogResponseDto` — they exist for incident reconstruction from the database, not for a
 * routine list read, and E-12 keeps them off anything that gets exported or screenshotted. Neither
 * field belongs on `AuditLogEntry`.
 */

import type { DateRangeQuery, IsoDateTime, PaginationQuery, Uuid } from './common';
import type { Role } from './enums';

/** One row of `GET /admin/audit` (ADMIN). */
export interface AuditLogEntry {
  id: Uuid;
  /** Null for system actions. */
  actorId: Uuid | null;
  actorRole: Role | null;
  /** A value from the closed `AuditAction` registry. */
  action: string;
  /** A value from the closed `AuditTargetType` registry. */
  targetType: string;
  targetId: Uuid | null;
  /** Human-readable snapshot, so the log still reads after the target has been deleted. */
  targetLabel: string | null;
  metadata: Record<string, unknown>;
  requestId: Uuid | null;
  createdAt: IsoDateTime;
}

/** `GET /admin/audit` — no free-text `search`; filter by actor, action, target and date instead. */
export interface AuditLogQuery extends PaginationQuery, DateRangeQuery {
  actorId?: Uuid;
  action?: string;
  targetType?: string;
  targetId?: Uuid;
  sortBy?: 'createdAt' | 'action';
}

/**
 * `GET /admin/audit/actions` (ADMIN) — the closed action and target-type registries, for the
 * filter dropdowns. Flat string lists — the registry is server-owned, so this is a fetched list
 * rather than a hard-coded union.
 */
export interface AuditActionRegistry {
  actions: string[];
  targetTypes: string[];
}
