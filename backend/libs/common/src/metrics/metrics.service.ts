import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  METRICS_SINK,
  type HistogramSummary,
  type MetricKind,
  type MetricPoint,
  type MetricSeriesSnapshot,
  type MetricsSink,
  type MetricsSnapshot,
  type ReadableMetricsSink,
} from './metrics-sink.interface';

import type { MetricTags } from '../constants/metrics.constant';

/** How many observations one histogram series retains for percentile estimation. */
const HISTOGRAM_WINDOW = 2048;

/** Ceiling on distinct series, so a runaway tag value cannot exhaust memory. */
const MAX_SERIES = 5000;

function serialiseTags(tags: MetricTags): string {
  const keys = Object.keys(tags).sort();
  if (keys.length === 0) {
    return '';
  }
  return keys.map((key) => `${key}=${String(tags[key as keyof MetricTags])}`).join(',');
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] ?? 0;
}

interface Series {
  name: string;
  kind: MetricKind;
  tags: MetricTags;
  value: number;
  observations: number[];
  updatedAt: number;
}

/**
 * The default sink: an in-process aggregator.
 *
 * Counters accumulate, gauges keep the last value, histograms keep a bounded
 * ring of recent observations and summarise on read. This is what
 * `GET /api/v1/admin/metrics` serves in V1. Swapping in a Prometheus exporter is a
 * one-line change in `MetricsModule` because nothing else knows this class exists.
 */
export class InProcessMetricsSink implements ReadableMetricsSink {
  private readonly series = new Map<string, Series>();

  record(point: MetricPoint): void {
    const key = `${point.kind}|${point.name}|${serialiseTags(point.tags)}`;
    let entry = this.series.get(key);

    if (entry === undefined) {
      if (this.series.size >= MAX_SERIES) {
        // Dropping is the correct failure mode: a metric must never be the reason a
        // request fails or the process runs out of memory.
        return;
      }
      entry = {
        name: point.name,
        kind: point.kind,
        tags: point.tags,
        value: 0,
        observations: [],
        updatedAt: point.timestamp,
      };
      this.series.set(key, entry);
    }

    switch (point.kind) {
      case 'counter':
        entry.value += point.value;
        break;
      case 'gauge':
        entry.value = point.value;
        break;
      case 'histogram':
        entry.observations.push(point.value);
        if (entry.observations.length > HISTOGRAM_WINDOW) {
          entry.observations.shift();
        }
        entry.value = point.value;
        break;
      default:
        break;
    }

    entry.updatedAt = point.timestamp;
  }

  snapshot(): MetricsSnapshot {
    const series: MetricSeriesSnapshot[] = [];
    for (const entry of this.series.values()) {
      const item: MetricSeriesSnapshot = {
        name: entry.name,
        kind: entry.kind,
        tags: entry.tags,
        updatedAt: entry.updatedAt,
      };
      if (entry.kind === 'histogram') {
        item.histogram = summarise(entry.observations);
      } else {
        item.value = entry.value;
      }
      series.push(item);
    }
    series.sort((a, b) => a.name.localeCompare(b.name));
    return { collectedAt: new Date().toISOString(), series };
  }

  reset(): void {
    this.series.clear();
  }
}

function summarise(observations: readonly number[]): HistogramSummary {
  if (observations.length === 0) {
    return { count: 0, sum: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...observations].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    sum,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: sum / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

/**
 * The metrics façade — PRD E-13.
 *
 * Injected everywhere a metric is emitted. Emission is fire-and-forget: a failing
 * sink is swallowed, because no business operation may fail because a counter did.
 */
@Injectable()
export class MetricsService {
  private readonly sink: MetricsSink;

  constructor(@Optional() @Inject(METRICS_SINK) sink?: MetricsSink) {
    this.sink = sink ?? new InProcessMetricsSink();
  }

  /** Increments a counter. `value` defaults to 1 and must be non-negative. */
  increment(name: string, tags: MetricTags = {}, value = 1): void {
    if (value < 0) {
      return;
    }
    this.emit({ name, kind: 'counter', value, tags, timestamp: Date.now() });
  }

  /** Records an observation — a latency, a size, a count per operation. */
  histogram(name: string, value: number, tags: MetricTags = {}): void {
    if (!Number.isFinite(value)) {
      return;
    }
    this.emit({ name, kind: 'histogram', value, tags, timestamp: Date.now() });
  }

  /** Sets a point-in-time value. */
  gauge(name: string, value: number, tags: MetricTags = {}): void {
    if (!Number.isFinite(value)) {
      return;
    }
    this.emit({ name, kind: 'gauge', value, tags, timestamp: Date.now() });
  }

  /**
   * Times `operation`, records the elapsed milliseconds as a histogram, and
   * re-throws whatever it threw — with `outcome` tagged either way.
   */
  async time<T>(name: string, tags: MetricTags, operation: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await operation();
      this.histogram(name, Date.now() - startedAt, { ...tags, outcome: 'SUCCESS' });
      return result;
    } catch (error) {
      this.histogram(name, Date.now() - startedAt, { ...tags, outcome: 'FAILURE' });
      throw error;
    }
  }

  /** The current snapshot, when the active sink supports reading back. */
  snapshot(): MetricsSnapshot | undefined {
    const sink = this.sink as Partial<ReadableMetricsSink>;
    return typeof sink.snapshot === 'function' ? sink.snapshot() : undefined;
  }

  private emit(point: MetricPoint): void {
    try {
      this.sink.record(point);
    } catch {
      // Intentionally swallowed. A metric sink must never break a request, and
      // logging here would risk an infinite loop through the logging middleware.
    }
  }
}
