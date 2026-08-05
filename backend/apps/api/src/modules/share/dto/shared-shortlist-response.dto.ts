import { ApiProperty } from '@nestjs/swagger';

import { Reaction } from '../enums/reaction.enum';

/**
 * One piece as a recipient sees it — `GET /share/:token` (C-33, §4.21).
 *
 * §4.21 fixes the shape: "only `{ garment title, category, price if public, render
 * url }` per item". Everything else on this DTO is machinery the page needs — the item
 * and garment ids so a reaction can name what it is about, and the rank so the order
 * she chose survives the trip.
 *
 * **What is deliberately absent**, and stays absent: her name, her email, her phone
 * number, her per-item notes, her photo, any render that is not on this shortlist, and
 * the owner's id in any form. The query in `queries/public-share.scope.ts` cannot
 * produce them, so this DTO cannot carry them.
 */
export class SharedGarmentDto {
  @ApiProperty({ format: 'uuid' })
  itemId: string;

  @ApiProperty({ format: 'uuid' })
  garmentId: string;

  @ApiProperty({ example: 'Zarrin Bridal Lehenga' })
  title: string;

  @ApiProperty({ example: 'zarrin-bridal-lehenga' })
  slug: string;

  @ApiProperty({ nullable: true, example: 'Bridal Lehenga' })
  category: string | null;

  @ApiProperty({
    nullable: true,
    example: 185_000,
    description: 'Omitted entirely while `catalog.showPricesPublicly` is off (A-30).',
  })
  price: number | null;

  @ApiProperty({ nullable: true, example: 'PKR' })
  currency: string | null;

  @ApiProperty({ nullable: true, description: 'Her drag-to-rank position, 1 first.' })
  rank: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Signed, expiring URL for the render thumbnail (§3.4). Never the full render: a ' +
      '`renders/**` URL is scoped to its owner’s session, which a recipient does not have.',
  })
  renderUrl: string | null;

  @ApiProperty({
    enum: Reaction,
    nullable: true,
    description: 'The reaction this visitor already left on this piece, if any.',
  })
  myReaction: Reaction | null;

  @ApiProperty({
    nullable: true,
    description:
      'The comment this visitor already left. Never another visitor’s — recipients ' +
      'cannot see each other’s notes.',
  })
  myComment: string | null;
}

/** `GET /share/:token` — the recipient view (C-33, §5.14). */
export class SharedShortlistResponseDto {
  @ApiProperty({ type: [SharedGarmentDto] })
  items: SharedGarmentDto[];

  @ApiProperty({ example: 4 })
  itemCount: number;

  @ApiProperty({
    description:
      'When the link stops working (C-34). Shown so a recipient knows the page is not ' +
      'permanent, and because the owner may revoke it sooner.',
  })
  expiresAt: Date;
}
