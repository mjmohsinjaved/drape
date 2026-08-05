/**
 * The numbers the shortlist is built on — PRD C-20, C-21, C-32, ARCHITECTURE §4.20.
 *
 * They live here rather than inline so the DTO that validates a note and the service
 * that stores one cannot disagree about its length, and so a reorder payload has one
 * documented ceiling rather than one per call site.
 */

/**
 * Longest per-item note (C-32).
 *
 * The column is `text`, deliberately — the cap is a product decision about what a
 * note *is* ("too heavy for a Mehndi", not an essay), and a product decision belongs
 * in validation rather than in the schema, where changing it would mean a migration.
 */
export const MAX_SHORTLIST_NOTE_LENGTH = 500;

/**
 * Upper bound on one drag-to-rank payload.
 *
 * A shortlist this long is not a shortlist, and an unbounded array is an unbounded
 * write: the reorder renumbers every row it is given inside one transaction.
 */
export const MAX_SHORTLIST_REORDER_BATCH = 200;

/**
 * Ranks are contiguous and **1-based** — `1` is the piece she wants most.
 *
 * 1-based rather than 0-based because the rank is shown to a human ("your top three")
 * and is snapshotted verbatim into `enquiry_items.rank`, which an admin reads.
 */
export const FIRST_SHORTLIST_RANK = 1;
