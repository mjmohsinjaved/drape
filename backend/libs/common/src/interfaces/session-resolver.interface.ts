import type { ICurrentUser } from './current-user.interface';

/**
 * The seam between `SessionAuthGuard` (this library) and the auth module
 * (`apps/api/src/modules/auth`).
 *
 * `libs/*` must not import from `@api/*` (§1.1 import rules), so the guard depends
 * on this interface and the auth module binds an implementation to
 * `SESSION_RESOLVER` in `global-providers.ts`. **No session lookup happens here** —
 * the cookie hash, the `revokedAt` / `expiresAt` / `absoluteExpiresAt` checks, the
 * sliding expiry and the `lastSeenAt` write all live in the auth module
 * (§2.7 guard 3).
 */
export const SESSION_RESOLVER = Symbol('SESSION_RESOLVER');

/** Read-only request facts the resolver may need for audit and sliding expiry. */
export interface SessionResolutionContext {
  /** Client IP as resolved by Express, honouring `TRUST_PROXY`. */
  ip: string | undefined;
  userAgent: string | undefined;
  method: string;
  path: string;
  /**
   * true when the route carries `@Public()`. The resolver should still return the
   * caller when a valid session is presented, so `@CurrentUser()` works on public
   * routes, but must not throw for an absent or expired session (§2.6).
   */
  isPublicRoute: boolean;
}

/**
 * Resolves the raw session cookie value to the caller.
 *
 * Implementations return `null` when the token does not identify a usable session
 * on a public route, and throw an `AppException` carrying the precise code
 * (`SESSION_EXPIRED`, `SESSION_INVALID`, `ACCOUNT_SUSPENDED`, `ACCOUNT_DEACTIVATED`)
 * on a protected one.
 */
export interface SessionResolver {
  resolve(sessionToken: string, context: SessionResolutionContext): Promise<ICurrentUser | null>;
}
