import { apiClient } from '@repo/api-client';

import type { RecordVerdictBody } from '@/features/renders/api/types';
import type { ShortlistItem } from '@/features/shortlist/api/types';

/**
 * History mutations — ARCHITECTURE §5.12, §5.13.
 *
 * Reads live in `./server`, because the history list and the render view are Server Components:
 * every image URL on them is signed and short-lived (§3.4), and a server render is what keeps
 * those links valid on arrival.
 */

export const renderPaths = {
  results: '/results',
  result: (resultId: string): string => `/results/${encodeURIComponent(resultId)}`,
  download: (resultId: string): string => `/results/${encodeURIComponent(resultId)}/download`,
  groupsByPhoto: '/results/groups/by-photo',
  verdict: '/shortlist',
} as const;

/**
 * Records Love it / Maybe / Not for me — C-20, C-21.
 *
 * The route is `POST /shortlist`, not `POST /results/:id/verdict` as ARCHITECTURE §5.12 lists:
 * the shortlist module owns the verdict row, so that is where the write goes.
 */
export async function recordVerdict(body: RecordVerdictBody): Promise<ShortlistItem> {
  const response = await apiClient.post<ShortlistItem>(renderPaths.verdict, body);
  return response.data;
}

/** `204 No Content`. Permanent: the file and its thumbnail are hard-deleted (C-31). */
export async function deleteResult(resultId: string): Promise<void> {
  await apiClient.delete<void>(renderPaths.result(resultId));
}

/**
 * The watermarked download (C-23).
 *
 * The route streams bytes rather than answering with a signed URL, so this cannot be an
 * `<a href>` — the request needs the session cookie and the response needs turning into a blob.
 * The object URL is revoked by the caller once the browser has taken it.
 */
export async function downloadResult(resultId: string): Promise<{ url: string; filename: string }> {
  const response = await apiClient.get<Blob>(renderPaths.download(resultId), {
    responseType: 'blob',
  });

  const disposition = response.headers['content-disposition'];
  const match =
    typeof disposition === 'string' ? /filename="([^"]+)"/.exec(disposition) : null;

  return {
    url: URL.createObjectURL(response.data),
    filename: match?.[1] ?? `try-on-${resultId}.png`,
  };
}
