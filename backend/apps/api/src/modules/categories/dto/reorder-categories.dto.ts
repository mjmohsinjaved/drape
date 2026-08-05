import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';

/** No sibling set in a fashion taxonomy is anywhere near this large; the cap bounds the write. */
export const MAX_REORDER_BATCH = 200;

/**
 * `POST /admin/categories/reorder` — A-4 / A-6.
 *
 * The payload is the **complete sibling set in the order it should appear**, not a
 * sparse list of moves. Sending the whole set is what makes the write idempotent and
 * the resulting order unambiguous: positions are re-numbered `0…n-1` from this array
 * inside one transaction, so two admins reordering concurrently produce one of the
 * two intended orders rather than an interleaving of both.
 *
 * `CategoriesService` refuses a partial set (`VALIDATION_ERROR`) — renumbering half a
 * sibling set is how duplicate positions get created.
 */
export class ReorderCategoriesDto {
  @ApiPropertyOptional({
    description:
      'The parent whose children are being ordered. Omit or send `null` for the ' +
      'top-level set.',
    format: 'uuid',
    nullable: true,
  })
  @ValidateIf((_object, value) => value !== null)
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiProperty({
    description: 'Every sibling id, in the intended display order (A-6).',
    type: [String],
    format: 'uuid',
    maxItems: MAX_REORDER_BATCH,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_REORDER_BATCH)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  categoryIds: string[];
}
