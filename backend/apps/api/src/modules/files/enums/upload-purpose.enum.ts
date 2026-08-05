/**
 * ARCHITECTURE §3.5 step 1 — `purpose ∈ PERSON_PHOTO | GARMENT_IMAGE | CATEGORY_COVER |
 * BRAND_ASSET`.
 *
 * The purpose is what the API authorises against the caller's role, and it is what decides the
 * key prefix, the byte ceiling and whether the bytes get sanitised on the way in. A client
 * never names a key; it names a purpose, and the server builds the key (§3.3).
 */
export enum UploadPurpose {
  PERSON_PHOTO = 'PERSON_PHOTO',
  GARMENT_IMAGE = 'GARMENT_IMAGE',
  CATEGORY_COVER = 'CATEGORY_COVER',
  BRAND_ASSET = 'BRAND_ASSET',
}
