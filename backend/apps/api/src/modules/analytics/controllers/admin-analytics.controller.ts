import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiStandardResponses, ResponseMessage, Role, Roles } from '@library/common';

import { AnalyticsWindowQueryDto, LeaderboardQueryDto } from '../dto/analytics-query.dto';
import {
  ActivityResponseDto,
  AdminOverviewResponseDto,
  CategoryPerformanceResponseDto,
  FunnelResponseDto,
  GarmentLeaderboardResponseDto,
  GenerationHealthResponseDto,
  RejectionReasonsResponseDto,
} from '../dto/analytics-response.dto';
import { resolveAnalyticsWindow } from '../queries/analytics-window';
import { CatalogAnalyticsService } from '../services/catalog-analytics.service';
import { FunnelService } from '../services/funnel.service';
import { GenerationHealthService } from '../services/generation-health.service';
import { OverviewService } from '../services/overview.service';

/**
 * The A-33 / A-36 … A-39 / E-13 reports — ARCHITECTURE §5.18.
 *
 * **Every handler is `@Roles(Role.ADMIN)`.** These are platform-wide aggregates, and
 * there is no consumer-facing analytics route in the product.
 *
 * ### What none of these routes can return
 *
 * A consumer's photograph, a consumer's render, or a consumer's identity beyond what
 * A-16 already authorises. That is a property of the queries, not of this file: every
 * one of them is a `COUNT`, a `SUM` or a `GROUP BY` over garments, categories, reasons
 * or hours, and `person_photos` appears in exactly one of them as
 * `COUNT(DISTINCT "userId")` for the A-36 funnel. No route here selects a storage key,
 * signs a URL, or groups by a consumer (S-10, A-16).
 *
 * ### Windows are bounded, and refused rather than clamped
 *
 * Every route takes `?days=` or `?from=&to=`, resolved by `resolveAnalyticsWindow`,
 * which refuses anything wider than a year. Quietly clamping a two-year request to one
 * would hand an admin a chart that does not say what she thinks it says.
 */
@ApiTags('Analytics')
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(
    private readonly overviewService: OverviewService,
    private readonly funnelService: FunnelService,
    private readonly catalog: CatalogAnalyticsService,
    private readonly health: GenerationHealthService,
  ) {}

  @Get('overview')
  @Roles(Role.ADMIN)
  @ResponseMessage('Overview retrieved successfully')
  @ApiOperation({
    summary: 'The A-1 landing tiles, with the A-33 usage block (§5.18)',
    description:
      'New enquiries, stale enquiries (A-25), garments awaiting an approved test render, ' +
      'garments flagged for review, and moderation items pending — plus the full A-33 ' +
      'usage figures including **cache hits versus billed calls**, which `GET /admin/usage` ' +
      'structurally cannot produce because a cache hit writes no ledger row (C-22).',
  })
  @ApiOkResponse({ type: AdminOverviewResponseDto })
  @ApiStandardResponses()
  overview(@Query() query: AnalyticsWindowQueryDto): Promise<AdminOverviewResponseDto> {
    return this.overviewService.overview(resolveAnalyticsWindow(query));
  }

  @Get('funnel')
  @Roles(Role.ADMIN)
  @ResponseMessage('Funnel retrieved successfully')
  @ApiOperation({
    summary: 'signups → email verified → photo uploaded → first try-on → ≥1 star → enquiry (A-36)',
    description:
      'A **cohort** funnel: every step counts consumers who signed up inside the window, ' +
      'whenever they reached that step. Six independent aggregate queries rather than five ' +
      'joins, so no plan degrades as one popular consumer accumulates renders.',
  })
  @ApiOkResponse({ type: FunnelResponseDto })
  @ApiStandardResponses()
  funnel(@Query() query: AnalyticsWindowQueryDto): Promise<FunnelResponseDto> {
    return this.funnelService.funnel(resolveAnalyticsWindow(query));
  }

  @Get('garments')
  @Roles(Role.ADMIN)
  @ResponseMessage('Garment leaderboard retrieved successfully')
  @ApiOperation({
    summary: 'Leaderboard: most tried, star rate, reject rate, enquiry rate (A-37)',
    description:
      'All three rates share a denominator — **try-ons** — so a piece two people tried and ' +
      'one starred does not appear as "100% loved". Garments below the minimum try-on floor ' +
      'are excluded in SQL rather than filtered afterwards.',
  })
  @ApiOkResponse({ type: GarmentLeaderboardResponseDto })
  @ApiStandardResponses()
  garments(@Query() query: LeaderboardQueryDto): Promise<GarmentLeaderboardResponseDto> {
    return this.catalog.garmentLeaderboard(resolveAnalyticsWindow(query), query.limit);
  }

  @Get('rejection-reasons')
  @Roles(Role.ADMIN)
  @ResponseMessage('Rejection reasons retrieved successfully')
  @ApiOperation({
    summary: 'Rollup by neckline, colour, weight, silhouette and price (A-38)',
    description:
      'Read from the `NOT_FOR_ME` rows on `shortlist_items`, which §4.20 retains for exactly ' +
      'this. `rejectReason` is nullable (C-21 lets her decline to say), and those rows are ' +
      'reported as `UNSTATED` rather than dropped — excluding them would overstate every ' +
      'stated reason.',
  })
  @ApiOkResponse({ type: RejectionReasonsResponseDto })
  @ApiStandardResponses()
  rejectionReasons(@Query() query: AnalyticsWindowQueryDto): Promise<RejectionReasonsResponseDto> {
    return this.catalog.rejectionReasons(resolveAnalyticsWindow(query));
  }

  @Get('categories')
  @Roles(Role.ADMIN)
  @ResponseMessage('Category performance retrieved successfully')
  @ApiOperation({
    summary: 'Category performance (A-39)',
    description:
      'Grouped on `tryon_results.garmentCategorySnapshot` rather than joined to the live ' +
      'table, so recategorising the catalogue today does not silently rewrite last ' +
      "month's report (C-29).",
  })
  @ApiOkResponse({ type: CategoryPerformanceResponseDto })
  @ApiStandardResponses()
  categories(@Query() query: LeaderboardQueryDto): Promise<CategoryPerformanceResponseDto> {
    return this.catalog.categoryPerformance(resolveAnalyticsWindow(query), query.limit);
  }

  @Get('activity')
  @Roles(Role.ADMIN)
  @ResponseMessage('Activity retrieved successfully')
  @ApiOperation({
    summary: 'Activity by hour and day (A-39)',
    description:
      'Extracted in `TIMEZONE`, not UTC — the same setting the ledger period boundary uses, ' +
      'so a chart and a bill never disagree about which day it is. Sparse: only cells with ' +
      'activity are returned.',
  })
  @ApiOkResponse({ type: ActivityResponseDto })
  @ApiStandardResponses()
  activity(@Query() query: AnalyticsWindowQueryDto): Promise<ActivityResponseDto> {
    return this.catalog.activity(resolveAnalyticsWindow(query));
  }

  @Get('generation-health')
  @Roles(Role.ADMIN)
  @ResponseMessage('Generation health retrieved successfully')
  @ApiOperation({
    summary: 'Latency distribution, failure rate by error code, cache hit rate (E-13)',
    description:
      'Percentiles are computed by PostgreSQL with `PERCENTILE_CONT`, not by fetching a ' +
      'column of durations and sorting it — the second would stop working exactly when ' +
      'latency became worth looking at. This is also the screen the E-14 failure-rate alert ' +
      'links to.',
  })
  @ApiOkResponse({ type: GenerationHealthResponseDto })
  @ApiStandardResponses()
  generationHealth(@Query() query: AnalyticsWindowQueryDto): Promise<GenerationHealthResponseDto> {
    return this.health.health(resolveAnalyticsWindow(query));
  }
}
