import { StorageKeys } from '@library/storage';

import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { PhotoModerationState } from '@api/modules/person-photos/enums/photo-moderation-state.enum';

import { daysFromFixedNow, FIXED_NOW } from '../setup/time';

import { buildEntity, hash64, nextSequence, uuid } from './factory.support';

/**
 * `person_photos` (§4.16) — the most sensitive table in the schema.
 *
 * Two rules this factory keeps you honest about:
 *
 *  - **Keys, never paths.** `storageKey` comes from the storage key builder, which is the
 *    only place a key is ever constructed (§3.3). An absolute path in a fixture is a defect
 *    (CLAUDE.md), and a hand-written key is one edge case away from being a real one.
 *  - **No admin query may select `storageKey` from this table** (S-10). If a test needs to
 *    prove an admin response leaks nothing, assert on the *serialised* response containing
 *    no `person-photos/` prefix — this factory gives you a realistic one to look for.
 */
export function buildPersonPhoto(overrides: Partial<PersonPhoto> = {}): PersonPhoto {
  const sequence = nextSequence();
  const userId = overrides.userId ?? uuid();

  return buildEntity<PersonPhoto>(
    PersonPhoto,
    {
      id: uuid(),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      deletedAt: null,

      userId,
      storageKey: StorageKeys.personPhoto(userId, 'jpg'),
      // The only derivative an admin can ever see, and only through the A-34 queue.
      blurredThumbnailKey: StorageKeys.thumbnail('person-blurred'),
      // The `personPhotoHash` half of the §3.7 cache key. Deterministic per fixture.
      hash: hash64(`person-photo-${sequence}`),

      isActive: true,
      label: `daylight ${sequence}`,
      uploadedAt: FIXED_NOW,
      // users.lastActiveAt + PHOTO_RETENTION_DAYS, recomputed by the purge cron (§9.3).
      purgeAfter: daysFromFixedNow(30),

      moderationState: PhotoModerationState.APPROVED,
      width: 1080,
      height: 1620,
      byteSize: 842_133,
      mimeType: 'image/jpeg',
    },
    overrides,
  );
}

/** A saved but inactive photo. C-16: a consumer holds several and chooses which is active. */
export function buildInactivePersonPhoto(overrides: Partial<PersonPhoto> = {}): PersonPhoto {
  return buildPersonPhoto({ isActive: false, ...overrides });
}

/** A photo awaiting moderation — it has not yet been cleared for generation. */
export function buildPendingPersonPhoto(overrides: Partial<PersonPhoto> = {}): PersonPhoto {
  return buildPersonPhoto({
    moderationState: PhotoModerationState.PENDING,
    isActive: false,
    ...overrides,
  });
}

/** A photo already past its purge date — the §9.3 retention job's input. */
export function buildExpiredPersonPhoto(overrides: Partial<PersonPhoto> = {}): PersonPhoto {
  return buildPersonPhoto({ purgeAfter: daysFromFixedNow(-1), ...overrides });
}
