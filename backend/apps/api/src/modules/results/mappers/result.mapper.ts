import { ResultResponseDto } from '../dto/result-response.dto';

import type { TryOnResult } from '../entities/tryon-result.entity';

/** Issues a `sub`-scoped signed URL for a storage key (§3.4). */
export type SignRenderUrl = (storageKey: string) => string;

/**
 * `tryon_results` row → §5.12 response.
 *
 * Reads **only** the snapshot columns for anything descriptive (§4.18, C-29). The one
 * fact that cannot come from a snapshot is whether the garment is still available to
 * try on, so it is passed in by the caller, which is the only code that knows.
 *
 * The storage keys become signed, expiring, `sub`-scoped URLs here and are never
 * serialised as keys (E-12, §3.4).
 */
export function toResultResponse(
  result: TryOnResult,
  sign: SignRenderUrl,
  garmentAvailable: boolean,
): ResultResponseDto {
  const dto = new ResultResponseDto();

  dto.id = result.id;
  dto.garmentId = result.garmentId;
  dto.garmentTitle = result.garmentTitleSnapshot;
  dto.garmentCategory = result.garmentCategorySnapshot;
  dto.garmentPrice = result.garmentPriceSnapshot;
  dto.garmentCurrency = result.garmentCurrencySnapshot;
  dto.garmentAvailable = garmentAvailable;
  dto.personPhotoId = result.personPhotoId;
  dto.personPhotoLabel = result.personPhotoLabelSnapshot;
  dto.url = sign(result.storageKey);
  dto.thumbnailUrl = result.thumbnailKey === null ? null : sign(result.thumbnailKey);
  dto.width = result.width;
  dto.height = result.height;
  dto.byteSize = result.byteSize;
  dto.marketingOptInAt = result.marketingOptInAt;
  dto.createdAt = result.createdAt;

  return dto;
}
