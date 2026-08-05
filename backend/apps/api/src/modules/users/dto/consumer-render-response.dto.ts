import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsIn, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '@library/common';

/** Sortable columns for `GET /admin/consumers/:userId/renders`. */
export const ADMIN_RENDER_SORTABLE_COLUMNS = ['createdAt'] as const;

export class ConsumerRenderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ADMIN_RENDER_SORTABLE_COLUMNS, default: 'createdAt' })
  @IsOptional()
  @IsIn(ADMIN_RENDER_SORTABLE_COLUMNS)
  override sortBy: string = 'createdAt';
}

/**
 * One render an admin is allowed to see — `GET /admin/consumers/:userId/renders`
 * (A-17, S-10).
 *
 * Every row in this list came through `enquiry_items`, "the sole basis on which an
 * admin may view a render" (§4.24). A render she generated and never attached to an
 * enquiry has no route to this DTO.
 *
 * `url` and `thumbnailUrl` are finished, signed, short-lived URLs scoped to the
 * **requesting admin's** session (§3.4). The underlying storage key is read by the
 * service and discarded — a storage key never crosses the network boundary.
 */
export class ConsumerRenderResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ description: 'Signed, expiring URL scoped to the requesting admin.' })
  url: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  thumbnailUrl: string | null;

  @ApiProperty({ description: 'Snapshot taken when the render was produced (C-29).' })
  garmentTitle: string;

  @ApiProperty()
  garmentCategory: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  garmentPrice: number | null;

  @ApiProperty({ example: 'PKR' })
  garmentCurrency: string;

  @ApiProperty()
  width: number;

  @ApiProperty()
  height: number;

  @ApiProperty({ format: 'uuid', description: 'The enquiry that makes this render visible.' })
  enquiryId: string;

  @ApiProperty({ example: 'ENQ-2026-000137' })
  enquiryReference: string;
}
