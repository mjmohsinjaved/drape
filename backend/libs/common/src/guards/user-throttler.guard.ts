import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';

import { ErrorCode } from '../constants/error-codes.constant';
import { AppException } from '../exceptions/app.exception';

import type { ICurrentUser } from '../interfaces/current-user.interface';

interface ThrottledRequest {
  user?: Pick<ICurrentUser, 'id'>;
  ip?: string;
  ips?: string[];
}

interface ThrottledResponse {
  header?(name: string, value: string): unknown;
  setHeader?(name: string, value: string): unknown;
}

/**
 * Per-user rate limiting — ARCHITECTURE.md §2.7, guard **2** of 4.
 *
 * Tracker is `request.user?.id ?? request.ip`: an authenticated caller is limited as
 * a person, not as an address, so a household behind one NAT is not throttled
 * collectively, and a single account cannot dodge the limit by rotating addresses.
 *
 * Note the ordering consequence: this guard runs **before** `SessionAuthGuard`, so
 * `request.user` is only populated when an earlier interceptor or a previous guard
 * set it. In the standard chain the first request of a session is tracked by IP and
 * subsequent ones may still be — which is the conservative direction, so it is
 * accepted rather than worked around by resolving the session early.
 *
 * → `RATE_LIMIT_EXCEEDED` with `details.retryAfterSeconds` and a `Retry-After`
 * header. Rejections on auth routes also append an `auth_attempts` row; that write
 * belongs to the auth module's listener, not to this guard.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  // Both overrides are declared `async` because the base class contract returns a
  // Promise. Neither has anything to await, so `require-await` is disabled here
  // rather than papered over with a needless `await Promise.resolve()`.
  /* eslint-disable @typescript-eslint/require-await */

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as ThrottledRequest;
    const userId = request.user?.id;
    if (typeof userId === 'string' && userId.length > 0) {
      return `user:${userId}`;
    }
    const forwarded =
      request.ips !== undefined && request.ips.length > 0 ? request.ips[0] : undefined;
    return `ip:${forwarded ?? request.ip ?? 'unknown'}`;
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfterSeconds = Math.max(1, Math.ceil(throttlerLimitDetail.timeToBlockExpire));

    if (context.getType<string>() === 'http') {
      const response = context.switchToHttp().getResponse<ThrottledResponse>();
      const value = String(retryAfterSeconds);
      if (typeof response.header === 'function') {
        response.header('Retry-After', value);
      } else if (typeof response.setHeader === 'function') {
        response.setHeader('Retry-After', value);
      }
    }

    throw new AppException(ErrorCode.RATE_LIMIT_EXCEEDED, {
      details: { retryAfterSeconds },
    });
  }
}
