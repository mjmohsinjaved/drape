/**
 * Server-side limits for a consumer's person photo (PRD C-14, C-16, §5.9).
 *
 * PRD C-14 puts a validation pass in the browser — resolution, framing, blur, single
 * subject — and that pass is a **courtesy**, not the enforcement point. It runs on a
 * device the consumer controls, it can be skipped by anyone who talks to the API
 * directly, and a bad photo that slips past it costs a generation and a moderation
 * review. Everything below is therefore re-derived from the stored bytes by
 * `sharp`, on the server, after the upload ticket has been redeemed (§3.5 step 3).
 *
 * The numbers are deliberately *not* the A-10 garment thresholds. A studio
 * photograph of a lehenga must be 2000px on the long edge; a full-body phone
 * snapshot taken at chest height in a hallway must not be held to that, or the
 * fitting room refuses the median Android on the median mobile connection. What the
 * upstream actually needs is enough pixels to place a garment and a frame that is
 * taller than it is wide.
 */

/** Formats `sharp` reports that a person photo may be stored in (§3.5). */
export const ALLOWED_PHOTO_FORMATS: readonly string[] = ['jpeg', 'jpg', 'png', 'webp', 'heif'];

/** Below this the upstream has too little to work with. */
export const MIN_PHOTO_LONG_EDGE_PX = 800;

/** A frame this large is a re-encode gone wrong, not a photograph. */
export const MAX_PHOTO_LONG_EDGE_PX = 10_000;

/** Neither edge may be smaller than this, however long the other one is. */
export const MIN_PHOTO_SHORT_EDGE_PX = 500;

/**
 * `width / height`. C-13 asks for a full-body, front-facing frame; anything wider
 * than it is tall is a landscape shot and cannot contain one.
 */
export const MIN_PHOTO_ASPECT_RATIO = 0.4;
export const MAX_PHOTO_ASPECT_RATIO = 1.05;

/** Matches `UPLOAD_PURPOSE_POLICIES[PERSON_PHOTO].maxBytes` — 15 MB (§3.5). */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/** §3.6 — the 160w blurred derivative is the only thing an admin can ever see (S-10, A-34). */
export const BLURRED_THUMBNAIL_WIDTH = 160;

/** `label` is `varchar(60)` (§4.16). */
export const MAX_PHOTO_LABEL_LENGTH = 60;

/** Fallback when `PHOTO_RETENTION_DAYS` is absent — §9.3 says 30 days. */
export const DEFAULT_PHOTO_RETENTION_DAYS = 30;
