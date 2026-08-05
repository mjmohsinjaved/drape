/**
 * `catalog` — ARCHITECTURE.md §5.8. Every route is `@Public()`.
 *
 * **The browse grid is server-rendered** (§9.1: first contentful paint on 4G under 2.5 s), so the
 * usual caller for these is a Server Component passing its request-scoped client, or the web app's
 * own cookie-forwarding helper using {@link catalogPaths}. There is no proxy route handler (B-9).
 */

import { get, getList, segment, type EndpointOptions } from './http';

import type {
  CatalogFacets,
  CatalogGarmentDetail,
  CatalogGarmentSummary,
  CatalogQuery,
  NewArrivalsQuery,
} from '../types/catalog';
import type { Paginated } from '../types/envelope';

export const catalogPaths = {
  garments: '/catalog/garments',
  garment: (slugOrId: string): string => `/catalog/garments/${segment(slugOrId)}`,
  filters: '/catalog/filters',
  newArrivals: '/catalog/new-arrivals',
} as const;

/** `GET /catalog/garments` (PUBLIC) — the C-17 grid. Paginated (§2.8). */
export async function listCatalogGarments(
  query: CatalogQuery = {},
  options?: EndpointOptions,
): Promise<Paginated<CatalogGarmentSummary>> {
  return getList<CatalogGarmentSummary>(catalogPaths.garments, options, query);
}

/**
 * `GET /catalog/garments/:slugOrId` (PUBLIC) — C-18.
 *
 * Slug-addressed so a link is readable and shareable; a uuid works too.
 */
export async function getCatalogGarment(
  slugOrId: string,
  options?: EndpointOptions,
): Promise<CatalogGarmentDetail> {
  return get<CatalogGarmentDetail>(catalogPaths.garment(slugOrId), options);
}

/** `GET /catalog/filters` (PUBLIC) — facets with counts, so no filter leads to an empty grid. */
export async function getCatalogFacets(options?: EndpointOptions): Promise<CatalogFacets> {
  return get<CatalogFacets>(catalogPaths.filters, options);
}

/** `GET /catalog/new-arrivals` (PUBLIC). A bounded list, newest first — not paginated. */
export async function listNewArrivals(
  query: NewArrivalsQuery = {},
  options?: EndpointOptions,
): Promise<CatalogGarmentSummary[]> {
  return get<CatalogGarmentSummary[]>(catalogPaths.newArrivals, options, query);
}
