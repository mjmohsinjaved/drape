import {
  CATALOG_SORTS,
  type CatalogQuery,
  type CatalogSort,
  type EmbellishmentWeight,
  type GarmentMode,
} from '@/features/catalog-browse/api/types';

/**
 * The URL query string is the source of truth for the browse filters (§6.5).
 *
 * A filtered view is a shareable link, the back button steps through filter changes, and the
 * grid stays a Server Component because the only thing the client island does is navigate. The
 * short parameter names keep a filtered URL readable at the length someone actually pastes.
 */

export const FILTER_PARAMS = {
  search: 'q',
  category: 'category',
  color: 'color',
  size: 'size',
  weight: 'weight',
  mode: 'mode',
  priceMin: 'min',
  priceMax: 'max',
  sort: 'sort',
  page: 'page',
} as const;

/** §6.2 — 2 cols @360, 3 @768, 4 @1200. Twenty-four fills four rows at the widest. */
export const CATALOG_PAGE_SIZE = 24;

const WEIGHTS: readonly EmbellishmentWeight[] = ['LIGHT', 'MEDIUM', 'HEAVY'];
const MODES: readonly GarmentMode[] = ['SALE', 'RENTAL'];

/** What a page or a client island reads. Every value already narrowed and safe to render. */
export interface BrowseFilters {
  search?: string;
  categoryId?: string;
  color?: string;
  size?: string;
  weight?: EmbellishmentWeight;
  mode?: GarmentMode;
  priceMin?: number;
  priceMax?: number;
  sort: CatalogSort;
  page: number;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function positiveNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value !== undefined && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/**
 * Narrows raw search params to the filter model. Anything unrecognised is dropped rather than
 * forwarded — a hand-typed `?sort=cheapest` renders the default order instead of a 422.
 */
export function parseBrowseFilters(params: RawSearchParams): BrowseFilters {
  const page = positiveNumber(first(params[FILTER_PARAMS.page]));

  return {
    search: first(params[FILTER_PARAMS.search]),
    categoryId: first(params[FILTER_PARAMS.category]),
    color: first(params[FILTER_PARAMS.color]),
    size: first(params[FILTER_PARAMS.size]),
    weight: oneOf(first(params[FILTER_PARAMS.weight]), WEIGHTS),
    mode: oneOf(first(params[FILTER_PARAMS.mode]), MODES),
    priceMin: positiveNumber(first(params[FILTER_PARAMS.priceMin])),
    priceMax: positiveNumber(first(params[FILTER_PARAMS.priceMax])),
    sort: oneOf(first(params[FILTER_PARAMS.sort]), CATALOG_SORTS) ?? 'newest',
    page: page !== undefined && page >= 1 ? Math.floor(page) : 1,
  };
}

/** The filter model as the API's `CatalogQueryDto` wants it. */
export function toCatalogQuery(
  filters: BrowseFilters,
  overrides: Partial<CatalogQuery> = {},
): CatalogQuery {
  return {
    page: filters.page,
    limit: CATALOG_PAGE_SIZE,
    search: filters.search,
    categoryId: filters.categoryId,
    color: filters.color,
    size: filters.size,
    embellishmentWeight: filters.weight,
    mode: filters.mode,
    priceMin: filters.priceMin,
    priceMax: filters.priceMax,
    sortBy: filters.sort,
    ...overrides,
  };
}

/** Back to a query string, dropping defaults so a pristine URL stays clean. */
export function toSearchParams(filters: Partial<BrowseFilters>): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string | number | undefined): void => {
    if (value === undefined || value === '') return;
    params.set(key, String(value));
  };

  set(FILTER_PARAMS.search, filters.search);
  set(FILTER_PARAMS.category, filters.categoryId);
  set(FILTER_PARAMS.color, filters.color);
  set(FILTER_PARAMS.size, filters.size);
  set(FILTER_PARAMS.weight, filters.weight);
  set(FILTER_PARAMS.mode, filters.mode);
  set(FILTER_PARAMS.priceMin, filters.priceMin);
  set(FILTER_PARAMS.priceMax, filters.priceMax);
  if (filters.sort !== undefined && filters.sort !== 'newest') {
    set(FILTER_PARAMS.sort, filters.sort);
  }
  if (filters.page !== undefined && filters.page > 1) set(FILTER_PARAMS.page, filters.page);

  return params;
}

/** How many filters are on, for the "Filters (3)" affordance on a phone. */
export function activeFilterCount(filters: BrowseFilters, includeCategory = true): number {
  const values = [
    filters.color,
    filters.size,
    filters.weight,
    filters.mode,
    filters.priceMin,
    filters.priceMax,
    includeCategory ? filters.categoryId : undefined,
  ];
  return values.filter((value) => value !== undefined).length;
}

export function hasAnyFilter(filters: BrowseFilters): boolean {
  return activeFilterCount(filters) > 0 || filters.search !== undefined;
}
