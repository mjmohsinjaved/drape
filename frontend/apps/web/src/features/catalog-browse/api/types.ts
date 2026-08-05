/**
 * The public browse contract — ARCHITECTURE §5.8, PRD C-1, C-17, C-18.
 *
 * These mirror the **real** `PublicGarment*` / `CatalogFilters*` / `PublicCategory*` DTOs on the
 * API, which differ from the sketch in `@repo/api-client/types/catalog` in several places:
 * the card carries a nested `primaryImage` rather than a flat `thumbnailUrl`, the detail
 * gallery is `images` not `gallery`, `currency` and `categoryName` are nullable, `deposit` is on
 * the summary, and the `color` / `size` / `embellishmentWeight` filters are **single scalars**
 * rather than arrays. Typing against the sketch would compile and then render blanks, so this
 * file is written against the controller and its DTOs.
 *
 * Report the drift; do not paper over it here — `packages/**` belongs to another workstream.
 */

/** A gallery image. Note there are no `width` / `height` — the UI supplies a fixed ratio box. */
export interface CatalogImage {
  url: string;
  thumbnailUrl: string | null;
  altText: string | null;
  position: number;
}

export type EmbellishmentWeight = 'LIGHT' | 'MEDIUM' | 'HEAVY';
export type GarmentMode = 'SALE' | 'RENTAL';

/** One card in the grid — `GET /catalog/garments` (PUBLIC). */
export interface CatalogGarmentSummary {
  id: string;
  slug: string;
  title: string;
  titleUr: string | null;
  categoryId: string;
  categoryName: string | null;
  categorySlug: string | null;
  colors: string[];
  embellishmentWeight: EmbellishmentWeight;
  sizes: string[];
  mode: GarmentMode;
  /** Null whenever `catalog.showPricesPublicly` is off (A-30) — never rendered as zero. */
  price: number | null;
  currency: string | null;
  deposit: number | null;
  primaryImage: CatalogImage | null;
  publishedAt: string | null;
}

/** `GET /catalog/garments/:slugOrId` (PUBLIC) — the C-18 detail view. */
export interface CatalogGarmentDetail extends CatalogGarmentSummary {
  fabric: string | null;
  description: string | null;
  descriptionUr: string | null;
  styleTags: string[];
  images: CatalogImage[];
}

export interface CatalogFacet {
  value: string;
  label: string | null;
  count: number;
}

export interface CatalogPriceRange {
  min: number;
  max: number;
  currency: string;
}

/** `GET /catalog/filters` — facets **with counts, so the UI never offers an empty filter**. */
export interface CatalogFacets {
  colors: CatalogFacet[];
  sizes: CatalogFacet[];
  embellishmentWeights: CatalogFacet[];
  modes: CatalogFacet[];
  /** `value` is the category id. */
  categories: CatalogFacet[];
  /** Null while prices are hidden (A-30). */
  priceRange: CatalogPriceRange | null;
}

export const CATALOG_SORTS = ['newest', 'mostTried', 'priceAsc', 'priceDesc'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

/** Exactly the query `CatalogQueryDto` accepts. Scalars, not arrays. */
export interface CatalogQuery {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  color?: string;
  size?: string;
  embellishmentWeight?: EmbellishmentWeight;
  mode?: GarmentMode;
  priceMin?: number;
  priceMax?: number;
  sortBy?: CatalogSort;
}

/** `GET /categories` (PUBLIC) — the browse taxonomy, one level deep (A-5, A-6). */
export interface PublicCategory {
  id: string;
  name: string;
  nameUr: string | null;
  slug: string;
  coverImageUrl: string | null;
  position: number;
  children: PublicCategory[];
}
