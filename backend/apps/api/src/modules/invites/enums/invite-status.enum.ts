/**
 * The lifecycle state of an invite, **derived at read time**.
 *
 * `invites` has no status column and must not grow one (§4.9). Four columns already
 * say everything: `consumedAt`, `deletedAt` and `expiresAt` against the clock. A
 * fifth column holding the same fact could disagree with them — a revoked invite
 * still marked `PENDING` is an admin account waiting to happen — so the state is
 * computed, never stored.
 *
 * This is therefore **not** a PostgreSQL enum and does not appear in the §4.1
 * registry. It exists only on the wire, where the console filters and labels on it.
 */
export enum InviteStatus {
  /** Not consumed, not revoked, not yet expired. The only actionable state. */
  PENDING = 'PENDING',
  /** `consumedAt` is set — an admin account exists because of this row. */
  CONSUMED = 'CONSUMED',
  /** `expiresAt` has passed with no acceptance. */
  EXPIRED = 'EXPIRED',
  /** Soft-deleted by an admin before it was used. */
  REVOKED = 'REVOKED',
}

/** Every derivable status, for the console's filter control. */
export const INVITE_STATUSES: readonly InviteStatus[] = Object.values(InviteStatus);

/**
 * The single definition of how the columns collapse to a status.
 *
 * Order matters. Revocation wins over everything — an admin's explicit decision is
 * not undone by the clock — and consumption wins over expiry, because an invite
 * accepted at 23:59 is `CONSUMED` for ever, not `EXPIRED` a minute later.
 */
export function deriveInviteStatus(
  invite: { consumedAt: Date | null; expiresAt: Date; deletedAt: Date | null },
  now: Date = new Date(),
): InviteStatus {
  if (invite.deletedAt !== null) {
    return InviteStatus.REVOKED;
  }
  if (invite.consumedAt !== null) {
    return InviteStatus.CONSUMED;
  }
  return invite.expiresAt.getTime() <= now.getTime() ? InviteStatus.EXPIRED : InviteStatus.PENDING;
}
