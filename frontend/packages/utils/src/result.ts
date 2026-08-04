/**
 * A discriminated union for operations that can fail without throwing.
 *
 * Prefer this over `try/catch` at module boundaries where the caller has to render both
 * outcomes anyway (parsing, decoding, optional lookups). Domain errors coming back from the
 * API keep using the response envelope in `@repo/api-client` — this is for local, pure code.
 */

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E = Error> = Ok<T> | Err<E>;

/** Wraps a success value. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Wraps a failure value. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Type guard narrowing a `Result` to its success arm. */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/** Type guard narrowing a `Result` to its failure arm. */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Returns the success value, or `fallback` when the result failed. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/** Maps the success value, leaving a failure untouched. */
export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}
