import {
  GarmentImageResponseDto,
  GarmentImageWithQualityResponseDto,
} from '../dto/garment-image-response.dto';
import { ImageQualityCheckDto, ImageQualityReportDto } from '../dto/image-quality-response.dto';
import { NEEDS_BETTER_PHOTO_LABEL, QUALITY_VERDICTS } from '../validators/image-quality.constants';

import type { GarmentImage } from '../entities/garment-image.entity';
import type { ImageQualityReport } from '../validators/image-quality.validator';

/**
 * `garment_images` rows → response DTOs (§2.9: "controllers NEVER return raw entities").
 *
 * This is the only place the shape is decided, and the only place a storage key is turned into
 * a URL. The signing function is passed in rather than imported so the mapper stays pure and a
 * test can assert "this response contains no storage key" without a storage container.
 */

/** Signs a storage key into a ready-to-use, expiring URL (§3.4). */
export type SignKey = (key: string) => string;

export function toGarmentImageResponse(
  image: GarmentImage,
  signKey: SignKey,
): GarmentImageResponseDto {
  const dto = new GarmentImageResponseDto();
  dto.id = image.id;
  dto.garmentId = image.garmentId;
  // The key is read here and discarded. Nothing downstream of this line has it.
  dto.url = signKey(image.storageKey);
  dto.thumbnailUrl = image.thumbnailKey === null ? null : signKey(image.thumbnailKey);
  dto.isTryOnSource = image.isTryOnSource;
  dto.width = image.width;
  dto.height = image.height;
  dto.byteSize = image.byteSize;
  dto.mimeType = image.mimeType;
  dto.position = image.position;
  dto.altText = image.altText;
  dto.createdAt = image.createdAt;
  return dto;
}

export function toImageQualityReport(report: ImageQualityReport): ImageQualityReportDto {
  const dto = new ImageQualityReportDto();
  dto.score = report.score;
  dto.minScore = report.minScore;
  dto.passed = report.passed;
  dto.verdict = report.verdict;
  dto.needsBetterPhoto = report.verdict === QUALITY_VERDICTS.NEEDS_BETTER_PHOTO;
  dto.label = NEEDS_BETTER_PHOTO_LABEL;
  dto.checks = report.checks.map((check) => {
    const checkDto = new ImageQualityCheckDto();
    checkDto.check = check.check;
    checkDto.passed = check.passed;
    checkDto.score = check.score;
    checkDto.remediation = check.remediation;
    return checkDto;
  });
  return dto;
}

export function toGarmentImageWithQuality(
  image: GarmentImage,
  report: ImageQualityReport,
  signKey: SignKey,
): GarmentImageWithQualityResponseDto {
  const dto = new GarmentImageWithQualityResponseDto();
  dto.image = toGarmentImageResponse(image, signKey);
  dto.quality = toImageQualityReport(report);
  return dto;
}
