/**
 * The `person-photos` module's public surface.
 *
 * `TryOnModule` (W3) takes two methods off `PersonPhotosService` and nothing else:
 *
 * ```typescript
 * const photo = await this.photos.resolveGenerationPhoto(userId, dto.personPhotoId);
 * const url = this.photos.signedUrlFor(photo);
 * ```
 *
 * There is **no port back the other way.** C-16 cache retirement used to be a
 * `TRYON_CACHE_RETIREMENT` token declared here for `TryOnModule` to bind — which could
 * never resolve, because `TryOnModule` imports this module and not the reverse. It is
 * now {@link PERSON_PHOTO_EVENTS.REMOVED}, a domain event `TryOnModule` listens for;
 * see `events/person-photo.events.ts` for why eventual retirement is the correct
 * shape rather than a workaround for the wiring.
 *
 * The entity is exported for the modules that hold a foreign key to it
 * (`tryon_jobs`, `tryon_results`, `moderation_items`). Nothing exported from here can
 * read a photo without a `userId` in the predicate (S-10, §9.2).
 */
export { PersonPhotosModule } from './person-photos.module';
export { PersonPhotosService } from './services/person-photos.service';
export {
  PERSON_PHOTO_EVENTS,
  type PersonPhotoEventName,
  type PersonPhotoRemovedEvent,
} from './events/person-photo.events';
export { PersonPhoto } from './entities/person-photo.entity';
export { PhotoModerationState } from './enums/photo-moderation-state.enum';
export { PersonPhotoResponseDto } from './dto/person-photo-response.dto';
export { CreatePersonPhotoDto } from './dto/create-person-photo.dto';
export { UpdatePersonPhotoDto } from './dto/update-person-photo.dto';
export { PersonPhotoIdParamDto } from './dto/person-photo-id-param.dto';
export { toPersonPhotoResponse } from './mappers/person-photo.mapper';
export {
  isAllowedPhotoFormat,
  PHOTO_CHECKS,
  validatePersonPhoto,
  type PhotoCheckFailure,
  type PhotoCheckName,
  type PhotoMeasurements,
  type PhotoValidationResult,
} from './validators/person-photo.validator';
export {
  ALLOWED_PHOTO_FORMATS,
  BLURRED_THUMBNAIL_WIDTH,
  DEFAULT_PHOTO_RETENTION_DAYS,
  MAX_PHOTO_ASPECT_RATIO,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_LABEL_LENGTH,
  MAX_PHOTO_LONG_EDGE_PX,
  MIN_PHOTO_ASPECT_RATIO,
  MIN_PHOTO_LONG_EDGE_PX,
  MIN_PHOTO_SHORT_EDGE_PX,
} from './constants/person-photo.constants';
