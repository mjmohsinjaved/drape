import { USER_STATUSES, type AdminConsumerListQuery, type UserStatus } from '@repo/api-client';

/** §2.8 defaults `limit` to 20; the console asks for a denser page (D-4). */
export const CONSUMER_PAGE_SIZE = 25;

export const CONSUMER_SORT_PRESETS = ['newest', 'recentlyActive', 'name'] as const;
export type ConsumerSortPreset = (typeof CONSUMER_SORT_PRESETS)[number];

export interface ConsumerListState {
  search: string;
  status: UserStatus | null;
  /** Only accounts that have submitted at least one enquiry. */
  hasEnquiries: boolean;
  sort: ConsumerSortPreset;
  page: number;
}

export const DEFAULT_LIST_STATE: ConsumerListState = {
  search: '',
  status: null,
  hasEnquiries: false,
  sort: 'newest',
  page: 1,
};

/** URL parameter names, in one place so the server page and the island cannot drift. */
export const LIST_PARAMS = {
  search: 'q',
  status: 'status',
  hasEnquiries: 'enquired',
  sort: 'sort',
  page: 'page',
} as const;

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isUserStatus(value: string | undefined): value is UserStatus {
  return value !== undefined && (USER_STATUSES as readonly string[]).includes(value);
}

function isSortPreset(value: string | undefined): value is ConsumerSortPreset {
  return value !== undefined && (CONSUMER_SORT_PRESETS as readonly string[]).includes(value);
}

export function parseListState(params: RawParams | URLSearchParams): ConsumerListState {
  const read = (key: string): string | undefined =>
    params instanceof URLSearchParams ? (params.get(key) ?? undefined) : first(params[key]);

  const rawPage = Number.parseInt(read(LIST_PARAMS.page) ?? '', 10);
  const status = read(LIST_PARAMS.status);
  const sort = read(LIST_PARAMS.sort);

  return {
    search: read(LIST_PARAMS.search)?.trim() ?? '',
    status: isUserStatus(status) ? status : null,
    hasEnquiries: read(LIST_PARAMS.hasEnquiries) === 'true',
    sort: isSortPreset(sort) ? sort : DEFAULT_LIST_STATE.sort,
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
  };
}

export function serialiseListState(state: ConsumerListState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.search !== '') params.set(LIST_PARAMS.search, state.search);
  if (state.status !== null) params.set(LIST_PARAMS.status, state.status);
  if (state.hasEnquiries) params.set(LIST_PARAMS.hasEnquiries, 'true');
  if (state.sort !== DEFAULT_LIST_STATE.sort) params.set(LIST_PARAMS.sort, state.sort);
  if (state.page !== 1) params.set(LIST_PARAMS.page, String(state.page));
  return params;
}

interface SortMapping {
  sortBy: NonNullable<AdminConsumerListQuery['sortBy']>;
  sortOrder: 'ASC' | 'DESC';
}

export const SORT_MAPPING: Readonly<Record<ConsumerSortPreset, SortMapping>> = {
  newest: { sortBy: 'createdAt', sortOrder: 'DESC' },
  recentlyActive: { sortBy: 'lastActiveAt', sortOrder: 'DESC' },
  name: { sortBy: 'name', sortOrder: 'ASC' },
};

export function toApiQuery(state: ConsumerListState): AdminConsumerListQuery {
  const { sortBy, sortOrder } = SORT_MAPPING[state.sort];

  return {
    page: state.page,
    limit: CONSUMER_PAGE_SIZE,
    sortBy,
    sortOrder,
    ...(state.search === '' ? {} : { search: state.search }),
    ...(state.status === null ? {} : { status: state.status }),
    ...(state.hasEnquiries ? { hasEnquiries: true } : {}),
  };
}

export function toServerParams(
  state: ConsumerListState,
): Record<string, string | number | boolean | undefined> {
  const query = toApiQuery(state);

  return {
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    search: query.search,
    status: query.status,
    hasEnquiries: query.hasEnquiries,
  };
}

export function isUnfiltered(state: ConsumerListState): boolean {
  return state.search === '' && state.status === null && !state.hasEnquiries;
}
export function listStateKey(state: ConsumerListState): string {
  return serialiseListState(state).toString();
}
