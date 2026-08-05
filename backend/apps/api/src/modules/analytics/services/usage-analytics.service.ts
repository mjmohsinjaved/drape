import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Between, In, Repository } from 'typeorm';

import { BudgetService } from '@api/modules/quota/services/budget.service';
import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';
import { JobStatus } from '@api/modules/tryon/enums/job-status.enum';

import { UsageAnalyticsResponseDto } from '../dto/analytics-response.dto';
import { projectBudgetExhaustion } from '../queries/budget-projection';
import { percent } from '../queries/funnel-math';

import type { AnalyticsWindow } from '../queries/analytics-window';

/**
 * **A-33 — the usage dashboard, including the half `quota` cannot see.**
 *
 * > "Generations this month, remaining budget, projected exhaustion from a 7-day
 * > trailing rate, split between consumer try-ons and admin test renders, plus cache
 * > hits versus billed calls."
 *
 * ### Why this composes `BudgetService` instead of reading `usage_ledger`
 *
 * `usage_ledger` belongs to `quota` (§4.33), and the remaining budget is **derived by
 * summing it** (§4.0 rule 10). A second module summing the same table would be a second
 * definition of the same number, and the two would disagree the first time either
 * changed. So the budget, the split and the trailing rate arrive from
 * `BudgetService.overview()` — the module that owns the ledger answers ledger questions.
 *
 * ### And why the cache figures cannot come from there
 *
 * They cannot exist there. C-22: a cache hit serves a render and **charges nothing**,
 * so it writes no `usage_ledger` row in either table — by design. `quota`'s own DTO
 * says as much and names this module as the place the two halves should meet:
 *
 * > "the hit count lives on `tryon_cache`, which `TryOnModule` owns … when that module
 * > lands it should surface the ratio beside these numbers rather than this module
 * > reaching into its table"
 *
 * `tryon_jobs.cacheHit` (§4.17) is the per-generation record of which way each request
 * went, so the ratio is a two-`COUNT` question over a table this module already reads
 * for E-13 — no join, no rows loaded, and no second opinion about what the budget is.
 */
@Injectable()
export class UsageAnalyticsService {
  constructor(
    @InjectRepository(TryOnJob)
    private readonly jobs: Repository<TryOnJob>,
    private readonly budget: BudgetService,
  ) {}

  /**
   * The A-33 figures for the current billing period, with the cache ratio measured
   * over `window`.
   *
   * The two spans are deliberately different. Budget is a **period** question — the
   * ledger resets on the boundary (§4.26) and "remaining budget" means remaining this
   * month, whatever window an admin is looking at. Cache effectiveness is a
   * **behavioural** question and is honest over any window.
   */
  async usage(window: AnalyticsWindow, now: Date = new Date()): Promise<UsageAnalyticsResponseDto> {
    const [overview, cacheHits, billedCalls] = await Promise.all([
      this.budget.overview(now),
      this.countJobs(window, true),
      this.countJobs(window, false),
    ]);

    const projection = projectBudgetExhaustion(
      {
        remaining: overview.budget.remaining,
        trailingDailyRate: overview.trailingDailyRate,
        resetsAt: overview.budget.resetsAt,
      },
      now,
    );

    const dto = new UsageAnalyticsResponseDto();
    dto.budget = overview.budget;
    dto.consumerGenerations = overview.consumerGenerations;
    dto.testRenders = overview.testRenders;
    dto.trailingDailyRate = projection.trailingDailyRate;
    dto.projectedExhaustionAt = projection.projectedExhaustionAt;
    dto.daysRemaining = projection.daysRemaining;
    dto.cacheHits = cacheHits;
    dto.billedCalls = billedCalls;
    dto.cacheHitRate = percent(cacheHits, cacheHits + billedCalls);
    return dto;
  }

  /**
   * Completed generations in the window, by whether they were served from cache.
   *
   * `SUCCEEDED` only: a job that failed neither hit the cache nor was billed, and
   * counting it on either side would make the ratio a statement about reliability
   * rather than about caching. `IDX_tryon_jobs_status_createdAt` (§4.17) is exactly this
   * shape of predicate, and `count()` returns a number rather than rows.
   */
  private countJobs(window: AnalyticsWindow, cacheHit: boolean): Promise<number> {
    return this.jobs.count({
      where: {
        status: In([JobStatus.SUCCEEDED]),
        cacheHit,
        createdAt: Between(window.from, window.to),
      },
    });
  }
}
