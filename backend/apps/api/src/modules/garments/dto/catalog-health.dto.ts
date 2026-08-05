import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import {
  DEFAULT_CATALOG_HEALTH_SAMPLE,
  MAX_CATALOG_HEALTH_SAMPLE,
} from '../services/catalog-health.cohorts';

import { GarmentResponseDto } from './garment-response.dto';

/**
 * `GET /admin/catalog-health` — PRD A-15, ARCHITECTURE §5.6.
 *
 * The only knob is how many example rows come back per cohort. The **counts** are
 * always true totals: they are computed by one aggregate query over the whole
 * catalogue, so there is nothing here that could make them a page.
 */
export class CatalogHealthQueryDto {
  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_CATALOG_HEALTH_SAMPLE,
    default: DEFAULT_CATALOG_HEALTH_SAMPLE,
    description:
      'Example rows returned per cohort, so the panel can link each one straight to its ' +
      'remedy. `0` returns counts only. Bounded — a larger value is refused, not clamped.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_CATALOG_HEALTH_SAMPLE)
  sample: number = DEFAULT_CATALOG_HEALTH_SAMPLE;
}

/**
 * One cohort: how many pieces are in it across the whole catalogue, and a bounded
 * sample of them.
 *
 * `total` is a `COUNT(*)` and is never a floor. That distinction is the whole reason
 * this route exists — the console used to compose the panel from two bounded list
 * sweeps and had to label its own numbers as a minimum when it hit the ceiling.
 */
export class CatalogHealthCohortDto {
  @ApiProperty({ description: 'True total across the catalogue, not a page count.' })
  total: number;

  @ApiProperty({
    type: [GarmentResponseDto],
    description: 'At most `sample` rows, ordered worst-first for this cohort.',
  })
  items: GarmentResponseDto[];
}

/** The thresholds the counts were computed against, so the panel can state them. */
export class CatalogHealthThresholdsDto {
  @ApiProperty({ description: '`quality.minScore` (A-10).' })
  minQualityScore: number;

  @ApiProperty({ description: 'Attempts needed before a failure rate is meaningful.' })
  minFailureAttempts: number;

  @ApiProperty({ description: 'Percentage of attempts that must have failed.' })
  failureRatePercent: number;

  @ApiProperty({ description: "A-15's window, in days." })
  staleTryOnDays: number;
}

/** `GET /admin/catalog-health` — the whole panel in one response (A-15). */
export class CatalogHealthResponseDto {
  @ApiProperty({ format: 'date-time', description: 'When the counts were taken.' })
  generatedAt: Date;

  @ApiProperty({
    description:
      'Live, non-archived garments the cohorts were evaluated over. An archived piece ' +
      'was retired on purpose (A-13) and is out of scope.',
  })
  inspected: number;

  @ApiProperty({ description: 'The `sample` actually applied.' })
  sampleLimit: number;

  @ApiProperty({ type: CatalogHealthThresholdsDto })
  thresholds: CatalogHealthThresholdsDto;

  @ApiProperty({ type: CatalogHealthCohortDto, description: 'A-11 — no approved test render.' })
  missingTestRender: CatalogHealthCohortDto;

  @ApiProperty({ type: CatalogHealthCohortDto, description: 'A-10 — below the pass mark.' })
  lowQualityScore: CatalogHealthCohortDto;

  @ApiProperty({ type: CatalogHealthCohortDto, description: '§8.3 — repeated upstream failures.' })
  elevatedFailureRate: CatalogHealthCohortDto;

  @ApiProperty({ type: CatalogHealthCohortDto, description: 'Published, untried for 30 days.' })
  zeroTryOnsIn30Days: CatalogHealthCohortDto;
}
