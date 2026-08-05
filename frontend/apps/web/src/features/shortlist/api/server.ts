import 'server-only';

import { shortlistPaths } from '@/features/shortlist/api/endpoints';
import { serverGet, type ServerResult } from '@/lib/server-api';


import type { ShortlistResponse } from '@/features/shortlist/api/types';

/** `GET /shortlist`, server-side (B-9). Render thumbnails are signed and short-lived (§3.4). */
export async function getShortlistServer(): Promise<ServerResult<ShortlistResponse>> {
  return serverGet<ShortlistResponse>(shortlistPaths.list);
}
