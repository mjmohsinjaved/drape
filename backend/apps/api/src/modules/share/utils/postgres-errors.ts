/**
 * The one PostgreSQL error class the vote path expects — and recognising it narrowly.
 *
 * `UQ_votes_link_voter_garment` is what actually enforces "one comment per item"
 * (C-33). Two requests from the same visitor for the same piece can both find no
 * existing row and both proceed to insert; the index refuses the second with `23505`.
 * That refusal is the mechanism, not a fault, so the caller re-reads and applies the
 * same rule it would have applied had it seen the row first time.
 *
 * A blanket `catch {}` would be a real bug here: a dropped connection or a programming
 * mistake must surface rather than being retried into a duplicate. Hence a predicate
 * over the SQLSTATE rather than over the message text, which is localised and versioned.
 */

/** `unique_violation`. */
export const UNIQUE_VIOLATION = '23505';

/** true when `error` is a PostgreSQL unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  return (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}
