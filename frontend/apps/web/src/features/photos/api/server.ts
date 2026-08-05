import 'server-only';

import { photoPaths } from '@/features/photos/api/endpoints';
import { serverGet, type ServerResult } from '@/lib/server-api';


import type { PersonPhoto } from '@/features/photos/api/types';

/** Her saved photos, read server-side with the cookie forwarded (B-9, C-16). */
export async function listPhotosServer(): Promise<ServerResult<PersonPhoto[]>> {
  return serverGet<PersonPhoto[]>(photoPaths.list);
}
