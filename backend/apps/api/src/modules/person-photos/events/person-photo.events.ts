/**
 * Domain events emitted by `person-photos` — `domain.action` (§2.2).
 *
 * ### Why this module announces a removal instead of asking for one
 *
 * C-16 says a replaced or removed photograph "retires its cache entries". The rows are
 * in `tryon_cache`, which §4.33 gives to `TryOnModule`, so the earlier design here was
 * a `TRYON_CACHE_RETIREMENT` port that `TryOnModule` bound. That direction cannot work:
 * `TryOnModule` imports `PersonPhotosModule` (it needs `resolveGenerationPhoto` for
 * guard-chain step 11), so a binding exported by `TryOnModule` is not visible in
 * `PersonPhotosService`'s injector, and reversing the import would be a module cycle.
 *
 * It also asked the wrong question. Retirement is **not** a correctness requirement.
 * The §3.7 key is `sha256(garmentSourceHash:personPhotoHash:TRYON_API_VERSION)`, so a
 * try-on against a different photograph derives a different key and *cannot* hit a
 * render made from the old one — "generates afresh against the new photo" is a property
 * of the key, not of the cleanup. Retirement is storage hygiene: it stops rows
 * accumulating that describe bytes no consumer holds any more. Hygiene may be eventual,
 * and eventual work is an event, not a synchronous dependency.
 *
 * So deleting a photograph no longer needs to know that a cache exists. It states what
 * happened; `TryOnModule` decides that this concerns it.
 *
 * Emitted **after** `commitTransaction()`, never inside the work callback (§2.9
 * rule 3) — a listener that fires on a transaction which later rolls back would retire
 * cache entries for a photograph that still exists.
 */
export const PERSON_PHOTO_EVENTS = {
  /**
   * A consumer's photograph and its objects are gone (C-16, C-38).
   *
   * Emitted once per deletion, after the row, the objects and the `deletion_log` entry
   * have committed. Renders produced from it are untouched and stay in her history
   * (C-28) — no listener of this event may reach `tryon_results`.
   */
  REMOVED: 'person_photo.removed',
} as const;

export type PersonPhotoEventName = (typeof PERSON_PHOTO_EVENTS)[keyof typeof PERSON_PHOTO_EVENTS];

/** The payload carried by {@link PERSON_PHOTO_EVENTS.REMOVED}. */
export interface PersonPhotoRemovedEvent {
  readonly userId: string;
  readonly photoId: string;
  /**
   * The sha256 of the removed bytes — the `personPhotoHash` half of the §3.7 cache key,
   * and the only handle that identifies every cache row the photograph could have
   * produced. The cache is global across users, so two consumers who uploaded
   * byte-identical photographs share rows; `IDX_tryon_cache_personPhotoHash` (§4.19)
   * exists for precisely this lookup.
   *
   * Not a storage key and not a URL — nothing here may be used to read her photograph,
   * and nothing here is safe to log (E-12).
   */
  readonly personPhotoHash: string;
  /** True when she deleted the photo she was generating against — a replacement (C-16). */
  readonly wasActive: boolean;
  readonly occurredAt: Date;
}
