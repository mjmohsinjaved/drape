/**
 * The one PostgreSQL error class the submit path expects, recognised narrowly.
 *
 * `UQ_enquiries_reference` is what makes `ENQ-2026-000137` unique (§4.23). The
 * sequence behind it is derived by counting inside the transaction, so two submissions
 * arriving together can both derive `000137`; the index refuses the loser with `23505`
 * and the caller re-derives onto `000138`. That refusal is the mechanism, not a fault.
 *
 * A blanket `catch {}` would be a real bug: a dropped connection or a programming
 * mistake must surface rather than being retried into a second enquiry. Hence a
 * predicate over the SQLSTATE rather than over the message text, which is localised
 * and versioned.
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
