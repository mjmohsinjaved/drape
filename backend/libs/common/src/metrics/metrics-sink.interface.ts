import type { MetricTags } from '../constants/metrics.constant';

/** The three metric kinds V1 needs. */
export type MetricKind = 'counter' | 'histogram' | 'gauge';

/** A single metric emission. */
export interface MetricPoint {
  name: string;
  kind: MetricKind;
  value: number;
  tags: MetricTags;
  /** Epoch milliseconds. */
  timestamp: number;
}

/**
 * The pluggable destination for metric points.
 *
 * V1 records in process and serves `GET /api/v1/admin/metrics` from the snapshot
 * (§5 route table). A Prometheus exporter drops in later by binding a different
 * implementation to `METRICS_SINK` in `metrics.module.ts` — no call site changes.
 *
 * A sink **must not throw**: metric emission is fire-and-forget and never a reason
 * for a request to fail.
 */
export interface MetricsSink {
  record(point: MetricPoint): void;
}

/** DI token for the active sink. */
export const METRICS_SINK = Symbol('METRICS_SINK');

/** Summary of one histogram series. */
export interface HistogramSummary {
  count: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

/** One series in a snapshot, keyed by name plus serialised tags. */
export interface MetricSeriesSnapshot {
  name: string;
  kind: MetricKind;
  tags: MetricTags;
  /** Present for counters and gauges. */
  value?: number;
  /** Present for histograms. */
  histogram?: HistogramSummary;
  /** Epoch milliseconds of the most recent emission. */
  updatedAt: number;
}

/** The whole in-process snapshot, as served to the admin usage screens. */
export interface MetricsSnapshot {
  collectedAt: string;
  series: MetricSeriesSnapshot[];
}

/** A sink that can be read back — implemented by the in-process default. */
export interface ReadableMetricsSink extends MetricsSink {
  snapshot(): MetricsSnapshot;
  reset(): void;
}
