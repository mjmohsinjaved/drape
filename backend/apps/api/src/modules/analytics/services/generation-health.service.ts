import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Between, Repository } from 'typeorm';

import { AlertingService } from '@api/modules/notifications/services/alerting.service';
import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';
import { JobStatus } from '@api/modules/tryon/enums/job-status.enum';

import {
  GENERATION_FAILURE_MIN_SAMPLE,
  GENERATION_FAILURE_THRESHOLD_PERCENT,
  GENERATION_FAILURE_WINDOW_MINUTES,
  GENERATION_HEALTH_SWEEP_MS,
  LATENCY_BUCKETS_MS,
} from '../constants/analytics.constants';
import {
  FailureCodeDto,
  GenerationHealthResponseDto,
  LatencyBucketDto,
} from '../dto/analytics-response.dto';
import { percent } from '../queries/funnel-math';
import { count } from '../queries/leaderboard-math';

import type { AnalyticsWindow } from '../queries/analytics-window';

const MILLISECONDS_PER_MINUTE = 60_000;

/** Raw counts for one window. Split out so the E-14 sweep and the E-13 screen share it. */
export interface GenerationTotals {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cacheHits: number;
  readonly topFailureReason: string | null;
}

/**
 * **E-13's generation health, and the E-14 failure-rate alert that reads it.**
 *
 * > E-13: "generation latency distribution, failure rate by error code, cache hit rate".
 * > E-14: "alerts on generation failure rate above 4%".
 *
 * Both live here because both are questions about `tryon_jobs` (§4.17), and the module
 * that can see the condition is the module that raises it. `notifications` never
 * queries a feature table; this never composes copy.
 *
 * ### Percentiles come from the database, not from a fetched array
 *
 * `PERCENTILE_CONT` computes p50 and p95 inside PostgreSQL over `durationMs`. The
 * alternative — select every duration and sort in JavaScript — is a full column read
 * that grows without bound, which §5.18 forbids and which would stop working exactly
 * when latency became worth looking at.
 *
 * ### A rate needs a denominator
 *
 * The alert does not fire below {@link GENERATION_FAILURE_MIN_SAMPLE} generations in
 * the window. One failure out of three is 33% and is not evidence of anything; paging
 * an operator on it teaches them to ignore the next one, which is the only way an alert
 * can actually fail.
 */
@Injectable()
export class GenerationHealthService implements OnModuleDestroy {
  private readonly logger = new Logger(GenerationHealthService.name);

  private running = false;
  private stopped = false;

  constructor(
    @InjectRepository(TryOnJob)
    private readonly jobs: Repository<TryOnJob>,
    private readonly alerts: AlertingService,
  ) {}

  onModuleDestroy(): void {
    this.stopped = true;
  }

  /* -----------------------------------------------------------------------------------------
   * E-13 — the screen
   * -------------------------------------------------------------------------------------- */

  /** `GET /admin/analytics/generation-health` (E-13, §5.18). */
  async health(window: AnalyticsWindow): Promise<GenerationHealthResponseDto> {
    const [totals, percentiles, buckets, byCode] = await Promise.all([
      this.totals(window),
      this.percentiles(window),
      this.latencyBuckets(window),
      this.failuresByCode(window),
    ]);

    const dto = new GenerationHealthResponseDto();
    dto.from = window.from;
    dto.to = window.to;
    dto.total = totals.total;
    dto.succeeded = totals.succeeded;
    dto.failed = totals.failed;
    dto.failureRatePercent = percent(totals.failed, totals.total);
    dto.cacheHitRate = percent(totals.cacheHits, totals.succeeded);
    dto.p50LatencyMs = percentiles.p50;
    dto.p95LatencyMs = percentiles.p95;
    dto.latencyBuckets = buckets;
    dto.failuresByCode = byCode.map((row) => {
      const item = new FailureCodeDto();
      item.errorCode = row.errorCode;
      item.count = row.count;
      item.rate = percent(row.count, totals.total);
      return item;
    });
    return dto;
  }

  /* -----------------------------------------------------------------------------------------
   * E-14 — the alert
   * -------------------------------------------------------------------------------------- */

  /**
   * Every five minutes, over the last hour.
   *
   * `@Interval` fires regardless of whether the previous sweep finished, so the
   * `running` flag — not the timer — prevents two overlapping sweeps. Nothing here holds
   * a transaction, so a sweep interrupted by shutdown has nothing to roll back.
   */
  @Interval(GENERATION_HEALTH_SWEEP_MS)
  async tick(): Promise<void> {
    await this.sweepOnce();
  }

  /**
   * One failure-rate check. Never throws: a background observer that could take the
   * process down would be a worse problem than the one it is watching for.
   *
   * @returns true when an alert was raised.
   */
  async sweepOnce(now: Date = new Date()): Promise<boolean> {
    if (this.running || this.stopped) {
      return false;
    }

    this.running = true;
    try {
      const windowStartedAt = new Date(
        now.getTime() - GENERATION_FAILURE_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE,
      );
      const totals = await this.totals({
        from: windowStartedAt,
        to: now,
        days: 1,
      });

      if (totals.total < GENERATION_FAILURE_MIN_SAMPLE) {
        return false;
      }

      const failureRatePercent = percent(totals.failed, totals.total);
      if (failureRatePercent <= GENERATION_FAILURE_THRESHOLD_PERCENT) {
        return false;
      }

      await this.alerts.generationFailureRate({
        windowMinutes: GENERATION_FAILURE_WINDOW_MINUTES,
        windowStartedAt,
        totalGenerations: totals.total,
        failedGenerations: totals.failed,
        failureRatePercent,
        thresholdPercent: GENERATION_FAILURE_THRESHOLD_PERCENT,
        topFailureReason: totals.topFailureReason,
      });
      return true;
    } catch (error: unknown) {
      this.logger.error(
        'The generation failure-rate sweep could not complete: ' +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    } finally {
      this.running = false;
    }
  }

  /* -----------------------------------------------------------------------------------------
   * Internals — counts and aggregates, never rows
   * -------------------------------------------------------------------------------------- */

  /** The four counts both the screen and the alert need. */
  async totals(window: AnalyticsWindow): Promise<GenerationTotals> {
    const between = Between(window.from, window.to);

    const [succeeded, failed, cacheHits, byCode] = await Promise.all([
      this.jobs.count({ where: { status: JobStatus.SUCCEEDED, createdAt: between } }),
      this.jobs.count({ where: { status: JobStatus.FAILED, createdAt: between } }),
      this.jobs.count({
        where: { status: JobStatus.SUCCEEDED, cacheHit: true, createdAt: between },
      }),
      this.failuresByCode(window, 1),
    ]);

    return {
      total: succeeded + failed,
      succeeded,
      failed,
      cacheHits,
      topFailureReason: byCode[0]?.errorCode ?? null,
    };
  }

  /** p50 and p95 of `durationMs`, computed by PostgreSQL over an indexed window. */
  private async percentiles(window: AnalyticsWindow): Promise<{ p50: number; p95: number }> {
    const row = await this.jobs
      .createQueryBuilder('j')
      .select('PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY j."durationMs")', 'p50')
      .addSelect('PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY j."durationMs")', 'p95')
      .where('j.status = :status', { status: JobStatus.SUCCEEDED })
      .andWhere('j."durationMs" IS NOT NULL')
      .andWhere('j.createdAt BETWEEN :from AND :to', { from: window.from, to: window.to })
      .andWhere('j.deletedAt IS NULL')
      .getRawOne<{ p50: string | null; p95: string | null }>();

    return { p50: Math.round(count(row?.p50)), p95: Math.round(count(row?.p95)) };
  }

  /**
   * The E-13 latency distribution, as counts per bucket.
   *
   * `width_bucket` would be tidier and is deliberately not used: the buckets in
   * {@link LATENCY_BUCKETS_MS} are uneven, chosen around the seven-second upstream call
   * (C-19), and an even-width histogram would put every interesting observation in one
   * column. A `FILTER` per bucket is one pass over the same window.
   */
  private async latencyBuckets(window: AnalyticsWindow): Promise<LatencyBucketDto[]> {
    const builder = this.jobs
      .createQueryBuilder('j')
      .where('j.status = :status', { status: JobStatus.SUCCEEDED })
      .andWhere('j."durationMs" IS NOT NULL')
      .andWhere('j.createdAt BETWEEN :from AND :to', { from: window.from, to: window.to })
      .andWhere('j.deletedAt IS NULL');

    let previous = 0;
    LATENCY_BUCKETS_MS.forEach((upper, index) => {
      builder.addSelect(
        `COUNT(*) FILTER (WHERE j."durationMs" >= ${previous} AND j."durationMs" < ${upper})`,
        `b${index}`,
      );
      previous = upper;
    });
    builder.addSelect(`COUNT(*) FILTER (WHERE j."durationMs" >= ${previous})`, 'bOver');

    const row = await builder.getRawOne<Record<string, string>>();

    const buckets = LATENCY_BUCKETS_MS.map((upper, index) => {
      const bucket = new LatencyBucketDto();
      bucket.upperBoundMs = upper;
      bucket.count = count(row?.[`b${index}`]);
      return bucket;
    });

    const overflow = new LatencyBucketDto();
    overflow.upperBoundMs = null;
    overflow.count = count(row?.bOver);
    buckets.push(overflow);

    return buckets;
  }

  /** E-13 — "failure rate by error code". Grouped, ordered, limited. */
  private async failuresByCode(
    window: AnalyticsWindow,
    limit = 10,
  ): Promise<{ errorCode: string; count: number }[]> {
    const rows = await this.jobs
      .createQueryBuilder('j')
      .select('j.errorCode', 'errorCode')
      .addSelect('COUNT(*)', 'count')
      .where('j.status = :status', { status: JobStatus.FAILED })
      .andWhere('j.errorCode IS NOT NULL')
      .andWhere('j.createdAt BETWEEN :from AND :to', { from: window.from, to: window.to })
      .andWhere('j.deletedAt IS NULL')
      .groupBy('j.errorCode')
      .orderBy('COUNT(*)', 'DESC')
      .limit(limit)
      .getRawMany<{ errorCode: string; count: string }>();

    return rows.map((row) => ({ errorCode: row.errorCode, count: count(row.count) }));
  }
}
