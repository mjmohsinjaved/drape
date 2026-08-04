/**
 * ARCHITECTURE.md §5.20 `files`, §3.4 and §3.5.
 *
 * `GET /files/:token` returns a **binary stream, not an envelope** — it is one of only two routes
 * in the whole API that does. The client never calls it through axios: it puts the URL in an
 * `<img src>` or an anchor. There is therefore no response type for it here, only the token shape
 * the API hands out.
 *
 * The client never sees a storage key. It receives signed URLs and upload tickets, and nothing
 * else (§3.3).
 */

import type { IsoDateTime } from './common';

/**
 * §3.5 upload purposes. The purpose is authorised against the caller's role before a ticket is
 * issued, which is why a consumer can never obtain a `GARMENT_IMAGE` ticket.
 */
export const UPLOAD_PURPOSES = [
  'PERSON_PHOTO',
  'GARMENT_IMAGE',
  'CATEGORY_COVER',
  'BRAND_ASSET',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/**
 * `POST /files/upload-ticket` (ANY) — issues an upload ticket for a declared purpose. Rate-limited
 * to 20 / 60 s (§5.22).
 */
export interface CreateUploadTicketRequest {
  purpose: UploadPurpose;
  filename: string;
  mimeType: string;
  byteSize: number;
  /** Required for `GARMENT_IMAGE` and `CATEGORY_COVER`, so the ticket is scoped to its target. */
  targetId?: string;
}

/**
 * The ticket **is the credential** for `PUT /files/upload/:ticket` (local driver). It is
 * single-use and expires after `STORAGE_UPLOAD_TICKET_TTL_SECONDS`.
 */
export interface UploadTicket {
  ticket: string;
  /** Absolute URL to `PUT` the bytes to. Already includes the ticket. */
  uploadUrl: string;
  purpose: UploadPurpose;
  expiresAt: IsoDateTime;
  /** `STORAGE_MAX_UPLOAD_MB` in bytes, so the client can refuse locally before spending bandwidth. */
  maxByteSize: number;
  acceptedMimeTypes: string[];
}

/**
 * `PUT /files/upload/:ticket` (PUBLIC, ⊘ CSRF) — redeems a ticket by streaming the bytes. The
 * response confirms what landed; the file is not yet attached to anything until the owning
 * module's `finalise` call runs (`POST /person-photos`, `POST /admin/garments/:id/images`, …).
 */
export interface UploadTicketRedemption {
  ticket: string;
  byteSize: number;
  mimeType: string;
  width: number | null;
  height: number | null;
  uploadedAt: IsoDateTime;
}

/** Progress for the per-file upload UI of A-9 and C-15. Client-side only; never sent to the API. */
export const UPLOAD_STATUSES = [
  'QUEUED',
  'UPLOADING',
  'FINALISING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];
