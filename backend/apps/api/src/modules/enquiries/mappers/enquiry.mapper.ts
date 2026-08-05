import { ENQUIRY_STALE_AFTER_HOURS, MILLISECONDS_PER_HOUR } from '../constants/enquiry.constants';
import {
  AdminEnquiryItemDto,
  AdminEnquiryResponseDto,
  AdminEnquirySummaryDto,
  ConsumerEnquiryResponseDto,
  EnquiryItemResponseDto,
  EnquiryNoteResponseDto,
} from '../dto/enquiry-response.dto';

import type { EnquiryItem } from '../entities/enquiry-item.entity';
import type { EnquiryNote } from '../entities/enquiry-note.entity';
import type { Enquiry } from '../entities/enquiry.entity';

/** Issues a signed, expiring URL for a storage key (§3.4). */
export type SignEnquiryUrl = (storageKey: string) => string;

/** The render keys one item is entitled to, from the §4.24 join. */
export interface EnquiryRenderKeys {
  readonly storageKey: string | null;
  readonly thumbnailKey: string | null;
}

/**
 * A-25: "Enquiries untouched after 24 hours are highlighted."
 *
 * Derived on the way out rather than stored. A stored flag needs a cron to stay true
 * and is wrong for the whole gap between two runs; this is right at the instant it is
 * read, which is the only instant anybody looks at it.
 *
 * "Untouched" is `firstRespondedAt IS NULL` — an admin who has replied has touched it,
 * whatever the status says.
 */
export function isStaleEnquiry(enquiry: Enquiry, now: Date): boolean {
  if (enquiry.firstRespondedAt !== null) {
    return false;
  }
  const ageMs = now.getTime() - enquiry.createdAt.getTime();
  return ageMs > ENQUIRY_STALE_AFTER_HOURS * MILLISECONDS_PER_HOUR;
}

/**
 * `enquiry_items` row → the consumer's view of a piece she sent (C-36).
 *
 * Read entirely from the snapshot columns (§4.24). The thumbnail is signed to **her**
 * id, because it is her render.
 */
export function toEnquiryItemResponse(
  item: EnquiryItem,
  keys: EnquiryRenderKeys | undefined,
  sign: SignEnquiryUrl,
): EnquiryItemResponseDto {
  const dto = new EnquiryItemResponseDto();

  dto.garmentId = item.garmentId;
  dto.title = item.garmentTitleSnapshot;
  dto.sku = item.garmentSkuSnapshot;
  dto.price = item.garmentPriceSnapshot;
  dto.rank = item.rank;
  dto.note = item.note;
  dto.renderThumbnailUrl =
    keys?.thumbnailKey === undefined || keys.thumbnailKey === null ? null : sign(keys.thumbnailKey);

  return dto;
}

/**
 * The same row as an admin sees it (A-21) — with the full render.
 *
 * The URL is signed to the **requesting admin's** id, not to the consumer's. §3.4
 * step 4 lets a token through when `sub` matches the session presenting it, so this
 * works in that admin's session and in no other — and it is issued at all only because
 * an `enquiry_items` row exists, which is the whole of S-10's exception.
 */
export function toAdminEnquiryItem(
  item: EnquiryItem,
  keys: EnquiryRenderKeys | undefined,
  sign: SignEnquiryUrl,
): AdminEnquiryItemDto {
  const dto = new AdminEnquiryItemDto();

  dto.garmentId = item.garmentId;
  dto.title = item.garmentTitleSnapshot;
  dto.sku = item.garmentSkuSnapshot;
  dto.price = item.garmentPriceSnapshot;
  dto.rank = item.rank;
  dto.note = item.note;
  dto.renderThumbnailUrl =
    keys?.thumbnailKey === undefined || keys.thumbnailKey === null ? null : sign(keys.thumbnailKey);
  dto.renderUrl =
    keys?.storageKey === undefined || keys.storageKey === null ? null : sign(keys.storageKey);

  return dto;
}

/**
 * `enquiries` row → her own history entry (C-36).
 *
 * There is no field on this DTO for an internal note or for `lostReason`, so neither
 * can reach her however this function is later edited (A-24, §4.25).
 */
export function toConsumerEnquiry(
  enquiry: Enquiry,
  items: readonly EnquiryItemResponseDto[],
): ConsumerEnquiryResponseDto {
  const dto = new ConsumerEnquiryResponseDto();

  dto.id = enquiry.id;
  dto.reference = enquiry.reference;
  dto.status = enquiry.status;
  dto.message = enquiry.message;
  dto.eventDate = enquiry.eventDate;
  dto.eventType = enquiry.eventType;
  dto.budgetBand = enquiry.budgetBand;
  dto.totalValue = enquiry.totalValueSnapshot;
  dto.itemCount = items.length;
  dto.items = [...items];
  dto.createdAt = enquiry.createdAt;
  dto.closedAt = enquiry.closedAt;

  return dto;
}

/** One row of the A-25 inbox. */
export function toAdminEnquirySummary(
  enquiry: Enquiry,
  itemCount: number,
  now: Date,
): AdminEnquirySummaryDto {
  const dto = new AdminEnquirySummaryDto();

  dto.id = enquiry.id;
  dto.reference = enquiry.reference;
  dto.status = enquiry.status;
  dto.contactName = enquiry.contactName;
  dto.eventType = enquiry.eventType;
  dto.eventDate = enquiry.eventDate;
  dto.budgetBand = enquiry.budgetBand;
  dto.itemCount = itemCount;
  dto.totalValue = enquiry.totalValueSnapshot;
  dto.assignedTo = enquiry.assignedTo;
  dto.isStale = isStaleEnquiry(enquiry, now);
  dto.firstRespondedAt = enquiry.firstRespondedAt;
  dto.createdAt = enquiry.createdAt;

  return dto;
}

/** The full enquiry an admin works from (A-21). */
export function toAdminEnquiry(
  enquiry: Enquiry,
  items: readonly AdminEnquiryItemDto[],
  now: Date,
): AdminEnquiryResponseDto {
  const summary = toAdminEnquirySummary(enquiry, items.length, now);
  const dto = new AdminEnquiryResponseDto();

  Object.assign(dto, summary);
  dto.userId = enquiry.userId;
  dto.contactEmail = enquiry.contactEmail;
  dto.contactPhone = enquiry.contactPhone;
  dto.message = enquiry.message;
  dto.lostReason = enquiry.lostReason;
  dto.closedAt = enquiry.closedAt;
  dto.items = [...items];

  return dto;
}

/** An internal note (A-24). Admin routes only — there is no consumer shape for this. */
export function toEnquiryNote(
  note: EnquiryNote,
  authorName: string | null,
): EnquiryNoteResponseDto {
  const dto = new EnquiryNoteResponseDto();

  dto.id = note.id;
  dto.body = note.body;
  dto.authorId = note.authorId;
  dto.authorName = authorName;
  dto.createdAt = note.createdAt;

  return dto;
}
