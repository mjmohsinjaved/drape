/**
 * ARCHITECTURE.md §5.8 `catalog` — the public browse projection.
 *
 * Two invariants shape every type here:
 * - E-10: no garment lacking an approved test render is ever returned by any route in this group.
 * - A-30: prices are omitted from every response when `catalog.showPricesPublicly` is false, which
 *   is why `price` is `number | null` rather than `number`.
 */

import type { IsoDateTime, PaginationQuery, Uuid } from './common';
import type { EmbellishmentWeight, GarmentMode } from './enums';

/** One card in the browse grid — `GET /catalog/garments` (PUBLIC), C-1/C-17. */
export interface CatalogGarmentCard {
  id: Uuid;
  slug: string;
  title: string;
  titleUr: string | null;
  categoryId: Uuid;
  categoryName: string;
  /** Null when `catalog.showPricesPublicly` is false (A-30). */
  price: number | null;
  currency: string;
  mode: GarmentMode;
  colors: string[];
  embellishmentWeight: EmbellishmentWeight;
  sizes: string[];
  /** Signed URL (§3.4) for the gallery-leading thumbnail. */
  thumbnailUrl: string;
  /** D-20 alt text. */
  thumbnailAlt: string | null;
  tryOnCount: number;
  publishedAt: IsoDateTime;
}

/** `GET /catalog/garments/:slugOrId` (PUBLIC) — the detail view of C-18. */
export interface CatalogGarmentDetail extends CatalogGarmentCard {
  description: string | null;
  descriptionUr: string | null;
  fabric: string | null;
  styleTags: string[];
  /** Null when prices are hidden, or when the garment is not a rental. */
  deposit: number | null;
  gallery: CatalogGarmentImage[];
}

export interface CatalogGarmentImage {
  id: Uuid;
  url: string;
  thumbnailUrl: string | null;
  altText: string | null;
  width: number;
  height: number;
  position: number;
}

export const CATALOG_SORTS = ['newest', 'mostTried', 'priceAsc', 'priceDesc'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

/**
 * `GET /catalog/garments` query (C-1, C-17). Mirrored to the URL query string, which is the
 * source of truth for sharing — the filters store only reflects it.
 */
export interface CatalogFilters extends PaginationQuery {
  categoryId?: Uuid;
  /** Repeatable; serialised as a comma-separated list. */
  color?: string[];
  priceMin?: number;
  priceMax?: number;
  embellishmentWeight?: EmbellishmentWeight[];
  size?: string[];
  mode?: GarmentMode;
  search?: string;
  sort?: CatalogSort;
}

/**
 * `GET /catalog/filters` (PUBLIC) — available facets **with counts, so the UI never offers an
 * empty filter**. Every count is computed against the currently published, test-rendered set.
 */
export interface CatalogFacets {
  categories: CatalogFacetValue[];
  colors: CatalogFacetValue[];
  sizes: CatalogFacetValue[];
  embellishmentWeights: CatalogFacetValue[];
  modes: CatalogFacetValue[];
  /** Absent when `catalog.showPricesPublicly` is false (A-30). */
  priceRange: CatalogPriceRange | null;
}

export interface CatalogFacetValue {
  value: string;
  /** Display label already resolved for the requested locale where one exists (category names). */
  label: string;
  count: number;
}

export interface CatalogPriceRange {
  min: number;
  max: number;
  currency: string;
}

/**
 * `GET /catalog/new-arrivals` (PUBLIC) — recently published, optionally scoped to her
 * `preferredCategories` when a consumer session is present (C-8).
 */
export interface NewArrivalsQuery {
  limit?: number;
  /** Server-side default is true for a signed-in consumer, and ignored for an anonymous visitor. */
  scopeToPreferredCategories?: boolean;
}
