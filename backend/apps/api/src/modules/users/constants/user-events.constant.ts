import type { Role, UserStatus } from '@library/common';

export const USER_EVENTS = {
  ROLE_CHANGED: 'user.role_changed',
  DEACTIVATED: 'user.deactivated',
  REACTIVATED: 'user.reactivated',
  APPROVED: 'user.approved',
  SUSPENDED: 'user.suspended',
  UNSUSPENDED: 'user.unsuspended',
  QUOTA_OVERRIDE_CHANGED: 'user.quota_override_changed',
  DELETION_REQUESTED: 'user.deletion_requested',
  PROFILE_UPDATED: 'user.profile_updated',
} as const;

export type UserEventName = (typeof USER_EVENTS)[keyof typeof USER_EVENTS];

interface UserEventBase {
  readonly userId: string;
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
  readonly reason: string | null;
  readonly sessionsRevoked: number;
}

export interface UserQuotaOverrideChangedEvent extends UserEventBase {
  readonly from: number | null;
  readonly to: number | null;
}

export interface UserDeletionRequestedEvent extends UserEventBase {
  readonly deletionLogId: string;
  readonly requestedAt: Date;
  readonly dueBy: Date;
  readonly sessionsRevoked: number;
}

export interface UserProfileUpdatedEvent extends UserEventBase {
  readonly changedFields: readonly string[];
}
