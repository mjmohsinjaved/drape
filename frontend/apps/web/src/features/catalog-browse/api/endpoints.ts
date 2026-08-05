import 'server-only';

import { cache } from 'react';

import { serverGet, type ServerResult } from '@/lib/server-api';

import type {
  CatalogFacets,
  CatalogGarmentDetail,
  CatalogGarmentSummary,
  CatalogQuery,
  PublicCategory,
} from '@/features/catalog-browse/api/types';

/**
 * Public browse reads — ARCHITECTURE §5.8, §6.4, B-9.
 *
 * **The grid is server-rendered** (§9.1: first contentful paint on 4G under 2.5s). These run
 * inside Server Components through the cookie-forwarding client, so the first paint carries the
 * cards themselves rather than a skeleton waiting on a client fetch. The filter bar is a client
 * island that only writes the query string; the server re-renders the grid from it.
 *
 * There is no browser-side catalog fetch and no proxy route handler (B-9).
 *
 * ═══ `cache()` on the two reads a route makes twice ═══
 *
 * `generateMetadata` and the page body run in the same request and both need the garment (for
 * the social card, and for the screen) or the category tree (for the title, and for the id the
 * grid filters by). Without `cache()` that is two identical round trips to the API on the two
 * routes §9.1 puts a number on — first contentful paint on 4G under 2.5s — and the second one
 * is pure latency added before the first byte.
 *
 * React's `cache()` is per-request, so it deduplicates within one render and never leaks a
 * response between two visitors — which matters because these calls forward the incoming
 * cookie. `getCurrentUser` in `lib/session.ts` is memoised for exactly the same reason.
 *
 * `getCatalogGarments` and `getCatalogFacets` are deliberately *not* cached: each is called once
 * per render, and the garment query varies by filter, so a cache would only add bookkeeping.
 */

export const catalogPaths = {
  garments: '/catalog/garments',
  garment: (slugOrId: string): string => `/catalog/garments/${encodeURIComponent(slugOrId)}`,
  filters: '/catalog/filters',
  newArrivals: '/catalog/new-arrivals',
  categories: '/categories',
} as const;

/** Drops empty values so an unset filter never reaches the API as `?color=`. */
function toParams(query: CatalogQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params[key] = value as string | number;
  }
  return params;
}

export async function getCatalogGarments(
  query: CatalogQuery,
): Promise<ServerResult<CatalogGarmentSummary[]>> {
  return serverGet<CatalogGarmentSummary[]>(catalogPaths.garments, { params: toParams(query) });
}

/** Read twice per garment route — `generateMetadata` and the screen. Memoised per request. */
export const getCatalogGarment = cache(
  async (slugOrId: string): Promise<ServerResult<CatalogGarmentDetail>> =>
    serverGet<CatalogGarmentDetail>(catalogPaths.garment(slugOrId)),
);

export async function getCatalogFacets(): Promise<ServerResult<CatalogFacets>> {
  return serverGet<CatalogFacets>(catalogPaths.filters);
}

/** Read twice per category route — `generateMetadata` and the page. Memoised per request. */
export const getPublicCategories = cache(
  async (): Promise<ServerResult<PublicCategory[]>> =>
    serverGet<PublicCategory[]>(catalogPaths.categories),
);

/**
 * Resolves a `[categorySlug]` segment to the id the catalog query needs. The category routes are
 * slug-addressed so a link is readable and shareable; the API filters by id.
 *
 * Cached too, so the metadata call and the page call share one traversal as well as one fetch.
 */
export const findCategoryBySlug = cache(async (slug: string): Promise<PublicCategory | null> => {
  const result = await getPublicCategories();
  if (!result.ok) return null;

  for (const category of result.data) {
    if (category.slug === slug) return category;
    const child = category.children.find((candidate) => candidate.slug === slug);
    if (child) return child;
  }
  return null;
});
