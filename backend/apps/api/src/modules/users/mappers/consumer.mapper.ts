import type { EnquiryStatus } from '@api/modules/enquiries/enums/enquiry-status.enum';
import type { Verdict } from '@api/modules/shortlist/enums/verdict.enum';

import { ConsumerProfileResponseDto } from '../dto/consumer-profile.dto';
import { ConsumerRenderResponseDto } from '../dto/consumer-render-response.dto';
import {
  ConsumerDetailResponseDto,
  ConsumerEnquirySummaryDto,
  ConsumerListItemResponseDto,
  ConsumerProfileSummaryDto,
} from '../dto/consumer-response.dto';
import { ConsumerShortlistItemResponseDto } from '../dto/consumer-shortlist-response.dto';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationPreferencesResponseDto,
} from '../dto/notification-preferences.dto';

import type { ConsumerProfile, NotificationPreferences } from '../entities/consumer-profile.entity';
import type {
  AdminRenderRow,
  AdminShortlistRow,
  ConsumerDetailRow,
  ConsumerEnquiryRow,
  ConsumerListRow,
} from '../interfaces/consumer-rows.interface';

/**
 * Consumer rows → response DTOs (§2.9: "controllers NEVER return raw entities").
 *
 * Two rules hold across every function here:
 *
 * - **No photo field exists to fill.** S-10 is enforced upstream in
 *   `ConsumerQueryService`, which has no handle on `person_photos`; these mappers
 *   have nothing to leave out because nothing was ever read.
 * - **No storage key is copied.** `AdminRenderRow` carries one so that a signed,
 *   expiring URL can be minted from it; §3.4 forbids the key itself from crossing
 *   the network boundary, so it stops here.
 */

/** Mints a signed download URL for a storage key, scoped to the requesting admin (§3.4). */
export type SignUrl = (storageKey: string) => string;

/** One row of the A-16 list. */
export function toConsumerListItem(row: ConsumerListRow): ConsumerListItemResponseDto {
  const dto = new ConsumerListItemResponseDto();
  dto.id = row.user.id;
  dto.name = row.user.name;
  dto.email = row.user.email;
  dto.phone = row.user.phone;
  dto.signedUpAt = row.user.createdAt;
  dto.lastActiveAt = row.user.lastActiveAt;
  dto.generationsThisMonth = row.aggregates.generationsThisMonth;
  dto.shortlistSize = row.aggregates.shortlistSize;
  dto.enquiryCount = row.aggregates.enquiryCount;
  dto.status = row.user.status;
  return dto;
}

/** `GET /admin/consumers/:userId` (A-17). Carries no photo and no render. */
export function toConsumerDetail(row: ConsumerDetailRow): ConsumerDetailResponseDto {
  const dto = new ConsumerDetailResponseDto();
  dto.id = row.user.id;
  dto.name = row.user.name;
  dto.email = row.user.email;
  dto.phone = row.user.phone;
  dto.status = row.user.status;
  dto.suspendedReason = row.user.suspendedReason;
  dto.suspendedAt = row.user.suspendedAt;
  dto.emailVerified = row.user.emailVerifiedAt !== null;
  dto.phoneVerified = row.user.phoneVerifiedAt !== null;
  dto.locale = row.user.locale;
  dto.signedUpAt = row.user.createdAt;
  dto.lastActiveAt = row.user.lastActiveAt;
  dto.lastLoginAt = row.user.lastLoginAt;
  dto.deletionRequestedAt = row.user.deletionRequestedAt;
  dto.profile = toConsumerProfileSummary(row.profile);
  dto.generationsThisMonth = row.aggregates.generationsThisMonth;
  dto.shortlistSize = row.aggregates.shortlistSize;
  dto.enquiryCount = row.aggregates.enquiryCount;
  dto.enquiries = row.enquiries.map(toConsumerEnquirySummary);
  return dto;
}

/** A missing profile row is normal: the C-2 fields are optional and prompted later. */
export function toConsumerProfileSummary(
  profile: ConsumerProfile | null,
): ConsumerProfileSummaryDto {
  const dto = new ConsumerProfileSummaryDto();
  dto.eventDate = toDateOnly(profile?.eventDate ?? null);
  dto.eventType = profile?.eventType ?? null;
  dto.budgetBand = profile?.budgetBand ?? null;
  dto.preferredCategories = profile?.preferredCategories ?? [];
  dto.monthlyQuotaOverride = profile?.monthlyQuotaOverride ?? null;
  dto.onboardingCompletedAt = profile?.onboardingCompletedAt ?? null;
  return dto;
}

export function toConsumerEnquirySummary(row: ConsumerEnquiryRow): ConsumerEnquirySummaryDto {
  const dto = new ConsumerEnquirySummaryDto();
  dto.id = row.id;
  dto.reference = row.reference;
  dto.status = row.status as EnquiryStatus;
  dto.createdAt = row.createdAt;
  dto.firstRespondedAt = row.firstRespondedAt;
  dto.closedAt = row.closedAt;
  dto.totalValueSnapshot = row.totalValueSnapshot;
  return dto;
}

/**
 * One enquiry-linked render (S-10).
 *
 * `signUrl` is injected rather than imported so this stays a pure function: the
 * service decides whose session the URL is scoped to, and a test can assert the
 * mapper never emits anything but the finished URL.
 */
export function toConsumerRender(row: AdminRenderRow, signUrl: SignUrl): ConsumerRenderResponseDto {
  const dto = new ConsumerRenderResponseDto();
  dto.id = row.id;
  dto.createdAt = row.createdAt;
  dto.url = signUrl(row.storageKey);
  dto.thumbnailUrl = row.thumbnailKey === null ? null : signUrl(row.thumbnailKey);
  dto.garmentTitle = row.garmentTitleSnapshot;
  dto.garmentCategory = row.garmentCategorySnapshot;
  dto.garmentPrice = row.garmentPriceSnapshot;
  dto.garmentCurrency = row.garmentCurrencySnapshot;
  dto.width = row.width;
  dto.height = row.height;
  dto.enquiryId = row.enquiryId;
  dto.enquiryReference = row.enquiryReference;
  return dto;
}

export function toConsumerShortlistItem(row: AdminShortlistRow): ConsumerShortlistItemResponseDto {
  const dto = new ConsumerShortlistItemResponseDto();
  dto.id = row.id;
  dto.garmentId = row.garmentId;
  dto.garmentTitle = row.garmentTitle;
  dto.garmentSku = row.garmentSku;
  dto.garmentPrice = row.garmentPrice;
  dto.garmentCurrency = row.garmentCurrency;
  dto.verdict = row.verdict as Verdict;
  dto.rank = row.rank;
  dto.note = row.note;
  dto.verdictAt = row.verdictAt;
  return dto;
}

/** `GET /me/profile` (C-2). `monthlyQuotaOverride` is reported, never writable here. */
export function toConsumerProfileResponse(
  profile: ConsumerProfile | null,
): ConsumerProfileResponseDto {
  const dto = new ConsumerProfileResponseDto();
  dto.eventDate = toDateOnly(profile?.eventDate ?? null);
  dto.eventType = profile?.eventType ?? null;
  dto.budgetBand = profile?.budgetBand ?? null;
  dto.preferredCategories = profile?.preferredCategories ?? [];
  dto.monthlyQuotaOverride = profile?.monthlyQuotaOverride ?? null;
  dto.onboardingCompletedAt = profile?.onboardingCompletedAt ?? null;
  return dto;
}

/**
 * `GET /me/notification-preferences` (C-7).
 *
 * The column defaults to `'{}'`, so a stored value is merged **over** the defaults
 * rather than replacing them. A profile written before a toggle existed therefore
 * reports that toggle's default instead of `undefined`.
 */
export function toNotificationPreferences(
  profile: ConsumerProfile | null,
): NotificationPreferencesResponseDto {
  const stored: Partial<NotificationPreferences> = profile?.notificationPreferences ?? {};
  const merged = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...stored };

  const dto = new NotificationPreferencesResponseDto();
  dto.emailOnResultReady = merged.emailOnResultReady;
  dto.emailOnEnquiryUpdate = merged.emailOnEnquiryUpdate;
  dto.emailOnNewArrivals = merged.emailOnNewArrivals;
  dto.smsOnEnquiryUpdate = merged.smsOnEnquiryUpdate;
  return dto;
}

/**
 * `consumer_profiles.eventDate` is a true `date` column. pg hands back `YYYY-MM-DD`
 * as a string; a `Date` arrives when the row was built in memory. Both collapse to
 * the calendar date, because turning it into an instant would move her wedding by a
 * timezone.
 */
function toDateOnly(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}
