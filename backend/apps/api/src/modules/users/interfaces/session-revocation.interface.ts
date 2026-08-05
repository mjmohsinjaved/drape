import type { EntityManager } from 'typeorm';

/**
 * The seam between this module and `auth`.
 *
 * A-2 and A-19 are explicit: deactivation and suspension are **immediate**, which
 * means every live session for that account is revoked in the same unit of work as
 * the status change. §2.7 puts that revocation on the `sessions` table, and
 * `sessions` belongs to the `auth` module (§4.33) — this module must never write to
 * it directly.
 *
 * So `users` depends on this narrow port and `auth` binds an implementation to
 * {@link SESSION_REVOCATION} — `SessionRevocationService`, which is the only class in
 * the application holding a `Repository<Session>`. `AuthModule` is `@Global()`, so
 * the binding reaches this module's injector without `UsersModule` importing it:
 * the single module edge between the pair points the other way, from `auth` to
 * `users`, for `USER_DIRECTORY`.
 *
 * There is deliberately **no fallback binding**. A no-op that revokes nothing turns
 * an unbound seam into a silent security defect, and a boot that fails is the only
 * honest alternative — `apps/api/test/boot/api-module.spec.ts` fails loudly if this
 * token is ever unresolvable again.
 */
export const SESSION_REVOCATION = Symbol('SESSION_REVOCATION');

/** Why the sessions are being revoked. Recorded by `auth` on the `sessions` rows. */
export type SessionRevocationReason =
  'ROLE_CHANGED' | 'DEACTIVATED' | 'SUSPENDED' | 'DELETION_REQUESTED';

export interface RevokeSessionsOptions {
  /**
   * The transactional manager of the caller's `runInTransaction` block. When present
   * the implementation **must** use it, so that the status change and the revocation
   * commit or roll back together (§2.9 rule 3).
   */
  readonly manager?: EntityManager;
  readonly reason?: SessionRevocationReason;
  /** Leaves one session alive — used when an admin acts on their own account. */
  readonly exceptSessionId?: string;
}

/**
 * Revokes sessions on behalf of another module.
 *
 * Implementations set `revokedAt` on every matching `sessions` row; guard 3 of the
 * chain then rejects the next request from that account (§2.7).
 */
export interface SessionRevocationPort {
  /** @returns how many sessions were revoked. */
  revokeAllForUser(userId: string, options?: RevokeSessionsOptions): Promise<number>;
}
