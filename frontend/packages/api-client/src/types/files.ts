/**
 * ARCHITECTURE.md §5.20 `files`, §3.4 and §3.5.
 *
 * `GET /files/:token` returns a **binary stream, not an envelope** — it is one of only two routes
 * in the whole API that does. The client never calls it through axios: it puts the URL in an
 * `<img src>` or an anchor. There is therefore no response type for it here, only the shapes the
 * three-step upload flow exchanges.
 *
 * Written against `modules/files/dto/**`.
 */

import type { IsoDateTime, Uuid } from './common';

export const UPLOAD_PURPOSES = [
  'PERSON_PHOTO',
  'GARMENT_IMAGE',
  'CATEGORY_COVER',
  'BRAND_ASSET',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/**
 * A-10: "accepted format — HEIC, WebP, PNG, JPEG", as `ALLOWED_UPLOAD_MIME_TYPES` spells them.
 * The declared type is checked against the file's magic bytes on redemption; a mismatch is refused.
 */
export const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;
export type AcceptedImageMimeType = (typeof ACCEPTED_IMAGE_MIME_TYPES)[number];

/** `UPLOAD_PURPOSE_POLICIES[…].maxBytes` — refuse locally before spending the bandwidth. */
export const MAX_PERSON_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAX_GARMENT_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_CATEGORY_COVER_BYTES = 10 * 1024 * 1024;

/**
 * `POST /files/upload-ticket` (ADMIN, CONSUMER) — step 1 of §3.5.
 *
 * The client declares what it is about to send. **It never names a key** (§3.3): the key is
 * chosen server-side, and for a `PERSON_PHOTO` the owner is always the caller's own id (§9.2), so
 * `ownerId` is ignored on that purpose.
 */
export interface CreateUploadTicketRequest {
  purpose: UploadPurpose;
  /** The container format the client intends to send. */
  contentType: string;
  /** Intended size in bytes. The issued ceiling is the lower of this and the purpose limit. */
  byteSize: number;
  /** The garment or category the object belongs to. Required for the two catalog purposes. */
  ownerId?: Uuid;
}

/**
 * `UploadTicketResponseDto` — step 2 of §3.5.
 *
 * There is no bare `ticket` field: `uploadUrl` already carries the signed ticket, and `key` is
 * what the owning module's finalise endpoint wants afterwards.
 */
export interface UploadTicket {
  /** Where to PUT the bytes. `isDirect` says whether that is this API or the bucket. */
  uploadUrl: string;
  /** The key the object will occupy. Hand it to the owning finalise endpoint. */
  key: string;
  /** Extra form fields the client must send. Empty for the local driver. */
  fields: Record<string, string>;
  expiresAt: IsoDateTime;
  /** True when the bytes bypass this API and go straight to the bucket. */
  isDirect: boolean;
  purpose: UploadPurpose;
  /** The ceiling the redemption enforces while streaming. */
  maxBytes: number;
  contentType: string;
}

/** `PUT /files/upload/:ticket` (PUBLIC — the ticket is the credential) — step 2 of §3.5. */
export interface UploadResult {
  /** Hand this to the owning module's finalise endpoint. */
  key: string;
  /** Bytes actually written, measured by the server as it wrote them. */
  byteSize: number;
  /** Resolved from the magic bytes, not from what the client claimed. */
  contentType: string;
}
