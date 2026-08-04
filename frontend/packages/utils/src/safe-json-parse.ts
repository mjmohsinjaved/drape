import { err, ok, type Result } from './result';

/**
 * `JSON.parse` that never throws.
 *
 * Used wherever the input is not under our control — `localStorage` written by an older build,
 * an SSE `data:` frame, a pasted payload. The caller must handle both arms; there is no silent
 * `catch {}` anywhere in this codebase.
 */

export interface SafeJsonParseOptions<T> {
  /**
   * Runtime narrowing. Without it, `T` is an unchecked assertion about the parsed shape;
   * with it, a structurally wrong payload lands in the error arm instead of blowing up later.
   * A Zod schema's `safeParse` fits: `(v): v is Foo => Schema.safeParse(v).success`.
   */
  guard?: (value: unknown) => value is T;
  /** `JSON.parse` reviver. */
  reviver?: (key: string, value: unknown) => unknown;
}

/**
 * @example
 * const parsed = safeJsonParse<Shortlist>(raw);
 * if (!parsed.ok) { return <ErrorState />; }
 * render(parsed.value);
 */
export function safeJsonParse<T = unknown>(
  input: string | null | undefined,
  options: SafeJsonParseOptions<T> = {},
): Result<T, Error> {
  const { guard, reviver } = options;

  if (typeof input !== 'string') {
    return err(new TypeError(`Expected a JSON string, received ${typeof input}.`));
  }

  let parsed: unknown;
  try {
    parsed = reviver === undefined ? JSON.parse(input) : JSON.parse(input, reviver);
  } catch (cause) {
    return err(cause instanceof Error ? cause : new SyntaxError(String(cause)));
  }

  if (guard && !guard(parsed)) {
    return err(new TypeError('Parsed JSON did not match the expected shape.'));
  }

  return ok(parsed as T);
}

/** `JSON.stringify` that never throws — circular structures land in the error arm. */
export function safeJsonStringify(value: unknown, space?: number | string): Result<string, Error> {
  try {
    const serialised = JSON.stringify(value, undefined, space);
    if (serialised === undefined) {
      return err(new TypeError('Value is not serialisable to JSON.'));
    }
    return ok(serialised);
  } catch (cause) {
    return err(cause instanceof Error ? cause : new TypeError(String(cause)));
  }
}
