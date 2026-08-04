/**
 * ARCHITECTURE.md §5.19 `audit` and §4.30. Append-only, filterable by actor, action and date (A-3).
 *
 * `metadata` passes through `redact.util.ts` server-side: photo keys and personal data never reach
 * it (E-12). It is still `Record<string, unknown>` here — the shape varies per action and the UI
 * must narrow before rendering.
 */

import type {
  DateRangeQuery,
  IsoDateTime,
  SearchablePaginationQuery,
  Uuid,
} from './common';
import type { Role } from './enums';

/** One row of `GET /admin/audit` (ADMIN). */
export interface AuditLogEntry {
  id: Uuid;
  /** Null for system actions. */
  actorId: Uuid | null;
  actorName: string | null;
  actorRole: Role | null;
  /** A value from the closed `AuditAction` registry. */
  action: string;
  targetType: string;
  targetId: Uuid | null;
  /** Human-readable snapshot, so the log still reads after the target has been deleted. */
  targetLabel: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  requestId: Uuid | null;
  createdAt: IsoDateTime;
}

export interface AuditLogQuery extends SearchablePaginationQuery, DateRangeQuery {
  actorId?: Uuid;
  action?: string;
  targetType?: string;
  targetId?: Uuid;
  sortBy?: 'createdAt';
}

/**
 * `GET /admin/audit/actions` (ADMIN) — the closed action registry, for the filter dropdown. The
 * registry is server-owned, so this is a fetched list rather than a hard-coded union.
 */
export interface AuditActionRegistry {
  actions: AuditActionEntry[];
  targetTypes: string[];
}

export interface AuditActionEntry {
  /** UPPER_SNAKE_CASE, verb last — `GARMENT_PUBLISHED`, `MODERATION_ITEM_VIEWED` (§2.2). */
  action: string;
  targetType: string;
  /** Short English description; the UI translates it through i18n by action code. */
  description: string;
}
