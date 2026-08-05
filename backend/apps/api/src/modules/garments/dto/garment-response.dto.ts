import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { EmbellishmentWeight } from '../enums/embellishment-weight.enum';
import { GarmentMode } from '../enums/garment-mode.enum';
import { PublishState } from '../enums/publish-state.enum';
import { TestRenderState } from '../enums/test-render-state.enum';

/** One A-10 check outcome, as the console renders it beside the source image. */
export class GarmentQualityCheckDto {
  @ApiProperty({ example: 'LONG_EDGE' })
  check: string;

  @ApiProperty()
  passed: boolean;

  @ApiProperty({ description: '0–100 contribution of this check.', example: 25 })
  score: number;

  @ApiPropertyOptional({ nullable: true, description: 'Shown when `passed` is false.' })
  remediation: string | null;
}

/**
 * The **admin** garment record — `GET /admin/garments`, and every admin mutation
 * response (§5.6).
 *
 * This type is admin-only and stays that way. Quality scores, the publish state, the
 * test-render bookkeeping, the failure counter and the SKU are all here because an
 * admin needs them; every one of them is a field the public catalog must never
 * carry, which is why `catalog` has its own `PublicGarmentResponseDto` rather than
 * reusing this class with fields blanked out. A blanked field is one refactor away
 * from being populated again.
 */
export class GarmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ZBL-00042' })
  sku: string;

  @ApiProperty({ example: 'Zarrin Bridal Lehenga' })
  title: string;

  @ApiPropertyOptional({ nullable: true })
  titleUr: string | null;

  @ApiProperty({ example: 'zarrin-bridal-lehenga' })
  slug: string;

  @ApiProperty({ format: 'uuid' })
  categoryId: string;

  @ApiPropertyOptional({ nullable: true, description: 'Denormalised for the list screen.' })
  categoryName: string | null;

  @ApiProperty({ type: [String] })
  colors: string[];

  @ApiPropertyOptional({ nullable: true })
  fabric: string | null;

  @ApiProperty({ enum: EmbellishmentWeight })
  embellishmentWeight: EmbellishmentWeight;

  @ApiProperty({ example: 185000 })
  price: number;

  @ApiProperty({ example: 'PKR' })
  currency: string;

  @ApiProperty({ enum: GarmentMode })
  mode: GarmentMode;

  @ApiPropertyOptional({ nullable: true, description: 'Set only when `mode = RENTAL`.' })
  deposit: number | null;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiPropertyOptional({ nullable: true })
  descriptionUr: string | null;

  @ApiProperty({ type: [String] })
  sizes: string[];

  @ApiProperty({ type: [String] })
  styleTags: string[];

  @ApiProperty({ enum: PublishState })
  publishState: PublishState;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  publishedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, description: '0–100 (A-10).' })
  qualityScore: number | null;

  @ApiProperty({ type: [GarmentQualityCheckDto] })
  qualityChecks: GarmentQualityCheckDto[];

  @ApiProperty({ description: 'A-10 override recorded; publishing below threshold is permitted.' })
  qualityOverridden: boolean;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  qualityOverriddenBy: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  qualityOverriddenAt: Date | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'A-11 test render.' })
  testRenderId: string | null;

  @ApiProperty({ enum: TestRenderState })
  testRenderState: TestRenderState;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  testRenderApprovedAt: Date | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  approvedBy: string | null;

  @ApiProperty({ description: 'Set by UPSTREAM_NO_GARMENT_DETECTED (A-15).' })
  flaggedForReview: boolean;

  @ApiProperty({
    description:
      'Whether the A-11 and A-10 publish gates would currently pass. The console uses ' +
      'it to disable Publish rather than offer an action the API will refuse (D-5).',
  })
  publishable: boolean;

  @ApiProperty({ example: 0 })
  tryOnCount: number;

  @ApiProperty({ example: 0 })
  loveCount: number;

  @ApiProperty({ example: 0 })
  maybeCount: number;

  @ApiProperty({ example: 0 })
  rejectCount: number;

  @ApiProperty({ example: 0 })
  enquiryCount: number;

  @ApiProperty({ example: 0 })
  failureCount: number;

  @ApiProperty({
    description: 'Love share of all verdicts cast, 0–1. `null` before the first verdict (A-14).',
    nullable: true,
    example: 0.72,
  })
  starRate: number | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  lastTriedAt: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt: Date;
}

/** One item of a `POST /admin/garments/bulk` outcome (A-12, D-16). */
export class GarmentBulkItemResultDto {
  @ApiProperty({ format: 'uuid' })
  garmentId: string;

  @ApiProperty()
  succeeded: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'A member of the closed ErrorCode set when this item failed.',
  })
  errorCode: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Safe to display (§2.3).' })
  message: string | null;
}

/**
 * `POST /admin/garments/bulk` (A-12, D-16).
 *
 * Per-item results, because a bulk action across forty pieces where three fail is
 * neither a success nor a failure — D-16 wants the three named.
 */
export class GarmentBulkResultDto {
  @ApiProperty()
  requested: number;

  @ApiProperty()
  succeeded: number;

  @ApiProperty()
  failed: number;

  @ApiProperty({ type: [GarmentBulkItemResultDto] })
  results: GarmentBulkItemResultDto[];
}
