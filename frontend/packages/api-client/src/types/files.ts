
import type { IsoDateTime, Uuid } from './common';

export const UPLOAD_PURPOSES = [
  'PERSON_PHOTO',
  'GARMENT_IMAGE',
  'CATEGORY_COVER',
  'BRAND_ASSET',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

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


export interface CreateUploadTicketRequest {
  purpose: UploadPurpose;
  /** The container format the client intends to send. */
  contentType: string;
  /** Intended size in bytes. The issued ceiling is the lower of this and the purpose limit. */
  byteSize: number;
  /** The garment or category the object belongs to. Required for the two catalog purposes. */
  ownerId?: Uuid;
}

export interface UploadTicket {
  /** Where to PUT the bytes. `isDirect` says whether that is this API or the bucket. */
  uploadUrl: string;
  ticket: string;
  key: string;
  fields: Record<string, string>;
  expiresAt: IsoDateTime;
  isDirect: boolean;
  purpose: UploadPurpose;
  maxBytes: number;
  contentType: string;
}

/** `PUT /files/upload` (PUBLIC — the `X-Upload-Ticket` header is the credential) — step 2 of §3.5. */
export interface UploadResult {
  key: string;
  byteSize: number;
  contentType: string;
}
