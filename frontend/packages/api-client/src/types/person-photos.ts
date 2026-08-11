
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
  purgeAfter: IsoDateTime;
  thumbnail: SignedFileUrl;
  image: SignedFileUrl;
}

export interface PersonPhotoListResponse {
  photos: PersonPhoto[];
  maxPhotos: number;
  activePhotoId: Uuid | null;
}

export interface FinalisePersonPhotoRequest {
  ticket: string;
  label?: string | null;
  setActive?: boolean;
}

export interface UpdatePersonPhotoRequest {
  label: string | null;
}

export interface ActivatePersonPhotoResponse {
  activePhotoId: Uuid;
}

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
