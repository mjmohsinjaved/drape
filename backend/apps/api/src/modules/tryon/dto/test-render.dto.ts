import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * A-12 caps a bulk selection. Each item is a real generation against a real budget, so
 * the ceiling is deliberately low enough that the cost estimate stays comprehensible.
 */
export const MAX_BULK_TEST_RENDERS = 50;

/** `POST /admin/tryon/test-render` — A-11, one garment against one reference model. */
export class RunTestRenderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  garmentId: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Omit for the default reference model (§4.15).',
  })
  @IsOptional()
  @IsUUID()
  referenceModelId?: string;
}

/**
 * `POST /admin/tryon/test-render/bulk` — A-12, §8.2.
 *
 * Returns a `batchId` immediately; the items are processed at concurrency **one** by
 * the scheduled processor, so catalogue work never competes with a live consumer
 * generation.
 */
export class BulkTestRenderDto {
  @ApiProperty({ type: [String], format: 'uuid', maxItems: MAX_BULK_TEST_RENDERS })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_TEST_RENDERS)
  @IsUUID('4', { each: true })
  garmentIds: string[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  referenceModelId?: string;
}

/**
 * `POST /admin/garments/:garmentId/test-render/reject` — A-11.
 *
 * The reason is required. A rejected test render leaves the piece unpublishable, and an
 * admin coming back to it a week later needs to know whether the photograph was wrong
 * or the render was.
 */
export class RejectTestRenderDto {
  @ApiProperty({ maxLength: 255, example: 'Drape falls wrong at the shoulder.' })
  @IsString()
  @MaxLength(255)
  reason: string;
}

/** A-12 — the cost estimate shown and confirmed before a bulk run (`/bulk/estimate`). */
export class TestRenderEstimateDto {
  @ApiProperty({ type: [String], format: 'uuid', maxItems: MAX_BULK_TEST_RENDERS })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_TEST_RENDERS)
  @IsUUID('4', { each: true })
  garmentIds: string[];
}
