import { GarmentQualityCheckDto, GarmentResponseDto } from '../dto/garment-response.dto';

import type { Garment, QualityCheckResult } from '../entities/garment.entity';

/**
 * `garments` rows → the **admin** response DTO (§2.9: "controllers NEVER return raw
 * entities").
 *
 * There is deliberately no public mapper in this file. The public projection lives in
 * `modules/catalog`, reads a different DTO and is reached through a query that can
 * only return published, test-render-approved rows — so no amount of editing here can
 * put a draft garment or a quality score in front of a consumer.
 */

/**
 * **A-14 "highest star rate."**
 *
 * The love share of the verdicts actually cast, not of the try-ons run: a piece tried
 * forty times and judged twice has a star rate based on the two judgements, because
 * the other thirty-eight say nothing about how it was received. `null` before the
 * first verdict, so the list can put "no rating yet" last rather than treat it as 0.
 *
 * The SQL side of this lives in `GarmentsService.applyOrdering()` and must agree with
 * this function; a unit test pins both to the same numerator and denominator.
 */
export function starRateOf(garment: Garment): number | null {
  const verdicts = garment.loveCount + garment.maybeCount + garment.rejectCount;
  return verdicts === 0 ? null : garment.loveCount / verdicts;
}

function toQualityCheck(check: QualityCheckResult): GarmentQualityCheckDto {
  const dto = new GarmentQualityCheckDto();
  dto.check = check.check;
  dto.passed = check.passed;
  dto.score = check.score;
  dto.remediation = check.remediation;
  return dto;
}

/**
 * `GET /admin/garments`, `GET /admin/garments/:garmentId`, and every admin mutation
 * response (§5.6).
 *
 * @param categoryName resolved by the caller's join. Passed in rather than read off
 * `garment.category`, because the list query selects two category columns instead of
 * hydrating the relation and a mapper that reached for `garment.category.name` would
 * throw on exactly the query that matters most.
 * @param publishable whether the A-11 and A-10 gates would currently pass. Computed
 * by the service — it needs the try-on source count and the configured threshold,
 * neither of which is on the row.
 */
export function toGarmentResponse(
  garment: Garment,
  categoryName: string | null,
  publishable: boolean,
): GarmentResponseDto {
  const dto = new GarmentResponseDto();
  dto.id = garment.id;
  dto.sku = garment.sku;
  dto.title = garment.title;
  dto.titleUr = garment.titleUr;
  dto.slug = garment.slug;
  dto.categoryId = garment.categoryId;
  dto.categoryName = categoryName;
  dto.colors = garment.colors;
  dto.fabric = garment.fabric;
  dto.embellishmentWeight = garment.embellishmentWeight;
  dto.price = garment.price;
  dto.currency = garment.currency;
  dto.mode = garment.mode;
  dto.deposit = garment.deposit;
  dto.description = garment.description;
  dto.descriptionUr = garment.descriptionUr;
  dto.sizes = garment.sizes;
  dto.styleTags = garment.styleTags;

  dto.publishState = garment.publishState;
  dto.publishedAt = garment.publishedAt;

  dto.qualityScore = garment.qualityScore;
  dto.qualityChecks = (garment.qualityChecks ?? []).map(toQualityCheck);
  dto.qualityOverridden =
    garment.qualityOverriddenBy !== null && garment.qualityOverriddenAt !== null;
  dto.qualityOverriddenBy = garment.qualityOverriddenBy;
  dto.qualityOverriddenAt = garment.qualityOverriddenAt;

  dto.testRenderId = garment.testRenderId;
  dto.testRenderState = garment.testRenderState;
  dto.testRenderApprovedAt = garment.testRenderApprovedAt;
  dto.approvedBy = garment.approvedBy;
  dto.flaggedForReview = garment.flaggedForReview;
  dto.publishable = publishable;

  dto.tryOnCount = garment.tryOnCount;
  dto.loveCount = garment.loveCount;
  dto.maybeCount = garment.maybeCount;
  dto.rejectCount = garment.rejectCount;
  dto.enquiryCount = garment.enquiryCount;
  dto.failureCount = garment.failureCount;
  dto.starRate = starRateOf(garment);
  dto.lastTriedAt = garment.lastTriedAt;

  dto.createdAt = garment.createdAt;
  dto.updatedAt = garment.updatedAt;
  return dto;
}
