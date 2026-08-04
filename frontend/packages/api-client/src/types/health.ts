/**
 * ARCHITECTURE.md §5.21 `health`.
 *
 * `GET /health` and `GET /health/ready` are PUBLIC and `@SkipThrottle()`. `GET /admin/metrics` is
 * the E-13 snapshot the admin usage screens read.
 */

import type { IsoDateTime } from './common';

export const HEALTH_STATUSES = ['OK', 'DEGRADED', 'DOWN'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/** `GET /health` (PUBLIC) — liveness. */
export interface HealthResponse {
  status: HealthStatus;
  uptimeSeconds: number;
  version: string;
  timestamp: IsoDateTime;
}

/**
 * `GET /health/ready` (PUBLIC) — readiness: database, storage root writable, free space, TryOn
 * driver configured. Below `STORAGE_MIN_FREE_MB` the storage check degrades and an alert fires
 * (E-14).
 */
export interface ReadinessResponse {
  status: HealthStatus;
  checks: ReadinessCheck[];
  timestamp: IsoDateTime;
}

export interface ReadinessCheck {
  name: ReadinessCheckName;
  status: HealthStatus;
  /** Safe, non-sensitive detail — free megabytes, driver name. Never a connection string. */
  detail?: Record<string, unknown>;
}

export const READINESS_CHECK_NAMES = [
  'DATABASE',
  'STORAGE_WRITABLE',
  'STORAGE_FREE_SPACE',
  'TRYON_DRIVER',
] as const;
export type ReadinessCheckName = (typeof READINESS_CHECK_NAMES)[number];

/**
 * `GET /admin/metrics` (ADMIN) — the E-13 metric snapshot. Metric names are dot-delimited lower
 * snake (`tryon.latency_ms`, `quota.consumed`), per §2.2.
 */
export interface MetricsSnapshot {
  collectedAt: IsoDateTime;
  metrics: MetricEntry[];
}

export interface MetricEntry {
  name: string;
  value: number;
  /** Tag values are low-cardinality labels — an error code, a driver name, never an id. */
  tags?: Record<string, string>;
  unit?: string;
}
