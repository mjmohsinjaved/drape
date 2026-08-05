import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ImageQualityReportDto } from './image-quality-response.dto';

/**
 * One `garment_images` row, as the admin console sees it (§4.14, §5.7).
 *
 * There is no `storageKey`, no `thumbnailKey` and no `hash` on this DTO, and there never will
 * be. §3.4: "a storage key must never cross the network boundary" — what crosses is `url` and
 * `thumbnailUrl`, already signed and already expiring. The hash is the §3.7 cache input and
 * tells a client nothing it can act on.
 */
export class GarmentImageResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  garmentId: string;

  @ApiProperty({ description: 'Signed, expiring URL for the full-size image (§3.4).' })
  url: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Signed 320w thumbnail URL.' })
  thumbnailUrl: string | null;

  @ApiProperty({
    description: 'The file sent upstream as `garment_image` (A-9). Exactly one per garment.',
  })
  isTryOnSource: boolean;

  @ApiProperty()
  width: number;

  @ApiProperty()
  height: number;

  @ApiProperty()
  byteSize: number;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType: string;

  @ApiProperty({ description: 'Gallery order, ascending.' })
  position: number;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Alt text (D-20).' })
  altText: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}

/**
 * What the try-on source endpoints return: the image, plus the A-10 verdict the garment now
 * carries because of it.
 *
 * The two travel together deliberately. An admin who has just designated a try-on source needs
 * to know in the same breath whether the piece can now be published or whether it is marked
 * "Needs a better photo" — a second round trip to find that out is a second chance to miss it.
 */
export class GarmentImageWithQualityResponseDto {
  @ApiProperty({ type: GarmentImageResponseDto })
  image: GarmentImageResponseDto;

  @ApiProperty({ type: ImageQualityReportDto })
  quality: ImageQualityReportDto;
}
