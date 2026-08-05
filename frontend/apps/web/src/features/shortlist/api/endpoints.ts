import { apiClient } from '@repo/api-client';

import type {
  ReorderShortlistBody,
  ShortlistItem,
  ShortlistResponse,
  UpdateShortlistItemBody,
} from '@/features/shortlist/api/types';

/** Shortlist calls — ARCHITECTURE §5.13. Reads have server twins in `./server`. */

export const shortlistPaths = {
  list: '/shortlist',
  item: (itemId: string): string => `/shortlist/${encodeURIComponent(itemId)}`,
  reorder: '/shortlist/reorder',
} as const;

export async function getShortlist(signal?: AbortSignal): Promise<ShortlistResponse> {
  const response = await apiClient.get<ShortlistResponse>(shortlistPaths.list, { signal });
  return response.data;
}

/** Answers with the whole re-ranked list, so the caller replaces rather than reconciles. */
export async function reorderShortlist(body: ReorderShortlistBody): Promise<ShortlistResponse> {
  const response = await apiClient.post<ShortlistResponse>(shortlistPaths.reorder, body);
  return response.data;
}

export async function updateShortlistItem(
  itemId: string,
  body: UpdateShortlistItemBody,
): Promise<ShortlistItem> {
  const response = await apiClient.patch<ShortlistItem>(shortlistPaths.item(itemId), body);
  return response.data;
}

/**
 * `204 No Content`. Removing is not rejecting: no reason is recorded and nothing reaches the
 * A-38 rollup, which is why this is a separate call from setting `NOT_FOR_ME`.
 */
export async function removeShortlistItem(itemId: string): Promise<void> {
  await apiClient.delete<void>(shortlistPaths.item(itemId));
}
