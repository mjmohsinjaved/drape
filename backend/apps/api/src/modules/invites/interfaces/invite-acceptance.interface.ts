import type { Role } from '@library/common';

import type { EntityManager } from 'typeorm';

/**
 * The seam between `invites` and `auth`.
 *
 * §5.3 puts `POST /invites/token/:token/accept` on the invites path, but what that
 * route actually does is **create an account**: hash a password, apply the S-6
 * policy, open a session and force S-8 two-factor setup. All of that is `auth`'s,
 * and none of it belongs in a module whose job is to decide whether a token is
 * still good.
 *
 * So `auth` owns the route and calls {@link InvitesService.consumeToken} from inside
 * its own transaction. This module never creates a `users` row, and `auth` never
 * reads `invites.tokenHash`.
 */

/** What `auth` learns from a token it just consumed. */
export interface InviteAcceptance {
  readonly inviteId: string;
  /** Lower-cased. The account **must** be created for this address, not one supplied by the client. */
  readonly email: string;
  /** Always `Role.ADMIN` in V1 (S-5). Read from the row, never from the request. */
  readonly role: Role;
  /** The admin who sent the invite — becomes `users.invitedBy`. */
  readonly invitedBy: string;
  readonly expiresAt: Date;
}

export interface ConsumeInviteOptions {
  /**
   * The transactional manager of the caller's `runInTransaction` block.
   *
   * `auth` should always pass it: creating the account and consuming the token have
   * to commit together, or a crash in between leaves either an admin account nobody
   * invited or a burnt token with no account behind it.
   */
  readonly manager?: EntityManager;
  /** Injectable clock, so expiry can be tested without waiting seven days. */
  readonly now?: Date;
}
