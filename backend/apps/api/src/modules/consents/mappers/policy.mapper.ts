import { Locale } from '@api/modules/users/enums/locale.enum';

import { PolicyResponseDto, PolicyVersionResponseDto } from '../dto/policy-response.dto';

import type { PolicyVersion } from '../entities/policy-version.entity';

/**
 * `policy_versions` row → the locale-narrowed view the C-11 gate renders.
 *
 * Urdu falls back to English only when the Urdu column is empty, which
 * `CreatePolicyVersionDto` forbids — the fallback exists so a bad row degrades to
 * readable text rather than to a blank consent screen.
 */
export function toPolicyResponse(policy: PolicyVersion, locale: Locale): PolicyResponseDto {
  const wantsUrdu = locale === Locale.UR && policy.bodyUr !== '';
  const dto = new PolicyResponseDto();
  dto.version = policy.version;
  dto.effectiveFrom = policy.effectiveFrom;
  dto.locale = wantsUrdu ? Locale.UR : Locale.EN;
  dto.body = wantsUrdu ? policy.bodyUr : policy.bodyEn;
  dto.summary = wantsUrdu ? policy.summaryUr : policy.summaryEn;
  dto.retentionSummary = {
    photoDays: policy.retentionSummary.photoDays,
    rendersLifetime: policy.retentionSummary.rendersLifetime,
  };
  return dto;
}

/** `policy_versions` row → the full admin view (§5.4 `GET /settings/policy`). */
export function toPolicyVersionResponse(policy: PolicyVersion): PolicyVersionResponseDto {
  const dto = new PolicyVersionResponseDto();
  dto.id = policy.id;
  dto.version = policy.version;
  dto.effectiveFrom = policy.effectiveFrom;
  dto.isCurrent = policy.isCurrent;
  dto.bodyEn = policy.bodyEn;
  dto.bodyUr = policy.bodyUr;
  dto.summaryEn = policy.summaryEn;
  dto.summaryUr = policy.summaryUr;
  dto.retentionSummary = {
    photoDays: policy.retentionSummary.photoDays,
    rendersLifetime: policy.retentionSummary.rendersLifetime,
  };
  dto.createdAt = policy.createdAt;
  return dto;
}
