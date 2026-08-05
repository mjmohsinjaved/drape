import { PersonPhotoResponseDto } from '../dto/person-photo-response.dto';

import type { PersonPhoto } from '../entities/person-photo.entity';

/**
 * `person_photos` row → response DTO. The only place that shape is decided (§2.9).
 *
 * `signUrl` is passed in rather than resolved here so the mapper stays a pure
 * function of its inputs, and so the **subject** of the signature is decided by the
 * caller that knows who is asking. §3.4 makes `sub` mandatory for every
 * `person-photos/**` key: the token is scoped to the owning user and
 * `GET /files/:token` refuses it for any other session.
 *
 * The signature deliberately takes `(key, subject)` rather than just `(key)`. A
 * mapper that could only sign "for whoever" would make it possible to hand a
 * consumer a URL that any signed-in account could redeem, and that failure would be
 * invisible at the call site.
 */
export function toPersonPhotoResponse(
  photo: PersonPhoto,
  signUrl: (key: string, subject: string) => string,
): PersonPhotoResponseDto {
  const dto = new PersonPhotoResponseDto();

  dto.id = photo.id;
  // Scoped to the row's own `userId`, never to "the current user" — a photo can only
  // ever be signed for the account that owns it (§3.4, §9.2).
  dto.url = signUrl(photo.storageKey, photo.userId);
  dto.isActive = photo.isActive;
  dto.label = photo.label;
  dto.moderationState = photo.moderationState;
  dto.width = photo.width;
  dto.height = photo.height;
  dto.byteSize = photo.byteSize;
  dto.mimeType = photo.mimeType;
  dto.uploadedAt = photo.uploadedAt;
  dto.purgeAfter = photo.purgeAfter;
  dto.createdAt = photo.createdAt;

  return dto;
}
