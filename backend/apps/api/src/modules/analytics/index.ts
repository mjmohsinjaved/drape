/**
 * The `analytics` module's public surface — ARCHITECTURE §5.18.
 *
 * **No service is exported.** This module reads other modules' tables and returns
 * aggregates to a browser; nothing in the application needs a report, and a service
 * exported from here would be an invitation to make a business decision on a number
 * that was computed for a chart.
 *
 * What *is* exported is the arithmetic — five pure functions with no database, no Nest
 * container and no I/O between them:
 *
 * | Function | Answers |
 * | --- | --- |
 * | `projectBudgetExhaustion` | A-33 — when the budget runs out at the 7-day trailing rate |
 * | `trailingDailyRate` | A-33 — spend over the trailing window, per day |
 * | `buildFunnel` | A-36 — the six steps, with both conversion rates and the drop-off |
 * | `buildLeaderboardRow` | A-37 — star, reject and enquiry rates, all per try-on |
 * | `buildRejectionRollup` | A-38 — the reason rollup, `UNSTATED` included |
 *
 * They are exported because they are worth testing on their own (E-5) and because
 * `quota` should eventually call `projectBudgetExhaustion` rather than keep its own
 * private copy — see that function's own note.
 */
export { AnalyticsModule } from './analytics.module';

export {
  resolveAnalyticsWindow,
  type AnalyticsWindow,
  type AnalyticsWindowRequest,
} from './queries/analytics-window';
export {
  TRAILING_WINDOW_DAYS,
  projectBudgetExhaustion,
  trailingDailyRate,
  type BudgetProjection,
  type BudgetProjectionInput,
} from './queries/budget-projection';
export {
  buildFunnel,
  percent,
  type FunnelCounts,
  type FunnelStepResult,
} from './queries/funnel-math';
export {
  buildLeaderboardRow,
  buildRejectionRollup,
  count,
  type GarmentCountsRaw,
  type GarmentLeaderboardRow,
  type RejectionReasonRow,
} from './queries/leaderboard-math';

export { AnalyticsWindowQueryDto, LeaderboardQueryDto } from './dto/analytics-query.dto';
export {
  ActivityCellDto,
  ActivityResponseDto,
  AdminOverviewResponseDto,
  CategoryPerformanceResponseDto,
  CategoryPerformanceRowDto,
  FailureCodeDto,
  FunnelResponseDto,
  FunnelStepResponseDto,
  GarmentLeaderboardResponseDto,
  GarmentLeaderboardRowDto,
  GenerationHealthResponseDto,
  LatencyBucketDto,
  RejectionReasonRowDto,
  RejectionReasonsResponseDto,
  UsageAnalyticsResponseDto,
} from './dto/analytics-response.dto';

export {
  DEFAULT_ANALYTICS_WINDOW_DAYS,
  GENERATION_FAILURE_MIN_SAMPLE,
  GENERATION_FAILURE_THRESHOLD_PERCENT,
  GENERATION_FAILURE_WINDOW_MINUTES,
  GENERATION_HEALTH_SWEEP_MS,
  LATENCY_BUCKETS_MS,
  LEADERBOARD_LIMIT,
  LEADERBOARD_MIN_TRYONS,
  MAX_ANALYTICS_WINDOW_DAYS,
  MAX_LEADERBOARD_LIMIT,
} from './constants/analytics.constants';
