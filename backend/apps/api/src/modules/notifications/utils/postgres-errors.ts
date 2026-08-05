/**
 * The one PostgreSQL error class the outbox expects, recognised narrowly.
 *
 * `UQ_notifications_outbox_dedupe` (§4.32) is how "tell the operator once" is
 * enforced: the second alert inside the same window carries the same `dedupeKey`, the
 * index refuses it with `23505`, and the refusal *is* the deduplication. A flag in
 * memory would forget across a restart and a `SELECT` first would race.
 *
 * A blanket `catch {}` would be a real defect here — a dropped connection must
 * surface, not be silently read as "already enqueued" — so this is a predicate over
 * the SQLSTATE rather than over the message text, which is localised and versioned.
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
