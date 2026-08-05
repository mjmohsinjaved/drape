import { ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

import {
  DEFAULT_ANALYTICS_WINDOW_DAYS,
  LEADERBOARD_LIMIT,
  MAX_ANALYTICS_WINDOW_DAYS,
  MAX_LEADERBOARD_LIMIT,
} from '../constants/analytics.constants';

/**
 * The reporting window every analytics route takes — ARCHITECTURE §5.18.
 *
 * `days` is the ergonomic form ("the last 30") and `from`/`to` the precise one. Giving
 * `from` wins over `days`; the resolver ({@link resolveAnalyticsWindow}) is the single
 * place that decides, so no two routes can interpret the same query string differently.
 *
 * `days` is bounded by the validator **and** by the resolver. Twice on purpose: the
 * validator stops a query string, and the resolver stops a service that constructs a
 * window itself.
 */
export class AnalyticsWindowQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_ANALYTICS_WINDOW_DAYS,
    default: DEFAULT_ANALYTICS_WINDOW_DAYS,
    description: 'How many days back to report over. Ignored when `from` is given.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ANALYTICS_WINDOW_DAYS)
  days: number = DEFAULT_ANALYTICS_WINDOW_DAYS;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Start of the window. Wins over `days`.',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'End of the window. Defaults to now.' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

/** `GET /admin/analytics/garments` and `.../categories` (A-37, A-39). */
export class LeaderboardQueryDto extends AnalyticsWindowQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_LEADERBOARD_LIMIT,
    default: LEADERBOARD_LIMIT,
    description: 'Rows to return. Bounded — a leaderboard is a top list, not an export.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LEADERBOARD_LIMIT)
  limit: number = LEADERBOARD_LIMIT;
}
