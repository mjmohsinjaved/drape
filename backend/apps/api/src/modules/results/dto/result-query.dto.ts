import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '@library/common';

import { Verdict } from '@api/modules/shortlist/enums/verdict.enum';

/** The columns history may be sorted by. Narrowed per §2.8 — never interpolated. */
export const RESULT_SORT_KEYS = ['createdAt'] as const;

export type ResultSortKey = (typeof RESULT_SORT_KEYS)[number];

/**
 * The extra value the verdict filter can express: **a render she has not decided on yet**.
 *
 * `ResultResponseDto.verdict` is `Verdict | null`, and a filter that could not address the
 * `null` would be a filter unable to select a value the same endpoint returns. It is a
 * query-parameter value, not a fourth verdict: nothing is ever stored as `NONE`, and
 * `shortlist_items` still holds exactly the three of §4.1.
 */
export const NO_VERDICT = 'NONE' as const;

export const RESULT_VERDICT_FILTERS = [
  Verdict.LOVE_IT,
  Verdict.MAYBE,
  Verdict.NOT_FOR_ME,
  NO_VERDICT,
] as const;

export type ResultVerdictFilter = (typeof RESULT_VERDICT_FILTERS)[number];

/**
 * `GET /results` — §5.12, C-25.
 *
 * C-25 asks for history "filterable by verdict and category, searchable by garment name",
 * and §5.12 lists all four parameters. They are answered here rather than in the client,
 * because a filter applied to the page the client happens to hold narrows one page and
 * calls it the archive.
 *
 * Two of the four are pure snapshot reads (`personPhotoId`, `search`). The other two each
 * need one narrow lookup, and neither weakens §4.18 — the rows are still *rendered*
 * exclusively from the snapshot columns:
 *
 * - **`verdict`** resolves through `shortlist_items`, which owns the verdict (§4.20). The
 *   lookup answers "which of her pieces carry this verdict"; the history rows themselves
 *   are still selected from, and rendered from, `tryon_results`.
 * - **`categoryId`** resolves through `garments` — the same join `garmentAvailable`
 *   already makes. A render whose garment has been hard-deleted carries no live category
 *   and so falls outside every category filter, which is the honest answer: there is no
 *   longer a garment to attribute to a category. It keeps its place in her unfiltered
 *   history (C-29), where it belongs.
 */
export class ResultQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only renders from this photo (C-30).' })
  @IsOptional()
  @IsUUID()
  personPhotoId?: string;

  @ApiPropertyOptional({ description: 'Substring match on the garment title snapshot.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({
    enum: RESULT_VERDICT_FILTERS,
    description:
      'Only renders of pieces carrying this verdict (C-25). `NONE` selects the renders she ' +
      'has not decided on yet.',
  })
  @IsOptional()
  @IsIn(RESULT_VERDICT_FILTERS)
  verdict?: ResultVerdictFilter;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only renders of pieces currently filed under this category (C-25).',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ enum: RESULT_SORT_KEYS, default: 'createdAt', required: false })
  @IsOptional()
  @IsIn(RESULT_SORT_KEYS)
  override sortBy: ResultSortKey = 'createdAt';
}
