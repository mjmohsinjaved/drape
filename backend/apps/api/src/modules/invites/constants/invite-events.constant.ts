/**
 * Domain events emitted by `invites` — `domain.action` (§2.2).
 *
 * Audit rows are written by the `audit` module's `@OnEvent` listener, not here
 * (§2.9 rule 4). The matching `AUDIT_ACTIONS` codes already exist: `USER_INVITED`,
 * `INVITE_RESENT`, `INVITE_REVOKED`, `INVITE_ACCEPTED`.
 *
 * **No payload below carries the token or its hash.** An audit row is read by more
 * people, and kept for longer, than any credential should be.
 */
export const INVITE_EVENTS = {
  /** → `USER_INVITED`. */
  CREATED: 'invite.created',
  /** → `INVITE_RESENT`. A resend issues a new token and resets the expiry. */
  RESENT: 'invite.resent',
  /** → `INVITE_REVOKED`. */
  REVOKED: 'invite.revoked',
  /** → `INVITE_ACCEPTED`. Emitted when `auth` consumes the token. */
  ACCEPTED: 'invite.accepted',
} as const;

export type InviteEventName = (typeof INVITE_EVENTS)[keyof typeof INVITE_EVENTS];

interface InviteEventBase {
  readonly inviteId: string;
  readonly email: string;
  /** The admin who acted. For `ACCEPTED` this is the new account itself. */
  readonly actorId: string;
  readonly occurredAt: Date;
}

export interface InviteIssuedEvent extends InviteEventBase {
  readonly expiresAt: Date;
  /** Whether the email actually left the building. A failed send is not a failed invite. */
  readonly emailDelivered: boolean;
}

export type InviteRevokedEvent = InviteEventBase;

export interface InviteAcceptedEvent extends InviteEventBase {
  readonly consumedByUserId: string;
}
