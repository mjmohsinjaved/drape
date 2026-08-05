import { Injectable } from '@nestjs/common';

import { PersonPhotosService } from '@api/modules/person-photos';

import type { PersonPhotoPort, PersonPhotoRef } from '../ports/person-photo.port';

/**
 * The `PERSON_PHOTO_PORT` binding — `person-photos` answers guard-chain step 11.
 *
 * A three-line delegation rather than `useExisting: PersonPhotosService`, so the
 * compiler checks that the service still satisfies the port. `PersonPhoto` is
 * structurally a `PersonPhotoRef`; the day it stops being one, this file fails to
 * compile instead of the generation path failing at runtime.
 *
 * Nothing is re-checked here and nothing is re-derived. Ownership lives in the owning
 * module's `where` clause (§9.2), and the §2.4 codes it raises pass straight through.
 */
@Injectable()
export class PersonPhotoServiceAdapter implements PersonPhotoPort {
  constructor(private readonly photos: PersonPhotosService) {}

  async resolveGenerationPhoto(userId: string, photoId?: string | null): Promise<PersonPhotoRef> {
    return this.photos.resolveGenerationPhoto(userId, photoId);
  }
}
