/**
 * Environment validation primitives — ARCHITECTURE.md §7, PRD E-2.
 *
 * "A missing required variable fails startup or the build, never a request."
 * **No credential has a fallback default in code.** `requireEnv` therefore throws
 * rather than returning a placeholder, and `optionalEnv` is explicitly documented as
 * being for non-secrets only.
 *
 * `apps/api/src/bootstrap/validate-env.ts` owns the actual list of required names
 * for the API and calls these helpers; the helpers themselves are app-agnostic.
 */

/** A `process.env`-shaped source. Injectable so tests never mutate the real one. */
export type EnvSource = Record<string, string | undefined>;

/** Thrown when required configuration is absent or malformed. */
export class EnvValidationError extends Error {
  readonly missing: readonly string[];

  constructor(message: string, missing: readonly string[] = []) {
    super(message);
    this.name = 'EnvValidationError';
    this.missing = missing;
  }
}

/**
 * Asserts every name in `required` is present and non-empty.
 *
 * Reports **all** missing names at once — a boot loop that reveals one missing
 * variable per restart wastes an operator's afternoon.
 */
export function validateRequiredEnvVars(
  required: readonly string[],
  env: EnvSource = process.env,
): void {
  const missing = required.filter((name) => {
    const value = env[name];
    return value === undefined || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new EnvValidationError(
      `Missing required environment variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}. ` +
        'See ARCHITECTURE.md §7 and backend/.env.example. No secret has a fallback default (E-2).',
      missing,
    );
  }
}

/** Reads a required variable. Throws when absent — never returns a default. */
export function requireEnv(name: string, env: EnvSource = process.env): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new EnvValidationError(`Missing required environment variable: ${name}`, [name]);
  }
  return value.trim();
}

/**
 * Reads an optional variable with a fallback.
 *
 * **Non-secrets only.** A port, a TTL, a cookie name or a driver selector may have a
 * default; a key, a password or a connection string may not (E-2). Use `requireEnv`
 * for anything a value could be forged from.
 */
export function optionalEnv(name: string, fallback: string, env: EnvSource = process.env): string {
  const value = env[name];
  return value === undefined || value.trim().length === 0 ? fallback : value.trim();
}

/** Reads an integer variable, with range checking. Non-secrets only. */
export function intEnv(
  name: string,
  fallback: number,
  options: { min?: number; max?: number; env?: EnvSource } = {},
): number {
  const env = options.env ?? process.env;
  const raw = env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed)) {
    throw new EnvValidationError(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  if (options.min !== undefined && parsed < options.min) {
    throw new EnvValidationError(`Environment variable ${name} must be >= ${options.min}`);
  }
  if (options.max !== undefined && parsed > options.max) {
    throw new EnvValidationError(`Environment variable ${name} must be <= ${options.max}`);
  }
  return parsed;
}

/** Reads a boolean variable. Accepts `true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off`. */
export function boolEnv(name: string, fallback: boolean, env: EnvSource = process.env): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const normalised = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalised)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalised)) {
    return false;
  }
  throw new EnvValidationError(`Environment variable ${name} must be a boolean, got "${raw}"`);
}

/** Reads a variable constrained to a closed set of values. */
export function enumEnv<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T | undefined,
  env: EnvSource = process.env,
): T {
  const raw = env[name]?.trim();
  if (raw === undefined || raw.length === 0) {
    if (fallback === undefined) {
      throw new EnvValidationError(`Missing required environment variable: ${name}`, [name]);
    }
    return fallback;
  }
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new EnvValidationError(
      `Environment variable ${name} must be one of: ${allowed.join(' | ')}. Got "${raw}".`,
    );
  }
  return raw as T;
}

/** Reads a comma-separated list. Blank entries are dropped. */
export function listEnv(name: string, env: EnvSource = process.env): string[] {
  const raw = env[name];
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Asserts a variable holds a hex secret of at least `minBytes` of entropy.
 *
 * §7 specifies 64 hex characters (32 bytes) for `SESSION_SECRET`, `CSRF_SECRET` and
 * `STORAGE_URL_SECRET`. **The value is never echoed in the error message.**
 */
export function requireHexSecret(
  name: string,
  minBytes = 32,
  env: EnvSource = process.env,
): string {
  const value = requireEnv(name, env);
  if (!/^[0-9a-fA-F]+$/.test(value)) {
    throw new EnvValidationError(`Environment variable ${name} must be hexadecimal.`);
  }
  if (value.length < minBytes * 2) {
    throw new EnvValidationError(
      `Environment variable ${name} must be at least ${minBytes * 2} hex characters ` +
        `(${minBytes} bytes of entropy).`,
    );
  }
  return value;
}
