/**
 * The two PostgreSQL error classes a `SERIALIZABLE` transaction is *expected* to
 * produce, and a total function for recognising them.
 *
 * Both ledgers derive a balance and then append a row inside one transaction. Under
 * `SERIALIZABLE` that is exactly the read-then-write pattern PostgreSQL guards with
 * predicate locks: when two transactions read the same `(userId, period)` rows and
 * both insert, one of them is aborted with `40001` rather than being allowed to
 * commit an interleaving that no serial order could have produced. **That abort is
 * the mechanism that makes a double spend impossible**, so it is a normal, expected
 * outcome of a race — not a fault — and the caller retries once, at which point the
 * winner's row is visible and the loser correctly sees an exhausted balance.
 *
 * Retrying blindly on *any* error would be a real bug: a constraint violation, a
 * connection drop or a programming mistake must surface, not be papered over by a
 * second attempt. Hence a narrow predicate rather than a `catch {}`.
 */

/** `serialization_failure` — the SERIALIZABLE conflict this module relies on. */
export const SERIALIZATION_FAILURE = '40001';

/** `deadlock_detected` — the same situation reached from the other direction. */
export const DEADLOCK_DETECTED = '40P01';

/** true when `error` is a PostgreSQL serialization failure or deadlock. */
export function isSerializationFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === SERIALIZATION_FAILURE || code === DEADLOCK_DETECTED;
}
