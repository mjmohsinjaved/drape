'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';

import { queryKeys, type ApiError, type PublishState } from '@repo/api-client';

import { listGarments } from '@/features/catalog/api/endpoints';
import {
  DEFAULT_QUALITY_MIN_SCORE,
  ELEVATED_FAILURE_COUNT,
  STALE_TRY_ON_DAYS,
  type AdminGarment,
  type CatalogHealth,
} from '@/features/catalog/types/admin-catalog';

/**
 * A-15 — the catalog health panel.
 *
 * **`GET /admin/catalog-health` does not exist.** ARCHITECTURE §5.6 lists it, but there is no
 * catalog-health controller, service or DTO anywhere in `apps/api`, and `POST
 * /admin/garments/bulk/estimate` is missing from the same table for the same reason (the A-12
 * estimate lives on the try-on module instead, and that one is real).
 *
 * So the panel is composed here from the list endpoint, which already carries every field A-15
 * asks about — `testRenderState`, `qualityScore`, `failureCount`, `flaggedForReview`,
 * `tryOnCount`, `lastTriedAt`. Two sweeps, drafts and published, each bounded at
 * {@link MAX_HEALTH_PAGES} pages of {@link HEALTH_PAGE_SIZE}. When a sweep hits the ceiling the
 * screen says so rather than quietly reporting a partial count as a total — a health panel that
 * under-reports is worse than no health panel.
 *
 * Replacing this with the real route is a change to `queryFn` and nothing above it.
 */

/** §2.8 caps `limit` at 100. */
export const HEALTH_PAGE_SIZE = 100;

/** Three pages per publish state. Beyond that the answer is "look at the catalog list". */
export const MAX_HEALTH_PAGES = 3;

export interface CatalogHealthResult extends CatalogHealth {
  /** True when a sweep hit the page ceiling, so the counts are a floor rather than a total. */
  truncated: boolean;
  /** How many garment records the panel actually inspected. */
  inspected: number;
}

async function sweep(
  publishState: PublishState,
  signal: AbortSignal | undefined,
): Promise<{ items: AdminGarment[]; truncated: boolean }> {
  const items: AdminGarment[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= Math.min(totalPages, MAX_HEALTH_PAGES)) {
    const result = await listGarments(
      { page, limit: HEALTH_PAGE_SIZE, publishState, sortBy: 'updatedAt', sortOrder: 'DESC' },
      signal,
    );
    items.push(...result.items);
    totalPages = result.meta.totalPages;
    page += 1;
  }

  return { items, truncated: totalPages > MAX_HEALTH_PAGES };
}

function daysSince(iso: string | null): number | null {
  if (iso === null) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / 86_400_000;
}

/** Pure, so the grouping rules are testable without a network. */
export function groupCatalogHealth(garments: readonly AdminGarment[]): CatalogHealth {
  const missingTestRender = garments.filter(
    (garment) => garment.testRenderState !== 'APPROVED' && garment.publishState !== 'ARCHIVED',
  );

  const lowQualityScore = garments.filter(
    (garment) => garment.qualityScore !== null && garment.qualityScore < DEFAULT_QUALITY_MIN_SCORE,
  );

  const elevatedFailureRate = garments.filter(
    (garment) => garment.flaggedForReview || garment.failureCount >= ELEVATED_FAILURE_COUNT,
  );

  const zeroTryOnsIn30Days = garments.filter((garment) => {
    if (garment.publishState !== 'PUBLISHED') return false;
    if (garment.tryOnCount === 0) {
      const age = daysSince(garment.publishedAt);
      // A piece published yesterday with no try-ons is not a problem yet.
      return age !== null && age >= STALE_TRY_ON_DAYS;
    }
    const idle = daysSince(garment.lastTriedAt);
    return idle !== null && idle >= STALE_TRY_ON_DAYS;
  });

  return {
    missingTestRender: { items: missingTestRender, total: missingTestRender.length },
    lowQualityScore: { items: lowQualityScore, total: lowQualityScore.length },
    elevatedFailureRate: { items: elevatedFailureRate, total: elevatedFailureRate.length },
    zeroTryOnsIn30Days: { items: zeroTryOnsIn30Days, total: zeroTryOnsIn30Days.length },
  };
}

export function useCatalogHealth(): UseQueryResult<CatalogHealthResult, ApiError> {
  return useQuery<CatalogHealthResult, ApiError>({
    queryKey: queryKeys.garments.health(),
    queryFn: async ({ signal }) => {
      const [drafts, published] = await Promise.all([
        sweep('DRAFT', signal),
        sweep('PUBLISHED', signal),
      ]);
      const all = [...drafts.items, ...published.items];

      return {
        ...groupCatalogHealth(all),
        truncated: drafts.truncated || published.truncated,
        inspected: all.length,
      };
    },
    staleTime: 5 * 60_000,
  });
}
