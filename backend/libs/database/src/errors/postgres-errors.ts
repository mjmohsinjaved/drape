/**
 * The PostgreSQL error classes the application is *expected* to produce, and total
 * predicates for recognising them — ARCHITECTURE.md §2.9.
 *
 * ### Why these live here and not in a module
 *
 * Three modules used to keep a byte-identical copy of `isUniqueViolation`, a fourth kept
 * a copy that also unwrapped TypeORM's driver error, and a fifth kept `isSerializationFailure`.
 * The copies disagreed, and the disagreement was silent: whichever one a file happened to
 * import decided whether a `23505` arriving inside a `QueryFailedError` was recognised at
 * all. Where it was not, the enquiry reference-collision retry never fired and the outbox
 * dedupe refusal was reported as a genuine send failure.
 *
 * `@library/database` already owns the TypeORM coupling — it exports `paginate` and
 * `runInTransaction` — so it is where the shape of a driver error is allowed to be known.
 *
 * ### Why a predicate over the SQLSTATE, never a `catch {}`
 *
 * Each of these codes is a *mechanism*: the unique index refusing a duplicate is how
 * `UQ_enquiries_reference`, `UQ_notifications_outbox_dedupe`, `UQ_votes_link_voter_garment`
 * and the try-on idempotency key do their job, and the `SERIALIZABLE` abort is what makes a
 * double spend on `quota_ledger` impossible. Retrying blindly on *any* error would paper
 * over a dropped connection or a programming mistake; matching on the message text would
 * break the day the server is localised or upgraded. So: the SQLSTATE, and nothing else.
 */

/** `unique_violation`. */
export const UNIQUE_VIOLATION = '23505';

/** `serialization_failure` — the `SERIALIZABLE` conflict the ledgers rely on. */
export const SERIALIZATION_FAILURE = '40001';

/** `deadlock_detected` — the same situation reached from the other direction. */
export const DEADLOCK_DETECTED = '40P01';

/**
 * The SQLSTATE behind an error, wrapped or not.
 *
 * TypeORM wraps the driver's error in a `QueryFailedError` and hangs the original off
 * `driverError`. Depending on where in the stack the failure surfaces, the code is on the
 * outer object, the inner one, or both — which is exactly why `GlobalExceptionFilter`
 * reads `driverError?.code ?? code`. Anything that wants to classify a database failure
 * must look in both places or it will miss half of them.
 */
export function sqlStateOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const candidate = error as { code?: unknown; driverError?: { code?: unknown } };
  const code = candidate.driverError?.code ?? candidate.code;
  return typeof code === 'string' ? code : undefined;
}

/** true when `error` is a PostgreSQL unique-constraint violation, wrapped or not. */
export function isUniqueViolation(error: unknown): boolean {
  return sqlStateOf(error) === UNIQUE_VIOLATION;
}

/** true when `error` is a PostgreSQL serialization failure or deadlock, wrapped or not. */
export function isSerializationFailure(error: unknown): boolean {
  const code = sqlStateOf(error);
  return code === SERIALIZATION_FAILURE || code === DEADLOCK_DETECTED;
}
