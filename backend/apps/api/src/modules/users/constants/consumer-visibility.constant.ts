/**
 * **PRD S-10, enforced in the query layer.**
 *
 * > "Admins cannot view consumer photos. They see renders only where a consumer has
 * > submitted an enquiry, plus blurred thumbnails in the moderation queue. Enforced
 * > in the query layer and covered by test."
 *
 * These are the complete column allow-lists every admin-facing consumer query
 * selects from. Nothing here is a filter applied after the fact — a column absent
 * from the list is never read out of the database, so it cannot leak through a
 * mapper bug, a `class-transformer` oversight or a future DTO change.
 *
 * Three structural facts back that up, and each has a test:
 *
 * 1. `ConsumerQueryService` is constructed with no `person_photos` repository. It
 *    has no handle on the table, so an admin-facing query **cannot** select a photo
 *    column even by accident.
 * 2. Renders are reachable only through `enquiry_items` → `enquiries`, scoped to the
 *    same `userId`. `enquiry_items` "is the sole basis on which an admin may view a
 *    render" (§4.24).
 * 3. `storageKey` is read but never mapped: it is exchanged for a short-lived signed
 *    URL scoped to the **requesting admin**, and §3.4 forbids a storage key from
 *    crossing the network boundary at all.
 */

/**
 * `users` columns readable by an admin consumer query (A-16, A-17).
 *
 * Deliberately absent: `passwordHash`, `failedLoginCount`, `lockedUntil`. A
 * credential or a lockout counter has no place in an admin console response.
 */
export const CONSUMER_USER_COLUMNS = [
  'id',
  'name',
  'email',
  'phone',
  'status',
  'suspendedReason',
  'suspendedAt',
  'emailVerifiedAt',
  'phoneVerifiedAt',
  'locale',
  'createdAt',
  'lastActiveAt',
  'lastLoginAt',
  'deletionRequestedAt',
] as const;

/** `consumer_profiles` columns readable by an admin (A-17, A-18). */
export const CONSUMER_PROFILE_COLUMNS = [
  'id',
  'userId',
  'eventDate',
  'eventType',
  'budgetBand',
  'preferredCategories',
  'monthlyQuotaOverride',
  'onboardingCompletedAt',
] as const;

/**
 * `tryon_results` columns readable by an admin, and only through the enquiry join.
 *
 * `personPhotoId` and `personPhotoLabelSnapshot` are excluded: neither is the photo,
 * but neither is any of an admin's business either, and leaving them out keeps the
 * "no path from an admin route to a person photo" claim total.
 */
export const ADMIN_RENDER_COLUMNS = [
  'id',
  'createdAt',
  'storageKey',
  'thumbnailKey',
  'garmentTitleSnapshot',
  'garmentCategorySnapshot',
  'garmentPriceSnapshot',
  'garmentCurrencySnapshot',
  'width',
  'height',
] as const;

/**
 * Table and column names that must never appear in a query built by an admin
 * consumer route. The S-10 test asserts the recorded query-builder fragments
 * contain none of them.
 */
export const PHOTO_FORBIDDEN_FRAGMENTS = [
  'person_photos',
  'personPhoto',
  'person-photos',
  'blurredThumbnailKey',
] as const;
