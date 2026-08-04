/**
 * ARCHITECTURE.md §5.9 `person-photos` and §4.16.
 *
 * **No admin-facing route returns anything from this module** (S-10). The only derivative an admin
 * can ever see is the blurred thumbnail on a moderation item (A-34), typed in `moderation.ts`.
 *
 * Deleting a photo retires its cache entries but **renders survive** (C-16, C-28) — the render row
 * keeps `personPhotoLabelSnapshot` so history and C-30 grouping still read correctly.
 */

import type { IsoDateTime, SignedFileUrl, Uuid } from './common';
import type { PhotoModerationState } from './enums';

/** One row of `GET /person-photos` (CONSUMER) — C-16. */
export interface PersonPhoto {
  id: Uuid;
  label: string | null;
  isActive: boolean;
  moderationState: PhotoModerationState;
  width: number;
  height: number;
  byteSize: number;
  mimeType: string;
  uploadedAt: IsoDateTime;
  /** `users.lastActiveAt + PHOTO_RETENTION_DAYS`, recomputed by the purge cron (§9.3, C-11). */
  purgeAfter: IsoDateTime;
  /** Short-lived signed thumbnail (`STORAGE_URL_TTL_PHOTO_SECONDS`). */
  thumbnail: SignedFileUrl;
  /** Full-size signed URL, issued only to the owner. */
  image: SignedFileUrl;
}

export interface PersonPhotoListResponse {
  photos: PersonPhoto[];
  /** `photos.maxPerConsumer` (C-16). Adding beyond it is `PHOTO_LIMIT_REACHED`. */
  maxPhotos: number;
  activePhotoId: Uuid | null;
}

/**
 * `POST /person-photos` (CONSUMER) — finalises an uploaded photo: probe, strip EXIF, thumbnail,
 * hash, moderate. **Requires current consent** (`CONSENT_REQUIRED` / `CONSENT_STALE`).
 *
 * Client-side validation (C-14) should catch most failures first; the server still answers with
 * `PHOTO_VALIDATION_FAILED` and `details.checks[]` when it does not.
 */
export interface FinalisePersonPhotoRequest {
  /** The upload ticket redeemed by `PUT /files/upload/:ticket` (§3.5). */
  ticket: string;
  label?: string | null;
  /** Make it the active photo in the same call (C-16). */
  setActive?: boolean;
}

/** `PATCH /person-photos/:photoId` (CONSUMER) — rename the label. */
export interface UpdatePersonPhotoRequest {
  label: string | null;
}

/** `POST /person-photos/:photoId/activate` (CONSUMER) — C-16. Exactly one photo is active. */
export interface ActivatePersonPhotoResponse {
  activePhotoId: Uuid;
}

/**
 * `DELETE /person-photos/:photoId` (CONSUMER) — deletes the photo and its file and retires its
 * cache entries. Renders generated from it survive (C-16, C-28).
 */
export interface DeletePersonPhotoResponse {
  deletedPhotoId: Uuid;
  /** How many renders keep the label snapshot; the confirmation copy quotes it (C-28). */
  retainedResultCount: number;
  /** The next active photo, or null when she deleted her last one. */
  activePhotoId: Uuid | null;
}

/** C-14 client-side photo checks, mirrored so the upload UI and the API agree on the vocabulary. */
export const PHOTO_CHECKS = [
  'MIN_RESOLUTION',
  'MAX_FILE_SIZE',
  'SUPPORTED_FORMAT',
  'SINGLE_SUBJECT',
  'FULL_BODY_VISIBLE',
  'ADEQUATE_LIGHTING',
  'NOT_BLURRY',
] as const;
export type PhotoCheck = (typeof PHOTO_CHECKS)[number];
