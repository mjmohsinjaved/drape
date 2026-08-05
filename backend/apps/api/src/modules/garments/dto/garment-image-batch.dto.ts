import { ApiProperty } from '@nestjs/swagger';

import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

import { GarmentImageResponseDto } from './garment-image-response.dto';

/**
 * One request resolves at most this many garments.
 *
 * §2.8 caps a list page at 100, and this endpoint exists to serve one such page of the
 * catalog table (§6.2's 40 px row thumbnail). Matching the two means the table can ask
 * for exactly the rows it is showing and never has to split the request; anything
 * larger is not a page and is **refused**, not clamped — a silently truncated response
 * would leave the caller unable to tell which rows it did not get an answer for.
 */
export const MAX_BATCH_GARMENT_IMAGES = 100;

/**
 * `POST /admin/garment-images/batch` — §5.7, §6.2.
 *
 * A POST for a read, deliberately: up to a hundred uuids is 3.6 kB of ids, which is
 * past what several proxies will carry on a query string and past what any of them
 * will log usefully.
 */
export class GarmentImageBatchDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    maxItems: MAX_BATCH_GARMENT_IMAGES,
    description: 'The garments whose primary image is wanted. Bounded and deduplicated.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BATCH_GARMENT_IMAGES)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  garmentIds: string[];
}

/**
 * One entry of the batch response.
 *
 * A garment with no image yet is present with `image: null` rather than absent. The
 * caller is drawing a table and needs one entry per row it asked about; an omission
 * would make it guess whether the piece has no image or whether the request lost it.
 */
export class GarmentImageBatchEntryDto {
  @ApiProperty({ format: 'uuid' })
  garmentId: string;

  @ApiProperty({
    type: GarmentImageResponseDto,
    nullable: true,
    description:
      'The try-on source if the garment has one, otherwise the first image in gallery ' +
      'order. `null` when the garment has no images at all.',
  })
  image: GarmentImageResponseDto | null;
}

/** `POST /admin/garment-images/batch` — one entry per requested id, in the order asked. */
export class GarmentImageBatchResponseDto {
  @ApiProperty({ type: [GarmentImageBatchEntryDto] })
  items: GarmentImageBatchEntryDto[];
}
