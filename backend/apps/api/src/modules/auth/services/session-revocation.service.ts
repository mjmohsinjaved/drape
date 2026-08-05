import { Injectable } from '@nestjs/common';

import {
  type RevokeSessionsOptions,
  type SessionRevocationPort,
  type SessionRevocationReason,
} from '@api/modules/users/interfaces/session-revocation.interface';

import { REVOKE_REASONS, type RevokeReason } from '../auth.constants';

import { SessionService } from './session.service';

/**
 * `SESSION_REVOCATION` — the `auth` side of the seam `users` declares.
 *
 * ### Why the implementation lives here
 *
 * `sessions` belongs to `auth` (§4.33) and §2.9 rule 5 forbids `users` from writing
 * to it. So `users` depends on a port it declares, and this class — the only code
 * with a `Repository<Session>` behind it — binds to it. `AuthModule` is `@Global()`,
 * so the binding is visible in `UsersModule`'s injector **without** `UsersModule`
 * importing `AuthModule`: the one module edge in this pair points from `auth` to
 * `users` (for `USER_DIRECTORY`) and there is no cycle to break.
 *
 * ### The part of the contract that is a security property
 *
 * `RevokeSessionsOptions.manager` is documented as "when present the implementation
 * **must** use it". It is passed straight through to
 * {@link SessionService.revokeAllForUser}, which issues every UPDATE on that
 * transaction. A-2 and A-19 say deactivation and suspension are *immediate*; that is
 * only true if the `users.status` write and these `sessions.revokedAt` writes commit
 * together. Dropping the manager here would leave a window — status changed, cookie
 * still good, or worse, sessions killed by a status change that then rolled back.
 */
@Injectable()
export class SessionRevocationService implements SessionRevocationPort {
  constructor(private readonly sessions: SessionService) {}

  async revokeAllForUser(userId: string, options: RevokeSessionsOptions = {}): Promise<number> {
    return this.sessions.revokeAllForUser(userId, toRevokeReason(options.reason), new Date(), {
      manager: options.manager,
      exceptSessionId: options.exceptSessionId,
    });
  }
}

/**
 * The port's vocabulary → the closed `sessions.revokedReason` set of §4.5.
 *
 * `ROLE_CHANGED` and `DELETION_REQUESTED` have no column value of their own: §4.5
 * lists `LOGOUT`, `LOGOUT_ALL`, `PASSWORD_CHANGED`, `DEACTIVATED`, `SUSPENDED` and
 * `ADMIN_REVOKED`, and both of those reach this port from an admin acting on someone
 * else's account (`PATCH /admin/users/:userId/role`, `DELETE /admin/consumers/:userId`).
 * `ADMIN_REVOKED` is the honest value; inventing a seventh would put a string in the
 * column that §4.5 does not define.
 */
function toRevokeReason(reason: SessionRevocationReason | undefined): RevokeReason {
  switch (reason) {
    case 'DEACTIVATED':
      return REVOKE_REASONS.DEACTIVATED;
    case 'SUSPENDED':
      return REVOKE_REASONS.SUSPENDED;
    default:
      return REVOKE_REASONS.ADMIN_REVOKED;
  }
}
