/**
 * The numbers behind the A-34 queue and the A-35 abuse view.
 *
 * They are constants rather than settings: none of them is a business policy an admin
 * negotiates, and a `settings` read on a five-minute sweep would be a query per sweep
 * forever.
 */

/**
 * Columns of `person_photos` the moderation queue is allowed to select — **S-10**.
 *
 * `storageKey` is not on this list and must never be added to it. The entity's own
 * contract says so ("no admin-facing query may ever select `storageKey` from this
 * table"), and this is the enforcement: the queue cannot serve a consumer's original
 * photograph because it never loads the key that would let it. Not a check that could
 * be forgotten — an absence.
 *
 * The blurred derivative is the only image A-34 permits, and it is a different key on
 * a different object, produced by `ImageService.toBlurredModerationThumbnail()` at
 * upload time (§3.6: the blur is applied *before* the downscale, so it cannot be
 * sharpened back by upscaling).
 */
export const MODERATION_PHOTO_COLUMNS = {
  id: true,
  userId: true,
  blurredThumbnailKey: true,
  moderationState: true,
  uploadedAt: true,
  width: true,
  height: true,
  byteSize: true,
} as const;

/** `moderation_items.decisionNote` — a review note, not an essay. */
export const MAX_DECISION_NOTE_LENGTH = 1_000;

/** `ip_blocks.reason` is `varchar(255)` (§4.8). */
export const MAX_IP_BLOCK_REASON_LENGTH = 255;

/** How long an item may sit `PENDING` before E-14 calls the queue backed up. */
export const MODERATION_BACKLOG_THRESHOLD_HOURS = 12;

/** Below this many overdue items the queue is busy, not backed up. */
export const MODERATION_BACKLOG_MIN_OVERDUE = 5;

/** How often the backlog and authentication-anomaly sweeps run. */
export const MODERATION_SWEEP_MS = 5 * 60_000;

/** The window the A-35 abuse view and the E-14 anomaly sweep look back over. */
export const ABUSE_WINDOW_HOURS = 24;

/**
 * Failed authentication attempts on one route inside {@link ABUSE_WINDOW_MINUTES}
 * before E-14 calls it an anomaly.
 *
 * S-6 locks an individual account out after 5 failures in 15 minutes, so a number in
 * that region would fire on one person mistyping a password. This is a platform-level
 * signal — a spread of accounts, or a spread of addresses — and the threshold is set
 * where a single locked-out consumer cannot reach it alone.
 */
export const AUTH_ANOMALY_FAILURE_THRESHOLD = 50;

/** The window the anomaly sweep measures over. */
export const ABUSE_WINDOW_MINUTES = 60;

/** Distinct accounts or addresses that make a burst look distributed rather than personal. */
export const AUTH_ANOMALY_SPREAD_THRESHOLD = 5;

/** Accounts returned by one page of the A-35 abuse view. Bounded, like every list (§2.8). */
export const ABUSE_PAGE_LIMIT = 50;

/** Failures inside the window before an account appears on the A-35 list at all. */
export const ABUSE_MIN_FAILURES = 3;
