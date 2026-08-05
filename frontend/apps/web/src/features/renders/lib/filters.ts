import type { ResultListItem, Verdict } from '@/features/renders/api/types';
import type { ShortlistItem } from '@/features/shortlist/api/types';

/**
 * History filtering — PRD C-25, C-30.
 *
 * > "Filterable by verdict and category, searchable by garment name."
 *
 * Search and the photo filter are the API's (`ResultQueryDto` takes `search` and
 * `personPhotoId`). **Verdict and category are not**: `GET /results` renders exclusively from
 * the `tryon_results` snapshot columns so an entry survives the garment being removed, and
 * neither a live category join nor the verdict — which lives on `shortlist_items` — is available
 * to it.
 *
 * So both are applied here, over the page the API returned, and the category options are derived
 * from the same page. The consequence is honest and worth stating: on a long history the verdict
 * and category filters narrow the current page rather than the whole archive. The fix belongs in
 * `GET /results`, not in a second round of client-side paging.
 */

export const HISTORY_PARAMS = {
  search: 'q',
  verdict: 'verdict',
  category: 'category',
  photo: 'photo',
  group: 'group',
  page: 'page',
} as const;

/** Larger than the browse grid: history rows are short, and a bigger page makes the
 *  client-side verdict and category filters cover more of the archive. */
export const HISTORY_PAGE_SIZE = 48;

const VERDICTS: readonly Verdict[] = ['LOVE_IT', 'MAYBE', 'NOT_FOR_ME'];

/** The extra option the verdict filter offers, since a render starts with no verdict at all. */
export const NO_VERDICT = 'NONE' as const;

export type VerdictFilter = Verdict | typeof NO_VERDICT;

export interface HistoryFilters {
  search?: string;
  verdict?: VerdictFilter;
  category?: string;
  photoId?: string;
  /** C-30 — group by the photo each render came from. */
  groupByPhoto: boolean;
  page: number;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

export function parseHistoryFilters(params: RawSearchParams): HistoryFilters {
  const verdict = first(params[HISTORY_PARAMS.verdict]);
  const page = Number(first(params[HISTORY_PARAMS.page]) ?? '1');

  return {
    search: first(params[HISTORY_PARAMS.search]),
    verdict:
      verdict === NO_VERDICT
        ? NO_VERDICT
        : verdict !== undefined && (VERDICTS as readonly string[]).includes(verdict)
          ? (verdict as Verdict)
          : undefined,
    category: first(params[HISTORY_PARAMS.category]),
    photoId: first(params[HISTORY_PARAMS.photo]),
    groupByPhoto: first(params[HISTORY_PARAMS.group]) === 'photo',
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
  };
}

export function toHistorySearchParams(filters: Partial<HistoryFilters>): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string | number | undefined): void => {
    if (value === undefined || value === '') return;
    params.set(key, String(value));
  };

  set(HISTORY_PARAMS.search, filters.search);
  set(HISTORY_PARAMS.verdict, filters.verdict);
  set(HISTORY_PARAMS.category, filters.category);
  set(HISTORY_PARAMS.photo, filters.photoId);
  if (filters.groupByPhoto === true) set(HISTORY_PARAMS.group, 'photo');
  if (filters.page !== undefined && filters.page > 1) set(HISTORY_PARAMS.page, filters.page);

  return params;
}

export function hasHistoryFilter(filters: HistoryFilters): boolean {
  return (
    filters.verdict !== undefined ||
    filters.category !== undefined ||
    filters.photoId !== undefined
  );
}

/**
 * `garmentId → verdict`, joined from `GET /shortlist`.
 *
 * §4.20 keeps the verdict on `shortlist_items` and the history DTO does not project it, so the
 * only way to show "what you thought" beside a render is this join. `NOT_FOR_ME` rows never
 * appear on the shortlist response, so a rejected piece reads as having no verdict — a real
 * limitation of the current API surface rather than a rendering choice.
 */
export function buildVerdictMap(items: ShortlistItem[]): Map<string, Verdict> {
  const map = new Map<string, Verdict>();
  for (const item of items) map.set(item.garmentId, item.verdict);
  return map;
}

export function applyClientFilters(
  results: ResultListItem[],
  filters: HistoryFilters,
  verdicts: Map<string, Verdict>,
): ResultListItem[] {
  return results.filter((result) => {
    if (filters.category !== undefined && result.garmentCategory !== filters.category) {
      return false;
    }

    if (filters.verdict !== undefined) {
      const verdict = result.garmentId === null ? undefined : verdicts.get(result.garmentId);
      if (filters.verdict === NO_VERDICT) return verdict === undefined;
      if (verdict !== filters.verdict) return false;
    }

    return true;
  });
}

/** Category options built from what is actually in the list, so no filter can empty it. */
export function categoryOptions(results: ResultListItem[]): string[] {
  const seen = new Set<string>();
  for (const result of results) {
    if (result.garmentCategory !== '') seen.add(result.garmentCategory);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}
