/**
 * The numbers behind an enquiry — PRD A-21 … A-26, C-35, C-36.
 */

/**
 * A-25: "Enquiries untouched after 24 hours are highlighted."
 *
 * "Untouched" is `firstRespondedAt IS NULL` — the partial index in §4.23 exists for
 * exactly this query. Highlighting is a *presentation* fact, so it is computed on the
 * way out rather than stored: a stored flag would need a cron to stay true, and would
 * be wrong for the hour between the cron runs.
 */
export const ENQUIRY_STALE_AFTER_HOURS = 24;

/** Milliseconds in an hour. */
export const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/**
 * How many pieces the A-23 WhatsApp message names.
 *
 * "Pre-filled with her name and top pieces." Three, because the message opens in her
 * WhatsApp and a wall of titles is a message she has to scroll before she can read it.
 * Her rank order decides which three.
 */
export const WHATSAPP_TOP_PIECES = 3;

/** `enquiries.reference` is `varchar(20)`; `ENQ-2026-000137` is 15. */
export const ENQUIRY_REFERENCE_PREFIX = 'ENQ';

/** Zero-padded width of the per-year sequence in a reference. */
export const ENQUIRY_REFERENCE_SEQUENCE_WIDTH = 6;

/** Longest message a consumer can attach to an enquiry (C-35). */
export const MAX_ENQUIRY_MESSAGE_LENGTH = 2000;

/** Longest internal note (A-24). */
export const MAX_ENQUIRY_NOTE_LENGTH = 2000;

/** Longest reason on a lost enquiry (A-22). */
export const MAX_LOST_REASON_LENGTH = 500;

/**
 * Rows per page of the A-26 CSV export.
 *
 * The export streams: it reads a page, writes it, and lets the buffer drain before
 * reading the next. Holding a year of enquiries in memory to build one string is how
 * an export takes the API down with it.
 */
export const ENQUIRY_EXPORT_PAGE_SIZE = 200;
