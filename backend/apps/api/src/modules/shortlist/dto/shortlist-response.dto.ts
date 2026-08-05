import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { BudgetBand } from '@api/modules/users/enums/budget-band.enum';

import { RejectReason } from '../enums/reject-reason.enum';
import { Verdict } from '../enums/verdict.enum';

/**
 * One piece on the shortlist — §5.13, C-32.
 *
 * `storageKey` is not here and never will be: the client gets a signed, expiring,
 * `sub`-scoped URL for the render thumbnail (§3.4, E-12).
 */
export class ShortlistItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  garmentId: string;

  @ApiProperty({ example: 'Zarrin Bridal Lehenga' })
  garmentTitle: string;

  @ApiProperty({ nullable: true, example: 'Bridal Lehenga' })
  garmentCategory: string | null;

  @ApiProperty({ nullable: true, example: 185_000 })
  price: number | null;

  @ApiProperty({ example: 'PKR' })
  currency: string;

  @ApiProperty({
    description: 'False once the piece is unpublished, archived or withdrawn (C-29).',
  })
  garmentAvailable: boolean;

  @ApiProperty({ enum: Verdict })
  verdict: Verdict;

  @ApiProperty({
    enum: RejectReason,
    nullable: true,
    description: 'C-21. Only ever set beside a "Not for me".',
  })
  rejectReason: RejectReason | null;

  @ApiProperty({ nullable: true, description: 'Her drag-to-rank position, 1 first (C-32).' })
  rank: number | null;

  @ApiProperty({ nullable: true })
  note: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  latestResultId: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Signed, expiring URL for the render thumbnail (§3.4). Null if she has no render yet.',
  })
  renderThumbnailUrl: string | null;

  @ApiProperty()
  verdictAt: Date;
}

/**
 * The running total against her stated budget (C-32).
 *
 * `withinBudget` is deliberately three-valued. A consumer who never stated a band is
 * neither within her budget nor over it, and `false` would be the API inventing a
 * fact about her.
 */
export class ShortlistBudgetDto {
  @ApiProperty({
    description: 'Sum of the prices of every piece on the shortlist.',
    example: 370_000,
  })
  total: number;

  @ApiProperty({ example: 'PKR' })
  currency: string;

  @ApiProperty({
    enum: BudgetBand,
    nullable: true,
    description: 'Her stated band, from her profile.',
  })
  budgetBand: BudgetBand | null;

  @ApiProperty({
    nullable: true,
    example: 500_000,
    description: 'Ceiling of that band. Null for the open-ended top band, and when no band is set.',
  })
  budgetCeiling: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Null when she has stated no band — not false.',
  })
  withinBudget: boolean | null;

  @ApiProperty({ description: 'How many pieces the total covers.', example: 3 })
  itemCount: number;
}

/** `GET /shortlist` — Love it and Maybe, in rank order, with the running total (§5.13). */
export class ShortlistResponseDto {
  @ApiProperty({ type: [ShortlistItemResponseDto] })
  items: ShortlistItemResponseDto[];

  @ApiProperty({ type: ShortlistBudgetDto })
  budget: ShortlistBudgetDto;
}
