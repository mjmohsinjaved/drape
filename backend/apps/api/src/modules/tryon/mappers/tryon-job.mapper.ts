import { isErrorCode } from '@library/common';

import { toResultResponse, type SignRenderUrl } from '@api/modules/results';
import type { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';

import { TryOnJobResponseDto } from '../dto/tryon-job-response.dto';
import { consumerMessageFor } from '../services/tryon-failure.policy';

import type { TryOnJob } from '../entities/tryon-job.entity';

/**
 * `tryon_jobs` row → §5.11 response.
 *
 * The `message` is derived from `errorCode` through `ERROR_CODE_SPECS`, never stored on
 * the row and never taken from the upstream. §2.4 marks the §8.3 strings as fixed copy;
 * this is the single place the try-on module turns a stored code back into one.
 *
 * `garmentAvailable` is hard-coded `true` for the embedded result: a job's result is
 * being looked at because the generation just happened, so the garment was published a
 * moment ago. The history list (§5.12) is where C-29's "no longer available" label
 * belongs, and it computes it properly.
 */
export function toTryOnJobResponse(
  job: TryOnJob,
  result: TryOnResult | null,
  sign: SignRenderUrl,
): TryOnJobResponseDto {
  const dto = new TryOnJobResponseDto();

  dto.jobId = job.id;
  dto.status = job.status;
  dto.origin = job.origin;
  dto.cacheHit = job.cacheHit;
  dto.garmentId = job.garmentId;
  dto.attempts = job.attempts;
  dto.durationMs = job.durationMs;
  dto.errorCode = job.errorCode;
  dto.message =
    job.errorCode !== null && isErrorCode(job.errorCode) ? consumerMessageFor(job.errorCode) : null;
  dto.result = result === null ? null : toResultResponse(result, sign, true);
  dto.createdAt = job.createdAt;

  return dto;
}
