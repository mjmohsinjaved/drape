import 'server-only';

import { cache } from 'react';

import { photoPaths } from '@/features/photos/api/endpoints';
import { serverGet, type ServerResult } from '@/lib/server-api';


import type { PersonPhoto } from '@/features/photos/api/types';

/**
 * Her saved photos, read server-side with the cookie forwarded (B-9, C-16).
 *
 * Memoised per request so `/photos/new` can start this read next to the consent check rather
 * than behind it — the two answer unrelated questions, and the page used to await one before
 * beginning the other. `cache()` is per-request, so nothing crosses between visitors.
 */
export const listPhotosServer = cache(
  async (): Promise<ServerResult<PersonPhoto[]>> => serverGet<PersonPhoto[]>(photoPaths.list),
);
