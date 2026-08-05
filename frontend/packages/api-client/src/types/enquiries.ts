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
  IsoDate,
  IsoDateTime,
  PaginationQuery,
  SearchablePaginationQuery,
  Uuid,
} from './common';
import type { BudgetBand, EnquiryStatus, EventType } from './enums';

/* ------------------------------------------------------------------- consumer */

/**
 * `POST /enquiries` (CONSUMER) — C-35. Requires a verified phone (C-3), otherwise
 * `PHONE_NOT_VERIFIED`. Blocked with `ENQUIRIES_DISABLED` when `enquiries.enabled` is false (A-30).
 *
 * **There is no item list here.** The enquiry snapshots her shortlist as it stands at submission
 * (A-21), in her rank order — there is no field to pick items with.
 */
export interface CreateEnquiryRequest {
  message: string;
  /** Defaults to the date on her profile when omitted. */
  eventDate?: IsoDate;
  eventType?: EventType;
  budgetBand?: BudgetBand;
}

/** One frozen item of an enquiry, as the **consumer** sees it (§4.24). */
export interface EnquiryItem {
  /** Null once the garment has been hard-deleted; the snapshot still reads (§4.24). */
  garmentId: Uuid | null;
  /** Title at the time she sent it. */
  title: string;
  sku: string;
  /** Price at the time she sent it. */
  price: number | null;
  /** Her rank order at submission (A-21). */
  rank: number;
  /** Her per-item note at submission (A-21). */
  note: string | null;
  /** Signed, expiring URL for the render thumbnail (§3.4). */
  renderThumbnailUrl: string | null;
}

/**
 * Her own enquiry — `GET /enquiries` (list rows) and `GET /enquiries/:enquiryId` (one), both
 * returning this same shape with `items` populated either way (C-36). **Internal notes are never
 * included** (A-24) — there is no field for one to arrive in.
 */
export interface MyEnquiry {
  id: Uuid;
  /** `ENQ-2026-000137`, shown to both sides (§4.23). */
  reference: string;
  status: EnquiryStatus;
  message: string;
  eventDate: IsoDate | null;
  eventType: EventType | null;
  budgetBand: BudgetBand | null;
  /** Total at the time she sent it. */
  totalValue: number | null;
  itemCount: number;
  items: EnquiryItem[];
  createdAt: IsoDateTime;
  closedAt: IsoDateTime | null;
}

/** `GET /enquiries` (CONSUMER) — no free-text search; filter by status only (C-36). */
export interface MyEnquiryListQuery extends PaginationQuery {
  status?: EnquiryStatus;
  sortBy?: 'createdAt' | 'status';
}

/* ---------------------------------------------------------------------- admin */

/** One frozen item as an **admin** sees it (A-21) — adds the full render, reachable only here (S-10). */
export interface AdminEnquiryItem extends EnquiryItem {
  /** Signed, expiring URL for the full render (§3.4), scoped to the requesting admin. */
  renderUrl: string | null;
}

/** One row of `GET /admin/enquiries` (ADMIN) — the inbox of A-25. */
export interface AdminEnquiryListItem {
  id: Uuid;
  reference: string;
  status: EnquiryStatus;
  contactName: string;
  eventType: EventType | null;
  eventDate: IsoDate | null;
  budgetBand: BudgetBand | null;
  itemCount: number;
  totalValue: number | null;
  assignedTo: Uuid | null;
  /** A-25: true when untouched for more than 24 hours. Derived, never stored. */
  isStale: boolean;
  firstRespondedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/**
 * `GET /admin/enquiries/:enquiryId` (ADMIN) — A-21. Contact details (snapshotted at submission,
 * never a live join onto `users`), event, budget, ranked items with renders. Internal notes have
 * their own route (A-24).
 */
export interface AdminEnquiryDetail extends AdminEnquiryListItem {
  /** The consumer who sent it. */
  userId: Uuid;
  /** Verified at submission (A-21). */
  contactEmail: string;
  /** Verified by OTP before sending (C-3). */
  contactPhone: string;
  message: string;
  /** A-22. Set only on a lost enquiry. */
  lostReason: string | null;
  closedAt: IsoDateTime | null;
  items: AdminEnquiryItem[];
}

export interface AdminEnquiryListQuery extends SearchablePaginationQuery {
  status?: EnquiryStatus;
  /** A-25 stale-after-24-h filter. */
  stale?: boolean;
  assignedTo?: Uuid;
  sortBy?: 'createdAt' | 'status';
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
  assignedTo: Uuid | null;
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

/**
 * `GET /admin/enquiries/:enquiryId/whatsapp-link` (ADMIN) — A-23. Built from the **brand**
 * WhatsApp number in Settings (A-27); an admin's own number is never used.
 */
export interface WhatsAppLinkResponse {
  /** A `wa.me` deep link pre-filled with her name and top pieces. */
  url: string;
  /** The pre-filled message body, so the admin can review or edit before sending. */
  message: string;
}
