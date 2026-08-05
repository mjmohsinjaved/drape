import type { PhotoModerationState } from '@api/modules/person-photos';

/**
 * DI token for {@link PersonPhotoPort}.
 *
 * Bound in `TryOnModule` to an adapter over `PersonPhotosService`. The token exists
 * rather than injecting that service directly so the generation path depends on the
 * two facts it needs — who owns the photo, and where its bytes are — instead of on the
 * upload, moderation and C-16 activation surface that happens to sit beside them.
 */
export const PERSON_PHOTO_PORT = Symbol('PERSON_PHOTO_PORT');

/**
 * Everything the try-on path needs about a saved photo — and nothing else.
 *
 * Deliberately **not** the entity, though `PersonPhoto` structurally satisfies it. Two
 * reasons, both S-10:
 *
 *  - the try-on path needs `storageKey` (it has to read the bytes) but nothing else in
 *    this module does, so keeping the surface this narrow makes it obvious at a glance
 *    which code can reach a consumer's photograph;
 *  - `label` is carried as a *snapshot value*, because `tryon_results` denormalises it
 *    so history survives the photo's deletion (C-28, §4.18).
 */
export interface PersonPhotoRef {
  readonly id: string;
  readonly userId: string;
  /** `person-photos/<userId>/<uuid>.<ext>`. Never logged, never serialised (E-12). */
  readonly storageKey: string;
  /** The `personPhotoHash` half of the §3.7 cache key. */
  readonly hash: string;
  /** Snapshotted onto `tryon_results.personPhotoLabelSnapshot` (C-30). */
  readonly label: string | null;
  readonly moderationState: PhotoModerationState;
  readonly mimeType: string;
}

/**
 * The seam between `tryon` and `person-photos` — guard-chain step 11, and the bytes
 * that go upstream.
 *
 * One method, because the guard chain asks one question: *which photo is this
 * generation running against, and is she allowed to use it?* `person-photos` owns the
 * answer — ownership is in its `where` clause, never inferred afterwards (§9.2) — and
 * it raises the §2.4 codes itself: `PHOTO_NOT_FOUND` when there is none,
 * `PHOTO_NOT_OWNED` (masked to `PHOTO_NOT_FOUND`) for another account's, and
 * `PHOTO_BLOCKED_BY_MODERATION` for one under review.
 *
 * `TryOnGuardService` still runs the pure `checkPhotoOwnership` predicate over the
 * returned ref. That is not distrust of the implementation so much as defence in depth
 * at the one place in the product where getting it wrong means sending one consumer's
 * photograph upstream on another's behalf — and it keeps the rule stated as something
 * E-5 can test without a database.
 *
 * Retirement is **not** here, and is no longer a port at all: `person-photos` emits
 * `PERSON_PHOTO_EVENTS.REMOVED` and `PersonPhotoRemovedListener` in this module retires
 * the affected `tryon_cache` rows (C-16, §3.7).
 */
export interface PersonPhotoPort {
  /**
   * The photo a generation will run against: the one she named, or her active one.
   *
   * @throws `PHOTO_NOT_FOUND` · `PHOTO_NOT_OWNED` · `PHOTO_BLOCKED_BY_MODERATION`
   */
  resolveGenerationPhoto(userId: string, photoId?: string | null): Promise<PersonPhotoRef>;
}
