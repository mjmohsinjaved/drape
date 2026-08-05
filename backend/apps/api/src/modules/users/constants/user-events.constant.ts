import type { Role, UserStatus } from '@library/common';

/**
 * Domain events emitted by this module — `domain.action` (§2.2).
 *
 * Audit rows are **not** written here. §2.9 rule 4 puts them in an `@OnEvent`
 * listener owned by the `audit` module, so every payload below carries the actor,
 * the subject and the before/after state that listener needs to build a row from
 * `AUDIT_ACTIONS`.
 *
 * Every one of these is emitted **after** `commitTransaction()`, never inside the
 * work callback (§2.9 rule 3).
 */
export const USER_EVENTS = {
  /** → `USER_ROLE_CHANGED`. */
  ROLE_CHANGED: 'user.role_changed',
  /** → `USER_DEACTIVATED`. */
  DEACTIVATED: 'user.deactivated',
  /** → `USER_REACTIVATED`. */
  REACTIVATED: 'user.reactivated',
  /** → `USER_SUSPENDED`. */
  SUSPENDED: 'user.suspended',
  /** → `USER_UNSUSPENDED`. */
  UNSUSPENDED: 'user.unsuspended',
  /** → `QUOTA_OVERRIDE_SET` / `QUOTA_OVERRIDE_CLEARED`. */
  QUOTA_OVERRIDE_CHANGED: 'user.quota_override_changed',
  /** → `ACCOUNT_DELETION_REQUESTED`; also the retention module's cue to purge. */
  DELETION_REQUESTED: 'user.deletion_requested',
  /** → `USER_PROFILE_UPDATED`. */
  PROFILE_UPDATED: 'user.profile_updated',
} as const;

export type UserEventName = (typeof USER_EVENTS)[keyof typeof USER_EVENTS];

/** Fields every user event carries. */
interface UserEventBase {
  readonly userId: string;
  /** The admin who performed it, or the account itself for a self-service change. */
  readonly actorId: string;
  readonly occurredAt: Date;
}

export interface UserRoleChangedEvent extends UserEventBase {
  readonly from: Role;
  readonly to: Role;
  readonly sessionsRevoked: number;
}

export interface UserStatusChangedEvent extends UserEventBase {
  readonly from: UserStatus;
  readonly to: UserStatus;
  /** Required by A-19 on suspension; null for every other transition. */
  readonly reason: string | null;
  readonly sessionsRevoked: number;
}

export interface UserQuotaOverrideChangedEvent extends UserEventBase {
  readonly from: number | null;
  readonly to: number | null;
}

export interface UserDeletionRequestedEvent extends UserEventBase {
  /** The `deletion_log` row the retention module completes (A-20, §9.3). */
  readonly deletionLogId: string;
  readonly requestedAt: Date;
  /** When the purge must have completed by — `DELETION_SLA_HOURS` after the request. */
  readonly dueBy: Date;
  readonly sessionsRevoked: number;
}

export interface UserProfileUpdatedEvent extends UserEventBase {
  /** Names of the columns that actually changed. Never the values (E-12). */
  readonly changedFields: readonly string[];
}
