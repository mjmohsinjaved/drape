import type { Locale, Role } from '@library/common';

import type { AuthUser } from './user-directory.interface';
import type { EntityManager } from 'typeorm';

/**
 * The second seam between `auth` and `users` — ARCHITECTURE §5.3, PRD S-5.
 *
 * > "Admin accounts are created only by the deployment seed script or by invitation
 * > from an existing Admin, accepted through a single-use emailed token."
 *
 * `auth` owns `POST /invites/token/:token/accept` because accepting an invitation is
 * account creation: hash a password to the S-6 policy, open a session, force S-8
 * enrolment. It still may not write the `users` table itself (§4.33, §2.9 rule 5), so
 * this is the narrow method the `users` module binds to
 * `INVITED_ACCOUNT_DIRECTORY`.
 *
 * Kept apart from `UserDirectory` on purpose: that interface has no `role` field *by
 * construction*, and the signup path must keep it that way (S-4).
 */
export interface CreateInvitedAccountInput {
  /**
   * Pre-allocated by `auth` so the invite row can record `consumedByUserId` and the
   * account can be inserted in **one** transaction, in either order, without a second
   * round trip to read back a generated key.
   */
  readonly id: string;
  /**
   * **From the invite row, never from the request body.** The whole point of S-5 is
   * that the emailed token, not the caller, decides which address becomes an admin.
   */
  readonly email: string;
  /** Also from the invite row. Always `Role.ADMIN` in V1. */
  readonly role: Role;
  readonly name: string;
  /** Argon2id hash. The plaintext never crosses this boundary. */
  readonly passwordHash: string;
  /** `users.invitedBy` — the admin who sent the invitation (§4.3). */
  readonly invitedBy: string;
  readonly locale: Locale;
  /**
   * When the address counts as proven.
   *
   * Redeeming the token *is* proof of control of the mailbox it was sent to — the
   * value was never stored, so it could only have arrived by email — and a new admin
   * who had to verify an address they had just demonstrated control of would be
   * blocked from the S-8 enrolment the invitation exists to reach.
   */
  readonly emailVerifiedAt: Date;
}

export interface CreateInvitedAccountOptions {
  /**
   * The transactional manager of `auth`'s `runInTransaction` block.
   *
   * Always supplied in practice: the account insert and the token burn must commit
   * together, or a crash between them leaves either an admin nobody invited or a
   * spent invitation with no account behind it.
   */
  readonly manager?: EntityManager;
}

/** Implemented by the `users` module, consumed by `auth`'s invite-acceptance flow. */
export interface InvitedAccountDirectory {
  /**
   * Creates the account an accepted invitation describes.
   *
   * @throws `EMAIL_ALREADY_EXISTS` when a live account already holds the address.
   */
  createInvitedAccount(
    input: CreateInvitedAccountInput,
    options?: CreateInvitedAccountOptions,
  ): Promise<AuthUser>;
}
