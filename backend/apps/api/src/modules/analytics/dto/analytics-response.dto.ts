import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { FUNNEL_STEPS, type FunnelStep } from '@library/common';

import { BudgetSnapshotResponseDto } from '@api/modules/quota/dto/usage-response.dto';

/**
 * **A-33 — the usage dashboard.**
 *
 * > "Generations this month, remaining budget, projected exhaustion from a 7-day
 * > trailing rate, split between consumer try-ons and admin test renders, plus **cache
 * > hits versus billed calls**."
 *
 * The last clause is why this block lives here rather than only on `GET /admin/usage`
 * (§5.16). `quota`'s own DTO says so in as many words: cache hits write no ledger row
 * in either table (C-22), so the ratio "lives on `tryon_cache`, which `TryOnModule`
 * owns … when that module lands it should surface the ratio beside these numbers rather
 * than this module reaching into its table". This module is the one that legitimately
 * reads both, so this is where the two halves meet.
 */
export class UsageAnalyticsResponseDto {
  @ApiProperty({ type: BudgetSnapshotResponseDto })
  budget: BudgetSnapshotResponseDto;

  @ApiProperty({ example: 1540, description: 'Consumer try-ons charged this period (A-33).' })
  consumerGenerations: number;

  @ApiProperty({ example: 72, description: 'Admin test renders charged this period (A-33).' })
  testRenders: number;

  @ApiProperty({ example: 218.4, description: 'Generations per day over the trailing 7 days.' })
  trailingDailyRate: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date-time',
    description:
      'Projected exhaustion at the trailing rate. Null when the rate is zero, when the ' +
      'budget is already spent, or when it lasts past the period boundary (A-33).',
  })
  projectedExhaustionAt: Date | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 1.8,
    description: 'Days of budget left at the trailing rate. Null when the rate is zero.',
  })
  daysRemaining: number | null;

  @ApiProperty({
    example: 431,
    description: 'Generations served from `tryon_cache` in the window — charged nothing (C-22).',
  })
  cacheHits: number;

  @ApiProperty({
    example: 1612,
    description: 'Generations that actually reached the upstream and cost money.',
  })
  billedCalls: number;

  @ApiProperty({
    example: 21.1,
    description: 'Cache hits as a percentage of all completed generations (E-13).',
  })
  cacheHitRate: number;
}

/** The A-1 landing tiles — ARCHITECTURE §5.18. */
export class AdminOverviewResponseDto {
  @ApiProperty({ example: 7, description: 'Enquiries still at `NEW` (A-1).' })
  newEnquiries: number;

  @ApiProperty({
    example: 2,
    description: 'Enquiries untouched for more than 24 hours — the A-25 stale highlight.',
  })
  staleEnquiries: number;

  @ApiProperty({ example: 4, description: 'Garments waiting on an approved test render (A-1).' })
  garmentsAwaitingTestRender: number;

  @ApiProperty({ example: 1, description: 'Garments flagged for review (A-1).' })
  garmentsFlaggedForReview: number;

  @ApiProperty({ example: 3, description: 'Moderation items pending a decision (A-1, A-34).' })
  moderationItemsPending: number;

  @ApiProperty({
    type: UsageAnalyticsResponseDto,
    description: 'Generations used against the monthly budget (A-1), with the A-33 figures.',
  })
  usage: UsageAnalyticsResponseDto;
}

/** One step of the A-36 funnel. */
export class FunnelStepResponseDto {
  @ApiProperty({ enum: FUNNEL_STEPS, example: 'PHOTO_UPLOADED' })
  step: FunnelStep;

  @ApiProperty({ example: 412 })
  count: number;

  @ApiProperty({ example: 46.3, description: 'Percent of the signup cohort that reached here.' })
  conversionFromStart: number;

  @ApiProperty({ example: 71.2, description: 'Percent of the previous step that reached here.' })
  conversionFromPrevious: number;

  @ApiProperty({ example: 167, description: 'Consumers lost since the previous step.' })
  droppedFromPrevious: number;
}

/** `GET /admin/analytics/funnel` (A-36). */
export class FunnelResponseDto {
  @ApiProperty({ format: 'date-time' })
  from: Date;

  @ApiProperty({ format: 'date-time' })
  to: Date;

  @ApiProperty({
    example: 890,
    description: 'The signup cohort. Every step counts members of *this* set (A-36).',
  })
  cohortSize: number;

  @ApiProperty({ type: [FunnelStepResponseDto] })
  steps: FunnelStepResponseDto[];
}

/** One row of the A-37 leaderboard. */
export class GarmentLeaderboardRowDto {
  @ApiProperty({ format: 'uuid' })
  garmentId: string;

  @ApiProperty({ example: 'Anarkali in ivory' })
  title: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Bridal' })
  categoryName: string | null;

  @ApiProperty({ example: 128 })
  tryOns: number;

  @ApiProperty({ example: 61, description: '`LOVE_IT` or `MAYBE` (§4.20).' })
  stars: number;

  @ApiProperty({ example: 22, description: '`NOT_FOR_ME` (§4.20).' })
  rejects: number;

  @ApiProperty({ example: 9 })
  enquiries: number;

  @ApiProperty({ example: 47.7, description: 'Stars as a percent of **try-ons** (A-37).' })
  starRate: number;

  @ApiProperty({ example: 17.2 })
  rejectRate: number;

  @ApiProperty({ example: 7 })
  enquiryRate: number;

  @ApiProperty({
    example: 64.8,
    description:
      'Verdicts as a percent of try-ons. A low star rate with low coverage means ' +
      'ignored, not disliked — two different problems.',
  })
  verdictCoverage: number;
}

/** `GET /admin/analytics/garments` (A-37). */
export class GarmentLeaderboardResponseDto {
  @ApiProperty({ format: 'date-time' })
  from: Date;

  @ApiProperty({ format: 'date-time' })
  to: Date;

  @ApiProperty({
    example: 3,
    description: 'Try-ons a garment needs before it appears. One star out of one try is not 100%.',
  })
  minimumTryOns: number;

  @ApiProperty({ type: [GarmentLeaderboardRowDto] })
  garments: GarmentLeaderboardRowDto[];
}

/** One row of the A-38 rollup. */
export class RejectionReasonRowDto {
  @ApiProperty({
    example: 'TOO_HEAVY',
    description: '`NECKLINE`, `COLOR`, `TOO_HEAVY`, `SILHOUETTE`, `PRICE`, or `UNSTATED` (C-21).',
  })
  reason: string;

  @ApiProperty({ example: 87 })
  count: number;

  @ApiProperty({ example: 31.4, description: 'Percent of all rejections in the window.' })
  share: number;
}

/** `GET /admin/analytics/rejection-reasons` (A-38). */
export class RejectionReasonsResponseDto {
  @ApiProperty({ format: 'date-time' })
  from: Date;

  @ApiProperty({ format: 'date-time' })
  to: Date;

  @ApiProperty({ example: 277, description: '`NOT_FOR_ME` verdicts in the window (§4.20).' })
  totalRejections: number;

  @ApiProperty({ type: [RejectionReasonRowDto] })
  reasons: RejectionReasonRowDto[];
}

/** One category's performance (A-39). */
export class CategoryPerformanceRowDto {
  @ApiProperty({ format: 'uuid' })
  categoryId: string;

  @ApiProperty({ example: 'Bridal' })
  name: string;

  @ApiProperty({ example: 42 })
  publishedGarments: number;

  @ApiProperty({ example: 1_284 })
  tryOns: number;

  @ApiProperty({ example: 611 })
  stars: number;

  @ApiProperty({ example: 96 })
  enquiries: number;

  @ApiProperty({ example: 47.6 })
  starRate: number;

  @ApiProperty({ example: 7.5 })
  enquiryRate: number;
}

/** `GET /admin/analytics/categories` (A-39). */
export class CategoryPerformanceResponseDto {
  @ApiProperty({ format: 'date-time' })
  from: Date;

  @ApiProperty({ format: 'date-time' })
  to: Date;

  @ApiProperty({ type: [CategoryPerformanceRowDto] })
  categories: CategoryPerformanceRowDto[];
}

/** One cell of the A-39 activity grid. */
export class ActivityCellDto {
  @ApiProperty({ example: 3, description: '0 = Sunday, matching PostgreSQL `EXTRACT(DOW)`.' })
  dayOfWeek: number;

  @ApiProperty({ example: 21, description: 'Hour of the day, 0–23, in `TIMEZONE`.' })
  hour: number;

  @ApiProperty({ example: 44 })
  generations: number;
}

/** `GET /admin/analytics/activity` (A-39). */
export class ActivityResponseDto {
  @ApiProperty({ format: 'date-time' })
  from: Date;

  @ApiProperty({ format: 'date-time' })
  to: Date;

  @ApiProperty({ example: 'Asia/Karachi', description: '`TIMEZONE` — the grid is local, not UTC.' })
  timeZone: string;

  @ApiProperty({
    type: [ActivityCellDto],
    description: 'Sparse: only cells with activity. A 168-cell dense grid is mostly zeroes.',
  })
  cells: ActivityCellDto[];

  @ApiProperty({ example: 21, description: 'Busiest hour in the window.' })
  peakHour: number;

  @ApiProperty({ example: 5, description: 'Busiest day of week in the window.' })
  peakDayOfWeek: number;
}

/** One latency bucket (E-13). */
export class LatencyBucketDto {
  @ApiProperty({ example: 7000, description: 'Upper bound in ms. The last bucket is unbounded.' })
  upperBoundMs: number | null;

  @ApiProperty({ example: 812 })
  count: number;
}

/** One error code and how often it happened (E-13). */
export class FailureCodeDto {
  @ApiProperty({ example: 'UPSTREAM_TIMEOUT' })
  errorCode: string;

  @ApiProperty({ example: 14 })
  count: number;

  @ApiProperty({ example: 0.9, description: 'Percent of all generations in the window.' })
  rate: number;
}

/** `GET /admin/analytics/generation-health` (E-13). */
export class GenerationHealthResponseDto {
  @ApiProperty({ format: 'date-time' })
  from: Date;

  @ApiProperty({ format: 'date-time' })
  to: Date;

  @ApiProperty({ example: 1_640 })
  total: number;

  @ApiProperty({ example: 1_598 })
  succeeded: number;

  @ApiProperty({ example: 42 })
  failed: number;

  @ApiProperty({ example: 2.6, description: 'E-14 alerts above 4%.' })
  failureRatePercent: number;

  @ApiProperty({ example: 21.1, description: 'Cache hits as a percent of completed jobs (E-13).' })
  cacheHitRate: number;

  @ApiProperty({ example: 6_940, description: 'Median end-to-end duration in ms.' })
  p50LatencyMs: number;

  @ApiProperty({ example: 11_200 })
  p95LatencyMs: number;

  @ApiProperty({ type: [LatencyBucketDto] })
  latencyBuckets: LatencyBucketDto[];

  @ApiProperty({ type: [FailureCodeDto], description: 'Failure rate by error code (E-13).' })
  failuresByCode: FailureCodeDto[];
}
