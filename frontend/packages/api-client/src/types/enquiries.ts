/**
 * ARCHITECTURE.md §5.15 `enquiries`, §4.23–§4.25.
 *
 * An enquiry is a **snapshot**: `enquiry_items` freezes her shortlist in her rank order with the
 * renders and per-item notes, because the shortlist keeps changing (§4.24, A-21).
 *
 * Internal notes are never included on a consumer route (A-24) — enforced by two separate response
 * shapes below, not by a flag.
 */

import type {
  DateRangeQuery,
  IsoDate,
  IsoDateTime,
  SearchablePaginationQuery,
  SignedFileUrl,
  Uuid,
} from './common';
import type { BudgetBand, EnquiryStatus, EventType } from './enums';

/* ------------------------------------------------------------------- consumer */

/**
 * `POST /enquiries` (CONSUMER) — C-35. Requires a verified phone (C-3), otherwise
 * `PHONE_NOT_VERIFIED`. Blocked with `ENQUIRIES_DISABLED` when `enquiries.enabled` is false (A-30),
 * and `ENQUIRY_ALREADY_OPEN` when she already has one in flight.
 */
export interface CreateEnquiryRequest {
  message: string;
  eventDate?: IsoDate | null;
  eventType?: EventType | null;
  budgetBand?: BudgetBand | null;
  /**
   * The shortlist items to include, in her order. Omit to snapshot the whole shortlist as it
   * currently stands. `NOT_FOR_ME` items are excluded server-side either way (§4.20).
   */
  shortlistItemIds?: Uuid[];
}

/** One row of `GET /enquiries` (CONSUMER) — her history with current status (C-36). */
export interface MyEnquiryListItem {
  id: Uuid;
  /** `ENQ-2026-000137`, shown to both sides (§4.23). */
  reference: string;
  status: EnquiryStatus;
  itemCount: number;
  totalValueSnapshot: number | null;
  currency: string;
  eventDate: IsoDate | null;
  eventType: EventType | null;
  createdAt: IsoDateTime;
  firstRespondedAt: IsoDateTime | null;
  closedAt: IsoDateTime | null;
}

/** `GET /enquiries/:enquiryId` (CONSUMER). **Internal notes are never included** (A-24). */
export interface MyEnquiryDetail extends MyEnquiryListItem {
  message: string;
  budgetBand: BudgetBand | null;
  items: EnquiryItem[];
}

/** One frozen item of an enquiry (§4.24). */
export interface EnquiryItem {
  id: Uuid;
  /** Null once the garment has been hard-deleted; the snapshots still read (§4.24). */
  garmentId: Uuid | null;
  garmentTitleSnapshot: string;
  garmentSkuSnapshot: string;
  garmentPriceSnapshot: number | null;
  rank: number;
  note: string | null;
  resultId: Uuid | null;
  /** The render the admin is allowed to see (S-10). */
  renderThumbnail: SignedFileUrl | null;
  renderImage: SignedFileUrl | null;
}

export interface MyEnquiryListQuery extends SearchablePaginationQuery {
  status?: EnquiryStatus;
}

/* ---------------------------------------------------------------------- admin */

/** One row of `GET /admin/enquiries` (ADMIN) — the inbox of A-25. */
export interface AdminEnquiryListItem {
  id: Uuid;
  reference: string;
  status: EnquiryStatus;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  itemCount: number;
  totalValueSnapshot: number | null;
  currency: string;
  eventDate: IsoDate | null;
  eventType: EventType | null;
  budgetBand: BudgetBand | null;
  assignedToId: Uuid | null;
  assignedToName: string | null;
  /** A-25: true when `firstRespondedAt` is still null more than 24 h after submission. */
  isStale: boolean;
  firstRespondedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** `GET /admin/enquiries/:enquiryId` (ADMIN) — A-21. Contact details, event, budget, ranked items. */
export interface AdminEnquiryDetail extends AdminEnquiryListItem {
  userId: Uuid;
  message: string;
  lostReason: string | null;
  closedAt: IsoDateTime | null;
  items: EnquiryItem[];
}

export interface AdminEnquiryListQuery extends SearchablePaginationQuery, DateRangeQuery {
  status?: EnquiryStatus;
  assignedToId?: Uuid;
  /** A-25 stale-after-24-h filter. */
  staleOnly?: boolean;
  sortBy?: 'createdAt' | 'firstRespondedAt' | 'totalValueSnapshot' | 'status';
}

/**
 * `PATCH /admin/enquiries/:enquiryId/status` (ADMIN). Transitions are
 * `NEW → CONTACTED → IN_DISCUSSION → CLOSED_WON | CLOSED_LOST`, plus `NEW → CLOSED_LOST`; anything
 * else is `INVALID_ENQUIRY_TRANSITION`. `lostReason` is required for `CLOSED_LOST` (A-22),
 * otherwise `ENQUIRY_LOST_REASON_REQUIRED`.
 */
export interface UpdateEnquiryStatusRequest {
  status: EnquiryStatus;
  lostReason?: string;
}

/** `PATCH /admin/enquiries/:enquiryId/assign` (ADMIN). `null` unassigns. */
export interface AssignEnquiryRequest {
  assignedToId: Uuid | null;
}

/** One row of `GET /admin/enquiries/:enquiryId/notes` (ADMIN) — A-24, admin-only, append-only. */
export interface EnquiryNote {
  id: Uuid;
  body: string;
  authorId: Uuid | null;
  authorName: string | null;
  createdAt: IsoDateTime;
}

/** `POST /admin/enquiries/:enquiryId/notes` (ADMIN). */
export interface CreateEnquiryNoteRequest {
  body: string;
}

/** `GET /admin/enquiries/:enquiryId/whatsapp-link` (ADMIN) — A-23. */
export interface WhatsAppLinkResponse {
  /** A `wa.me` deep link pre-filled with her name and top pieces. */
  url: string;
  /** The pre-filled message body, so the admin can review or edit before sending. */
  message: string;
  phone: string;
}

/**
 * `GET /admin/enquiries/export` (ADMIN) — CSV export of the filtered set (A-26). The response is a
 * signed download rather than a raw stream, so it goes through the same §3.4 token path as
 * everything else.
 */
export interface EnquiryExportResponse {
  download: SignedFileUrl;
  filename: string;
  rowCount: number;
}
