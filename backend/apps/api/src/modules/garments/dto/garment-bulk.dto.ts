import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsUUID,
  ValidateIf,
} from 'class-validator';

/** The record-level bulk actions (A-12). Bulk test renders belong to the try-on module. */
export enum GarmentBulkAction {
  PUBLISH = 'PUBLISH',
  UNPUBLISH = 'UNPUBLISH',
  ARCHIVE = 'ARCHIVE',
  RECATEGORISE = 'RECATEGORISE',
}

/**
 * One request writes at most this many garments. The cap keeps a single admin action
 * from holding a connection long enough to matter, and D-16's per-item result list
 * stays a readable screen rather than a scroll.
 */
export const MAX_BULK_GARMENTS = 100;

/**
 * `POST /admin/garments/bulk` — A-12, D-16.
 *
 * Every item is applied through the same service methods the single-garment routes
 * use, so a bulk publish is subject to the A-11 test-render gate and the A-10 quality
 * gate exactly as an individual publish is. There is no bulk path around a gate.
 */
export class GarmentBulkDto {
  @ApiProperty({ enum: GarmentBulkAction })
  @IsEnum(GarmentBulkAction)
  action: GarmentBulkAction;

  @ApiProperty({ type: [String], format: 'uuid', maxItems: MAX_BULK_GARMENTS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_GARMENTS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  garmentIds: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Destination category. Required when `action = RECATEGORISE`.',
  })
  // No `@IsOptional()`: with it, an omitted categoryId would pass validation on a
  // RECATEGORISE and fail deep in the service instead of in the §2.3 envelope.
  @ValidateIf((dto: GarmentBulkDto) => dto.action === GarmentBulkAction.RECATEGORISE)
  @IsUUID()
  categoryId?: string;
}
