/**
 * ARCHITECTURE §3.5 — what each upload purpose is allowed to be.
 *
 * One table, four rows, and every decision the upload path makes reads out of it: who may ask
 * for a ticket, which prefix the bytes land under, how many of them there may be, which
 * container formats are accepted, and whether the file is re-encoded to strip metadata before
 * anybody can read it back.
 *
 * The table exists so the answer to "can a consumer upload a garment image?" is a lookup rather
 * than an `if` somewhere in a service. A new purpose is a row here plus a key builder in
 * `StorageKeys` — nothing else.
 */
import { Role } from '@library/common';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  keyPrefixSegment,
  StorageKeys,
  StoragePrefixes,
  type RasterImageExt,
} from '@library/storage';

import { UploadPurpose } from '../enums/upload-purpose.enum';

const MEGABYTE = 1024 * 1024;

/**
 * Where the id in an upload-ticket request comes from.
 *
 * `SELF` means the server uses the caller's own id and ignores anything the client sent — a
 * consumer cannot file a photo under another consumer's prefix by asking nicely (PRD §9.2).
 */
export type UploadOwnerKind = 'SELF' | 'GARMENT' | 'CATEGORY' | 'NONE';

export interface UploadPurposePolicy {
  readonly purpose: UploadPurpose;
  /** Roles permitted to request a ticket for this purpose (§3.5 step 1). */
  readonly roles: readonly Role[];
  readonly owner: UploadOwnerKind;
  /** Hard ceiling for this purpose. `StorageService` clamps it again to `STORAGE_MAX_UPLOAD_MB`. */
  readonly maxBytes: number;
  /** Accepted container formats. A subset of the §3.5 allow-list, never a superset. */
  readonly contentTypes: readonly string[];
  /**
   * PRD C-15 / §3.6 — re-encode on the way in so orientation is baked into the pixels and every
   * other metadata box (GPS, device, timestamps) is gone before the object is readable.
   */
  readonly stripExif: boolean;
  /** The §3.3 top-level segment this purpose's keys live under — `garments`, `brand`, … */
  readonly segment: string;
  /** The full prefix the built key must sit under. Asserted after building, never trusted. */
  prefix(ownerId: string): string;
  /** §3.3 — keys are built here and nowhere else. */
  buildKey(ownerId: string, ext: RasterImageExt): string;
}

/**
 * `image/svg+xml` is absent from every row on purpose. §3.3 allows `svg` under `brand/` "sanitised
 * before write", and there is no sanitiser in V1 — an SVG is a script host, and the one prefix it
 * would be allowed under is the one served to every visitor. A brand logo goes up as a PNG.
 */
const RASTER_UPLOAD_TYPES: readonly string[] = ALLOWED_UPLOAD_MIME_TYPES;

export const UPLOAD_PURPOSE_POLICIES: Readonly<Record<UploadPurpose, UploadPurposePolicy>> = {
  [UploadPurpose.PERSON_PHOTO]: {
    purpose: UploadPurpose.PERSON_PHOTO,
    // Only a consumer has person photos. An admin can never read one (S-10) and has no reason
    // to write one either.
    roles: [Role.CONSUMER],
    owner: 'SELF',
    maxBytes: 15 * MEGABYTE,
    contentTypes: RASTER_UPLOAD_TYPES,
    stripExif: true,
    segment: 'person-photos',
    prefix: (userId) => StoragePrefixes.personPhotosOfUser(userId),
    buildKey: (userId, ext) => StorageKeys.personPhoto(userId, ext),
  },

  [UploadPurpose.GARMENT_IMAGE]: {
    purpose: UploadPurpose.GARMENT_IMAGE,
    roles: [Role.ADMIN],
    owner: 'GARMENT',
    maxBytes: 25 * MEGABYTE,
    contentTypes: RASTER_UPLOAD_TYPES,
    // A garment photograph is studio work, not a phone snap. Nothing private is in its EXIF and
    // A-10 reads the orientation flag, so it is stored as shot.
    stripExif: false,
    segment: 'garments',
    prefix: (garmentId) => StoragePrefixes.garment(garmentId),
    buildKey: (garmentId, ext) => StorageKeys.garmentImage(garmentId, ext),
  },

  [UploadPurpose.CATEGORY_COVER]: {
    purpose: UploadPurpose.CATEGORY_COVER,
    roles: [Role.ADMIN],
    owner: 'CATEGORY',
    maxBytes: 10 * MEGABYTE,
    contentTypes: RASTER_UPLOAD_TYPES,
    stripExif: false,
    segment: 'categories',
    prefix: (categoryId) => StoragePrefixes.category(categoryId),
    buildKey: (categoryId, ext) => StorageKeys.categoryCover(categoryId, ext),
  },

  [UploadPurpose.BRAND_ASSET]: {
    purpose: UploadPurpose.BRAND_ASSET,
    roles: [Role.ADMIN],
    owner: 'NONE',
    maxBytes: 5 * MEGABYTE,
    contentTypes: RASTER_UPLOAD_TYPES,
    stripExif: false,
    segment: 'brand',
    prefix: () => StoragePrefixes.brand(),
    buildKey: (_ownerId, ext) => StorageKeys.brandAsset(ext),
  },
};

/** Every policy, for validation and for the OpenAPI enum. */
export const UPLOAD_PURPOSE_VALUES: readonly UploadPurpose[] = Object.values(UploadPurpose);

/**
 * The purposes whose objects are re-encoded on redemption, resolved from the key rather than
 * from the request — the key is the only thing the ticket actually commits to.
 */
export function policyForKey(key: string): UploadPurposePolicy | null {
  const segment = keyPrefixSegment(key);
  return (
    Object.values(UPLOAD_PURPOSE_POLICIES).find((policy) => policy.segment === segment) ?? null
  );
}
