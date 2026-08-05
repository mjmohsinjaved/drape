import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import {
  PERSON_PHOTO_EVENTS,
  type PersonPhotoRemovedEvent,
} from '@api/modules/person-photos/events/person-photo.events';

import { TryOnCacheService } from '../services/tryon-cache.service';

/**
 * **PRD C-16 — retiring the cache entries of a photograph that no longer exists.**
 *
 * ### Why a listener and not a port
 *
 * `tryon_cache` belongs to this module (§4.33), so `person-photos` cannot delete from
 * it. The obvious answer — a `TRYON_CACHE_RETIREMENT` token declared over there and
 * bound here — is the answer this codebase had, and it never worked: `TryOnModule`
 * imports `PersonPhotosModule` for guard-chain step 11, and Nest resolves a provider
 * through the *importing* module's injector, not the other way round. The token was
 * always absent where it was injected, so C-16 no-opped behind an `@Optional()` and a
 * `warn` on every deletion.
 *
 * Reversing the import would be a cycle (`import/no-cycle` is an error here), and
 * `forwardRef` would only hide it. The direction is not the real problem, though — the
 * *coupling* is. Ask what actually has to be true:
 *
 * > `cacheKey = sha256(garmentSourceHash:personPhotoHash:TRYON_API_VERSION)` (§3.7)
 *
 * The photograph's hash is *in the key*. A try-on run against a different photograph
 * derives a different key and therefore cannot hit a render built from the old one —
 * C-16's promise that "a future try-on of the same garment generates afresh against
 * the new photo" is a property of the key derivation and holds even if nothing is ever
 * retired. Retirement is **storage hygiene**, not correctness: it stops rows piling up
 * that describe bytes nobody holds any more. Hygiene is allowed to be eventual, and
 * eventual work behind a domain event is what this file is.
 *
 * The one case that looks like it complicates this: she deletes a photograph and later
 * re-uploads the byte-identical file. The sha256 is the same, so the key is the same,
 * so a try-on of the same garment serves the old render. If the rows were still there
 * she gets a hit and pays nothing; if this listener had swept them she pays a
 * generation for a pixel-identical result. Same bytes in, same bytes out — that is
 * exactly the C-22 case ("re-running the same garment on the same photo serves from
 * cache and consumes no quota"), so the surviving row is *right*, not a leak. It is
 * also the reason retirement must never be treated as a privacy control: the
 * `tryon_cache` row holds a hash and a render key, never her photograph, and the C-38
 * privacy guarantee is discharged by `PersonPhotosService.remove()` deleting the
 * actual objects inside its transaction.
 *
 * ### What this listener must not do
 *
 *  - **Touch `tryon_results`.** C-28: a render survives deletion of its source photo.
 *  - **Delete the storage object behind `tryon_cache.storageKey`.** §3.7 makes the
 *    canonical copy the *requesting user's own render* — the very file her
 *    `tryon_results` row points at. Retiring a cache row drops a pointer, never bytes;
 *    deleting them would destroy a live render from somebody's history.
 *  - **Throw.** `EventEmitterModule` runs with `ignoreErrors: false`, so an escaping
 *    rejection from an async listener is an unhandled rejection in the process that
 *    just served a successful deletion. Failure here is logged and dropped; the next
 *    identical try-on simply serves a stale-but-valid cached render.
 */
@Injectable()
export class PersonPhotoRemovedListener {
  private readonly logger = new Logger(PersonPhotoRemovedListener.name);

  constructor(private readonly cache: TryOnCacheService) {}

  /**
   * `async: true` — the retirement goes on the microtask queue rather than into the
   * emitter's synchronous path, so a `DELETE /person-photos/:id` never waits on it.
   */
  @OnEvent(PERSON_PHOTO_EVENTS.REMOVED, { async: true })
  async onPersonPhotoRemoved(event: PersonPhotoRemovedEvent): Promise<void> {
    try {
      const retired = await this.cache.retireByPersonPhotoHash(event.personPhotoHash);

      if (retired === 0) {
        // Normal for a photograph that was never tried on — not a failure.
        this.logger.debug('A removed photo had no cache entries to retire (C-16).');
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Could not retire cache entries for a removed photo; they are stale but harmless ` +
          `— the §3.7 key means no later try-on can serve them to a different photograph. ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
