'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { STALE_TIMES, queryKeys, type ApiError } from '@repo/api-client';

import { getMyQuota } from '@/features/tryon/api/endpoints';

import type { MyQuota } from '@/features/tryon/api/types';

/**
 * The persistent counter — PRD C-5.
 *
 * > "Try-ons left this month" is visible wherever a try-on can be started.
 *
 * `GET /quota/me` had no call site at all, so the counter the copy was written for
 * (`tryon.quota.label`, `.remaining`, `.resets`, `.lowWarning` — all present in both locales,
 * none of them rendered) never appeared. Every path that spends or refunds an allowance already
 * invalidates `queryKeys.quota.me()`; nothing was listening on the other end.
 *
 * `staleTime: STALE_TIMES.quotaMe` is zero, deliberately: the number changes on every charged
 * generation (§6.4), so it is refetched rather than guessed at. It is never used to decide
 * whether she may start a try-on — the API's guard chain is the authority (B-2, S-3) — only to
 * tell her where she stands before she taps.
 *
 * @param enabled False for a signed-out visitor. Browsing is public (C-1) and an anonymous
 *   `GET /quota/me` would answer `AUTH_REQUIRED` on every catalog page.
 */
export function useMyQuota(enabled: boolean): UseQueryResult<MyQuota, ApiError> {
  return useQuery<MyQuota, ApiError>({
    queryKey: queryKeys.quota.me(),
    queryFn: ({ signal }) => getMyQuota(signal),
    staleTime: STALE_TIMES.quotaMe,
    enabled,
  });
}
