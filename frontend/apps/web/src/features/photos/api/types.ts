
export type PhotoModerationState = 'PENDING' | 'APPROVED' | 'BLOCKED';

/** One row of `GET /person-photos` (CONSUMER) — C-16. */
export interface PersonPhoto {
  id: string;
  /** Signed, owner-scoped, 300-second URL (§3.4). Never a storage key. */
  url: string;
  isActive: boolean;
  label: string | null;
  moderationState: PhotoModerationState;
  width: number;
  height: number;
  byteSize: number;
  mimeType: string;
  uploadedAt: string;
  /** When the §9.3 purge removes it — 30 days after the account was last active. */
  purgeAfter: string;
  createdAt: string;
}

/** `POST /person-photos` — step 3 of the §3.5 upload dance: name the key the bytes landed on. */
export interface FinalisePhotoBody {
  key: string;
  label?: string;
  /** Defaults server-side to true for her first photo and false afterwards (C-16). */
  activate?: boolean;
}

export interface RenamePhotoBody {
  /** `null` clears the label; omitting the field leaves it alone. */
  label: string | null;
}

/* ---------------------------------------------------------------- files (§3.5) */

export type UploadPurpose = 'PERSON_PHOTO' | 'GARMENT_IMAGE' | 'CATEGORY_COVER' | 'BRAND_ASSET';

export interface CreateUploadTicketBody {
  purpose: UploadPurpose;
  contentType: string;
  byteSize: number;
  ownerId?: string;
}

/**
 * `POST /files/upload-ticket`. The one response in the API that carries a storage key, and only
 * because it names an object that does not exist yet and is already bound into the HMAC.
 */
export interface UploadTicket {
  uploadUrl: string;
  ticket: string;
  key: string;
  fields: Record<string, string>;
  expiresAt: string;
  /** True when the bytes bypass the API and go straight to the bucket. */
  isDirect: boolean;
  purpose: UploadPurpose;
  maxBytes: number;
  contentType: string;
}

export interface UploadResult {
  key: string;
  byteSize: number;
  contentType: string;
}
