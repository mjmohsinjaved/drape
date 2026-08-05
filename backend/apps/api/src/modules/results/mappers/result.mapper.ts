import type { RejectReason } from '@api/modules/shortlist/enums/reject-reason.enum';
import type { Verdict } from '@api/modules/shortlist/enums/verdict.enum';

import { ResultResponseDto } from '../dto/result-response.dto';

import type { TryOnResult } from '../entities/tryon-result.entity';

/** Issues a `sub`-scoped signed URL for a storage key (§3.4). */
export type SignRenderUrl = (storageKey: string) => string;

/**
 * Her decision on the piece this render is of, read from `shortlist_items` (§4.20).
 *
 * Passed in rather than looked up here for the same reason `garmentAvailable` is: the
 * mapper maps one row, and the caller is the only code that can read a whole page's
 * worth of verdicts in one query.
 */
export interface ResultVerdictProjection {
  verdict: Verdict;
  rejectReason: RejectReason | null;
}

/**
 * `tryon_results` row → §5.12 response.
 *
 * Reads **only** the snapshot columns for anything descriptive (§4.18, C-29). Two facts
 * cannot come from a snapshot and are therefore passed in by the caller, which is the
 * only code that knows them: whether the garment is still available to try on, and what
 * she decided about it.
 *
 * `verdict` defaults to `null` — a render that has just been generated has no verdict,
 * which is exactly what the try-on write path wants when it projects a fresh result.
 *
 * The storage keys become signed, expiring, `sub`-scoped URLs here and are never
 * serialised as keys (E-12, §3.4).
 */
export function toResultResponse(
  result: TryOnResult,
  sign: SignRenderUrl,
  garmentAvailable: boolean,
  verdict: ResultVerdictProjection | null = null,
): ResultResponseDto {
  const dto = new ResultResponseDto();

  dto.id = result.id;
  dto.garmentId = result.garmentId;
  dto.garmentTitle = result.garmentTitleSnapshot;
  dto.garmentCategory = result.garmentCategorySnapshot;
  dto.garmentPrice = result.garmentPriceSnapshot;
  dto.garmentCurrency = result.garmentCurrencySnapshot;
  dto.garmentAvailable = garmentAvailable;
  dto.verdict = verdict === null ? null : verdict.verdict;
  dto.rejectReason = verdict === null ? null : verdict.rejectReason;
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
