import 'server-only';

import { renderPaths } from '@/features/renders/api/endpoints';
import { serverGet, type ServerResult } from '@/lib/server-api';


import type { ResultGroup, ResultListItem, ResultQuery } from '@/features/renders/api/types';

/**
 * History reads (B-9).
 *
 * Server-rendered for two reasons that both matter: every image URL is signed for a few minutes
 * (§3.4), so a client-cached list would show broken images on a second visit; and §9.1 asks the
 * list to load thumbnails only, paginated, with the full render fetched on open — which is
 * easiest to hold true when the list is assembled on the server.
 */

function toParams(query: ResultQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params[key] = value as string | number;
  }
  return params;
}

export async function listResultsServer(
  query: ResultQuery,
): Promise<ServerResult<ResultListItem[]>> {
  return serverGet<ResultListItem[]>(renderPaths.results, { params: toParams(query) });
}

/** C-30 — grouped by the photo each render came from. */
export async function listResultGroupsServer(
  query: ResultQuery,
): Promise<ServerResult<ResultGroup[]>> {
  return serverGet<ResultGroup[]>(renderPaths.groupsByPhoto, { params: toParams(query) });
}

/** **Costs nothing** (C-26): no regeneration, no quota, no re-upload. */
export async function getResultServer(resultId: string): Promise<ServerResult<ResultListItem>> {
  return serverGet<ResultListItem>(renderPaths.result(resultId));
}
