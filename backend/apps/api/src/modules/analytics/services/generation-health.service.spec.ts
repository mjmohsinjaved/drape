import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AlertingService } from '@api/modules/notifications/services/alerting.service';
import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';
import { JobStatus } from '@api/modules/tryon/enums/job-status.enum';

import { createInMemoryRepository, type InMemoryRepository } from '../../../../test/fixtures';
import {
  GROUPING_ERROR_CODE,
  installQueryBuilderDouble,
} from '../../../../test/fixtures/query-builder-double';
import {
  GENERATION_FAILURE_MIN_SAMPLE,
  GENERATION_FAILURE_THRESHOLD_PERCENT,
  LATENCY_BUCKETS_MS,
} from '../constants/analytics.constants';

import { GenerationHealthService } from './generation-health.service';

import type { AnalyticsWindow } from '../queries/analytics-window';

/**
 * **E-13's generation health, and the E-14 alert.**
 *
 * There was no spec for any service in this module, which is how
 * `GET /admin/analytics/generation-health` shipped as a **guaranteed 500**: the latency
 * histogram was built entirely out of `addSelect`, so the entity seed
 * `createQueryBuilder('j')` writes into the select list survived beside seven aggregates
 * with no `GROUP BY`, and PostgreSQL answers that with `42803`.
 *
 * A `jest.fn()` query-builder stub cannot see that defect — it has no seed and no
 * grouping rule — so these tests use `query-builder-double`, which models both and
 * raises `42803` itself. Reverting `latencyBuckets()` to `addSelect`-only fails
 * "the latency histogram replaces the entity seed" *and* "the E-13 screen answers"
 * below, with the same error code an admin would have seen.
 */
describe('GenerationHealthService', () => {
  let service: GenerationHealthService;
  let jobs: InMemoryRepository<TryOnJob>;
  let alerts: { generationFailureRate: jest.Mock };

  const window: AnalyticsWindow = {
    from: new Date('2026-01-01T00:00:00.000Z'),
    to: new Date('2026-01-31T00:00:00.000Z'),
    days: 30,
  };

  /** Every alias the histogram, the percentiles and the failure rollup read back. */
  const rawRow: Record<string, string> = {
    p50: '4200',
    p95: '9100',
    bOver: '3',
    errorCode: 'UPSTREAM_TIMEOUT',
    count: '11',
    ...Object.fromEntries(LATENCY_BUCKETS_MS.map((_, index) => [`b${index}`, String(index + 1)])),
  };

  beforeEach(async () => {
    jobs = createInMemoryRepository<TryOnJob>();
    alerts = { generationFailureRate: jest.fn(async () => undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GenerationHealthService,
        { provide: getRepositoryToken(TryOnJob), useValue: jobs },
        { provide: AlertingService, useValue: alerts },
      ],
    }).compile();

    service = moduleRef.get(GenerationHealthService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  /* ---------------------------------------------------------------------------------------
   * E-13 — the screen
   * ------------------------------------------------------------------------------------ */

  describe('health', () => {
    it('answers rather than raising 42803 — the whole E-13 screen depends on it', async () => {
      installQueryBuilderDouble(jobs, { rows: [rawRow] });

      const dto = await service.health(window);

      expect(dto.p50LatencyMs).toBe(4_200);
      expect(dto.p95LatencyMs).toBe(9_100);
      // One bucket per band plus the overflow.
      expect(dto.latencyBuckets).toHaveLength(LATENCY_BUCKETS_MS.length + 1);
      expect(dto.latencyBuckets.at(-1)?.upperBoundMs).toBeNull();
      expect(dto.latencyBuckets.at(-1)?.count).toBe(3);
    });

    it('builds the latency histogram with the entity seed replaced, not appended to', async () => {
      const builders = installQueryBuilderDouble(jobs, { rows: [rawRow] });

      await service.health(window);

      // `health()` fires four queries. The histogram is the one carrying `bOver`.
      const histogram = builders.$builders.find((builder) =>
        builder.selects.some((entry) => entry.alias === 'bOver'),
      );

      expect(histogram).toBeDefined();
      // The whole defect in one assertion: `select()` was called, so `j.*` is gone.
      expect(histogram?.seedRetained).toBe(false);
      expect(histogram?.selects.every((entry) => entry.expression.includes('COUNT(*)'))).toBe(true);
      expect(histogram?.selects).toHaveLength(LATENCY_BUCKETS_MS.length + 1);
    });

    it('derives the failure and cache-hit rates from the counts', async () => {
      installQueryBuilderDouble(jobs, { rows: [rawRow] });
      jobs.count = jest.fn(
        async (options?: { where?: { status?: JobStatus; cacheHit?: boolean } }) => {
          if (options?.where?.cacheHit === true) {
            return 20;
          }
          return options?.where?.status === JobStatus.FAILED ? 25 : 75;
        },
      );

      const dto = await service.health(window);

      expect(dto.total).toBe(100);
      expect(dto.succeeded).toBe(75);
      expect(dto.failed).toBe(25);
      expect(dto.failureRatePercent).toBe(25);
      // Cache hits are a share of successes, not of everything (C-22).
      expect(dto.cacheHitRate).toBeCloseTo(26.7, 1);
    });

    it('reports a zeroed screen for a window with nothing in it (D-5 empty state)', async () => {
      installQueryBuilderDouble(jobs, { rows: [] });

      const dto = await service.health(window);

      expect(dto.total).toBe(0);
      expect(dto.failureRatePercent).toBe(0);
      expect(dto.p50LatencyMs).toBe(0);
      expect(dto.failuresByCode).toEqual([]);
      expect(dto.latencyBuckets.every((bucket) => bucket.count === 0)).toBe(true);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * The double itself — a test that would pass against a blind stub must fail here
   * ------------------------------------------------------------------------------------ */

  it('the query-builder double raises 42803 for the shape the bug produced', async () => {
    const builders = installQueryBuilderDouble(jobs, { rows: [rawRow] });

    // Exactly what `latencyBuckets()` used to build: no `select()`, so the seed stays.
    const builder = jobs.createQueryBuilder('j');
    builder.addSelect('COUNT(*) FILTER (WHERE j."durationMs" < 1000)', 'b0');

    await expect(builder.getRawOne()).rejects.toMatchObject({ code: GROUPING_ERROR_CODE });
    expect(builders.$last().seedRetained).toBe(true);
  });

  /* ---------------------------------------------------------------------------------------
   * E-14 — the alert
   * ------------------------------------------------------------------------------------ */

  describe('sweepOnce', () => {
    const countingRepository = (succeeded: number, failed: number): void => {
      jobs.count = jest.fn(
        async (options?: { where?: { status?: JobStatus; cacheHit?: boolean } }) => {
          if (options?.where?.cacheHit === true) {
            return 0;
          }
          return options?.where?.status === JobStatus.FAILED ? failed : succeeded;
        },
      );
    };

    it('stays silent below the minimum sample — a rate needs a denominator', async () => {
      installQueryBuilderDouble(jobs, { rows: [] });
      countingRepository(1, GENERATION_FAILURE_MIN_SAMPLE - 2);

      await expect(service.sweepOnce()).resolves.toBe(false);
      expect(alerts.generationFailureRate).not.toHaveBeenCalled();
    });

    it('stays silent at or below the threshold', async () => {
      installQueryBuilderDouble(jobs, { rows: [] });
      // Exactly 4% of 100 — the threshold is exclusive.
      countingRepository(96, GENERATION_FAILURE_THRESHOLD_PERCENT);

      await expect(service.sweepOnce()).resolves.toBe(false);
      expect(alerts.generationFailureRate).not.toHaveBeenCalled();
    });

    it('raises the E-14 alert above the threshold, with the top failure reason', async () => {
      installQueryBuilderDouble(jobs, { rows: [rawRow] });
      countingRepository(80, 20);

      await expect(service.sweepOnce()).resolves.toBe(true);
      expect(alerts.generationFailureRate).toHaveBeenCalledWith(
        expect.objectContaining({
          totalGenerations: 100,
          failedGenerations: 20,
          failureRatePercent: 20,
          thresholdPercent: GENERATION_FAILURE_THRESHOLD_PERCENT,
          topFailureReason: 'UPSTREAM_TIMEOUT',
        }),
      );
    });

    it('never throws: a background observer must not take the process down', async () => {
      jobs.count = jest.fn(async () => {
        throw new Error('the database went away');
      });

      await expect(service.sweepOnce()).resolves.toBe(false);
    });

    it('does not sweep once the module is destroyed', async () => {
      installQueryBuilderDouble(jobs, { rows: [] });
      countingRepository(0, 1_000);

      service.onModuleDestroy();

      await expect(service.sweepOnce()).resolves.toBe(false);
      expect(alerts.generationFailureRate).not.toHaveBeenCalled();
    });
  });
});
