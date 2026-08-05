/**
 * The A-14 catalog list query, in the URL.
 *
 * The URL is the state: a filtered view is linkable, survives a reload, and lets the Server
 * Component fetch exactly what the client will ask for so the first paint is the real table.
 * One parser is shared by both sides — a server page and a client island disagreeing about what
 * `?sort=mostTried` means is a bug that only shows up as a flash of the wrong rows.
 *
 * The three A-14 sorts are presented by name and translated to the API's own `sortBy` /
 * `sortOrder` pair here, because `GarmentQueryDto` takes column names, not sort names.
 */

import { PUBLISH_STATES, type PublishState, type Uuid } from '@repo/api-client';

import {
  GARMENT_SORT_PRESETS,
  type AdminGarmentQuery,
  type GarmentSortKey,
  type GarmentSortPreset,
} from '@/features/catalog/types/admin-catalog';

/** §2.8 defaults `limit` to 20; the console asks for a denser page (D-4). */
export const CATALOG_PAGE_SIZE = 25;

export interface CatalogListState {
  search: string;
  categoryId: Uuid | null;
  publishState: PublishState | null;
  sort: GarmentSortPreset;
  page: number;
}

export const DEFAULT_LIST_STATE: CatalogListState = {
  search: '',
  categoryId: null,
  publishState: null,
  sort: 'newest',
  page: 1,
};

/** URL parameter names, in one place so the server page and the island cannot drift. */
export const LIST_PARAMS = {
  search: 'q',
  category: 'category',
  state: 'state',
  sort: 'sort',
  page: 'page',
} as const;

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isPublishState(value: string | undefined): value is PublishState {
  return value !== undefined && (PUBLISH_STATES as readonly string[]).includes(value);
}

function isSortPreset(value: string | undefined): value is GarmentSortPreset {
  return value !== undefined && (GARMENT_SORT_PRESETS as readonly string[]).includes(value);
}

/** Anything unrecognised falls back to the default rather than being sent to the API. */
export function parseListState(params: RawParams | URLSearchParams): CatalogListState {
  const read = (key: string): string | undefined =>
    params instanceof URLSearchParams ? (params.get(key) ?? undefined) : first(params[key]);

  const rawPage = Number.parseInt(read(LIST_PARAMS.page) ?? '', 10);
  const state = read(LIST_PARAMS.state);
  const sort = read(LIST_PARAMS.sort);
  const categoryId = read(LIST_PARAMS.category);

  return {
    search: read(LIST_PARAMS.search)?.trim() ?? '',
    categoryId: categoryId !== undefined && categoryId !== '' ? categoryId : null,
    publishState: isPublishState(state) ? state : null,
    sort: isSortPreset(sort) ? sort : DEFAULT_LIST_STATE.sort,
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
  };
}

/** Only what differs from the default is written, so a clean view has a clean URL. */
export function serialiseListState(state: CatalogListState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.search !== '') params.set(LIST_PARAMS.search, state.search);
  if (state.categoryId !== null) params.set(LIST_PARAMS.category, state.categoryId);
  if (state.publishState !== null) params.set(LIST_PARAMS.state, state.publishState);
  if (state.sort !== DEFAULT_LIST_STATE.sort) params.set(LIST_PARAMS.sort, state.sort);
  if (state.page !== 1) params.set(LIST_PARAMS.page, String(state.page));
  return params;
}

interface SortMapping {
  sortBy: GarmentSortKey;
  sortOrder: 'ASC' | 'DESC';
}

/**
 * A-14's three sorts, mapped to the API's allow-list.
 *
 * `starRate` is the love share of all verdicts cast and is `null` until the first verdict, which
 * is why "highest star rate" is a distinct sort rather than a column the table can order itself.
 */
export const SORT_MAPPING: Readonly<Record<GarmentSortPreset, SortMapping>> = {
  newest: { sortBy: 'createdAt', sortOrder: 'DESC' },
  mostTried: { sortBy: 'tryOnCount', sortOrder: 'DESC' },
  highestStarRate: { sortBy: 'starRate', sortOrder: 'DESC' },
};

export function toApiQuery(state: CatalogListState): AdminGarmentQuery {
  const { sortBy, sortOrder } = SORT_MAPPING[state.sort];

  return {
    page: state.page,
    limit: CATALOG_PAGE_SIZE,
    sortBy,
    sortOrder,
    ...(state.search === '' ? {} : { search: state.search }),
    ...(state.categoryId === null ? {} : { categoryId: state.categoryId }),
    ...(state.publishState === null ? {} : { publishState: state.publishState }),
  };
}

/**
 * The same query, flattened for `serverGet`, which takes a plain record of scalars.
 *
 * Spelled out rather than spread so the two callers cannot drift and so TypeScript checks each
 * value against what the API's `GarmentQueryDto` will accept.
 */
export function toServerParams(
  state: CatalogListState,
): Record<string, string | number | boolean | undefined> {
  const query = toApiQuery(state);

  return {
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    search: query.search,
    categoryId: query.categoryId,
    publishState: query.publishState,
  };
}

/** True when nothing is filtering the list — the difference between "empty" and "no matches". */
export function isUnfiltered(state: CatalogListState): boolean {
  return state.search === '' && state.categoryId === null && state.publishState === null;
}
