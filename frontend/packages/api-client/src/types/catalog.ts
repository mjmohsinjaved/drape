/**
 * ARCHITECTURE.md §5.8 `catalog` — the public browse projection (C-1, C-17, C-18).
 *
 * Two invariants shape every type here:
 * - E-10: no garment lacking an approved test render is ever returned by any route in this group.
 * - A-30: prices are omitted from every response when `catalog.showPricesPublicly` is false, which
 *   is why `price`, `currency` and `deposit` are nullable rather than absent — the card renders a
 *   piece with no price, never a zero.
 *
 * Written against `modules/catalog/dto/**`.
 */

import type { IsoDateTime, PaginationQuery, Uuid } from './common';
import type { EmbellishmentWeight, GarmentMode } from './enums';

/**
 * A gallery image. There is no `width` / `height` on the DTO — the grid supplies a fixed ratio
 * box, so a card cannot reflow as images land.
 */
export interface CatalogImage {
  /** Signed, expiring full-size URL (§3.4). */
  url: string;
  thumbnailUrl: string | null;
  /** D-20 alt text. */
  altText: string | null;
  position: number;
}

/**
 * One card in the grid — `GET /catalog/garments` and `GET /catalog/new-arrivals` (PUBLIC).
 *
 * The card carries a nested `primaryImage`, not a flat `thumbnailUrl`.
 */
export interface CatalogGarmentSummary {
  id: Uuid;
  slug: string;
  title: string;
  /** Urdu title (C-41). */
  titleUr: string | null;
  categoryId: Uuid;
  categoryName: string | null;
  categorySlug: string | null;
  colors: string[];
  embellishmentWeight: EmbellishmentWeight;
  sizes: string[];
  mode: GarmentMode;
  /** Null whenever `catalog.showPricesPublicly` is off (A-30) — never rendered as zero. */
  price: number | null;
  /** Null alongside a null price (A-30). */
  currency: string | null;
  /** Rental deposit. Null on a sale, and null whenever prices are hidden (A-30). */
  deposit: number | null;
  primaryImage: CatalogImage | null;
  publishedAt: IsoDateTime | null;
}

/**
 * `GET /catalog/garments/:slugOrId` (PUBLIC) — the C-18 detail view.
 *
 * The gallery field is `images`, in gallery order.
 */
export interface CatalogGarmentDetail extends CatalogGarmentSummary {
  fabric: string | null;
  description: string | null;
  /** Urdu description (C-41). */
  descriptionUr: string | null;
  /** Searchable style tags (C-17). */
  styleTags: string[];
  images: CatalogImage[];
}

export interface CatalogFacet {
  /** The value to send back as a filter. For the category facet this is the category **id**. */
  value: string;
  /** Display label where it differs from the value. */
  label: string | null;
  /** Visible garments carrying this value. */
  count: number;
}

export interface CatalogPriceRange {
  min: number;
  max: number;
  currency: string;
}

/**
 * `GET /catalog/filters` (PUBLIC) — facets **with counts, so the UI never offers an empty filter**
 * (C-17).
 */
export interface CatalogFacets {
  colors: CatalogFacet[];
  sizes: CatalogFacet[];
  embellishmentWeights: CatalogFacet[];
  /** Rental or sale. */
  modes: CatalogFacet[];
  /** Categories that currently hold a visible garment. */
  categories: CatalogFacet[];
  /** Null while `catalog.showPricesPublicly` is off (A-30). */
  priceRange: CatalogPriceRange | null;
}

export const CATALOG_SORTS = ['newest', 'mostTried', 'priceAsc', 'priceDesc'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

/**
 * Exactly the query `CatalogQueryDto` accepts.
 *
 * `color`, `size`, `embellishmentWeight` and `mode` are **single scalars**, not arrays: the API
 * takes one value per facet. Sending `?color=maroon&color=gold` fails validation.
 *
 * `sortBy` carries the four preset names directly — this is the one list route in §5 that does
 * not take a column name plus a `sortOrder`.
 */
export interface CatalogQuery extends Omit<PaginationQuery, 'sortBy'> {
  /** Search across title, category name, colour and style tags (C-17). */
  search?: string;
  /** A top-level category includes its sub-categories (A-5, C-17). */
  categoryId?: Uuid;
  color?: string;
  size?: string;
  embellishmentWeight?: EmbellishmentWeight;
  mode?: GarmentMode;
  priceMin?: number;
  priceMax?: number;
  sortBy?: CatalogSort;
}

export const DEFAULT_NEW_ARRIVALS = 12;
export const MAX_NEW_ARRIVALS = 48;

/** `GET /catalog/new-arrivals` (PUBLIC). Not paginated — a bounded list, newest first. */
export interface NewArrivalsQuery {
  /** Scope to one category and its sub-categories. */
  categoryId?: Uuid;
  /** 1 … {@link MAX_NEW_ARRIVALS}. */
  limit?: number;
}
