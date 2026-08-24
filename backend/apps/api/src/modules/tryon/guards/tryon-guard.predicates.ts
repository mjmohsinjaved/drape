import { ErrorCode, Role, UserStatus, type ICurrentUser } from '@library/common';

import { ConsentStatus } from '@api/modules/consents';
import type { Garment } from '@api/modules/garments/entities/garment.entity';
import { PublishState } from '@api/modules/garments/enums/publish-state.enum';
import { PhotoModerationState } from '@api/modules/person-photos/enums/photo-moderation-state.enum';

import { JobStatus } from '../enums/job-status.enum';

import type { PersonPhotoRef } from '../ports/person-photo.port';

export interface GuardRejection {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
}

function reject(code: ErrorCode, details?: Record<string, unknown>): GuardRejection {
  return details === undefined ? { code } : { code, details };
}

export function checkSession(user: ICurrentUser | undefined): GuardRejection | null {
  if (user === undefined) {
    return reject(ErrorCode.AUTH_REQUIRED);
  }
  if (user.role !== Role.CONSUMER) {
    return reject(ErrorCode.INSUFFICIENT_ROLE);
  }
  return null;
}

export function checkAccountStatus(status: UserStatus): GuardRejection | null {
  if (status === UserStatus.PENDING_APPROVAL) {
    return reject(ErrorCode.ACCOUNT_PENDING_APPROVAL);
  }
  if (status === UserStatus.SUSPENDED) {
    return reject(ErrorCode.ACCOUNT_SUSPENDED);
  }
  if (status === UserStatus.DEACTIVATED) {
    return reject(ErrorCode.ACCOUNT_DEACTIVATED);
  }
  return null;
}

export function checkEmailVerified(
  emailVerifiedAt: Date | null,
  required: boolean,
): GuardRejection | null {
  if (!required) {
    return null;
  }
  return emailVerifiedAt === null ? reject(ErrorCode.EMAIL_NOT_VERIFIED) : null;
}

export function checkConsent(status: ConsentStatus): GuardRejection | null {
  if (status === ConsentStatus.REQUIRED) {
    return reject(ErrorCode.CONSENT_REQUIRED);
  }
  if (status === ConsentStatus.STALE) {
    return reject(ErrorCode.CONSENT_STALE);
  }
  return null;
}

export function checkQuota(remaining: number, resetsAt?: Date): GuardRejection | null {
  if (remaining > 0) {
    return null;
  }
  return reject(
    ErrorCode.QUOTA_EXHAUSTED,
    resetsAt === undefined ? { remaining } : { remaining, resetsAt: resetsAt.toISOString() },
  );
}

export interface RateWindow {
  readonly used: number;
  readonly limit: number;
  readonly retryAfterSeconds: number;
}

export function checkRateLimits(perAccount: RateWindow, perIp: RateWindow): GuardRejection | null {
  for (const [scope, window] of [
    ['ACCOUNT', perAccount],
    ['IP', perIp],
  ] as const) {
    if (window.limit > 0 && window.used >= window.limit) {
      return reject(ErrorCode.RATE_LIMIT_EXCEEDED, {
        scope,
        retryAfterSeconds: window.retryAfterSeconds,
      });
    }
  }
  return null;
}

export function checkBudget(consumed: number, hardStopAt: number): GuardRejection | null {
  if (consumed < hardStopAt) {
    return null;
  }
  return reject(ErrorCode.BUDGET_EXHAUSTED, { consumed, hardStopAt });
}

export function checkGarmentReady(garment: Garment | null): GuardRejection | null {
  if (garment === null || garment.publishState !== PublishState.PUBLISHED) {
    return reject(ErrorCode.GARMENT_NOT_PUBLISHED);
  }
  return null;
}

export function checkPhotoOwnership(
  photo: PersonPhotoRef | null,
  userId: string,
): GuardRejection | null {
  if (photo === null) {
    return reject(ErrorCode.PHOTO_NOT_FOUND);
  }
  if (photo.userId !== userId) {
    return reject(ErrorCode.PHOTO_NOT_OWNED);
  }
  if (photo.moderationState === PhotoModerationState.BLOCKED) {
    return reject(ErrorCode.PHOTO_BLOCKED_BY_MODERATION);
  }
  return null;
}

export interface ExistingJobFacts {
  readonly id: string;
  readonly status: JobStatus;
}

export function checkIdempotency(existing: ExistingJobFacts | null): GuardRejection | null {
  if (existing === null) {
    return null;
  }
  if (existing.status === JobStatus.QUEUED || existing.status === JobStatus.RUNNING) {
    return reject(ErrorCode.IDEMPOTENCY_IN_FLIGHT, { jobId: existing.id });
  }
  return null;
}

export const TRYON_GUARD_ORDER: readonly string[] = [
  'session',
  'accountStatus',
  'emailVerified',
  'consent',
  'quota',
  'rateLimits',
  'budget',
  'garment',
  'photoOwnership',
  'idempotency',
];
