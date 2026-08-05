import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One row of the try-on history — §5.12, C-24 … C-30.
 *
 * **Everything descriptive comes from the snapshot columns** (§4.18). The list does not
 * join `garments`, so a render survives the garment being unpublished, archived or
 * hard-deleted (C-29) and a photo being deleted (C-28). `garmentAvailable` is the one
 * field that *does* need the join, and it exists solely so the UI can hide the
 * "Try it on" action and show the "no longer available" label.
 *
 * `storageKey` is not on this DTO and never will be. The client gets a signed,
 * expiring, `sub`-scoped URL (§3.4) — the key itself never crosses the wire (E-12).
 */
export class ResultResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Null once the garment is gone.' })
  garmentId: string | null;

  @ApiProperty({ example: 'Ivory Chikankari Kurta' })
  garmentTitle: string;

  @ApiProperty({ example: 'Bridal Lehenga' })
  garmentCategory: string;

  @ApiProperty({ nullable: true, example: 185000 })
  garmentPrice: number | null;

  @ApiProperty({ example: 'PKR' })
  garmentCurrency: string;

  @ApiProperty({
    description: 'False when the garment is missing, archived or unpublished (C-29).',
  })
  garmentAvailable: boolean;

  @ApiProperty({ nullable: true, example: 'daylight', description: 'C-30 grouping label.' })
  personPhotoLabel: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  personPhotoId: string | null;

  @ApiProperty({ description: 'Signed, expiring URL for the full render (§3.4).' })
  url: string;

  @ApiProperty({ nullable: true, description: 'Signed URL for the 320px thumbnail.' })
  thumbnailUrl: string | null;

  @ApiProperty({ example: 768 })
  width: number;

  @ApiProperty({ example: 1152 })
  height: number;

  @ApiProperty({ example: 284_442 })
  byteSize: number;

  @ApiProperty({ description: '§9.3 per-render explicit opt-in.', nullable: true })
  marketingOptInAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

/** C-30 — history grouped by the photo it was generated from. */
export class ResultGroupDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Null once the photo has been deleted; the label snapshot still names it (C-28).',
  })
  personPhotoId: string | null;

  @ApiPropertyOptional({ example: 'daylight' })
  personPhotoLabel: string | null;

  @ApiProperty({ example: 12 })
  count: number;

  @ApiProperty({ type: [ResultResponseDto] })
  items: ResultResponseDto[];
}
