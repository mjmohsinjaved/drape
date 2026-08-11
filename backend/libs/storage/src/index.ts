/**
 * `@library/storage` — the barrel. ARCHITECTURE.md §1.1: "always import from the barrel".
 *
 * Nothing outside this library imports `libs/storage/src/...` directly, and nothing outside it
 * touches `fs`, joins a path onto a storage key, or talks to a driver (§3).
 */

export { StorageModule } from './storage.module';

export {
  StorageService,
  type CreateUploadTicketRequest,
  type FreeSpaceReport,
  type PutRequestOptions,
  type PutResult,
} from './storage.service';

export {
  SignedUrlService,
  UPLOAD_TICKET_HEADER,
  URL_EXPIRY_BUCKET_SECONDS,
  type IssueOptions,
  type SignedUrlPayload,
  type UploadTicketPayload,
  type VerifyOptions,
} from './signed-url.service';

export {
  parseAudience,
  SignedUrlAudienceRegistry,
  type ParsedAudience,
  type SignedUrlAudienceValidator,
} from './signed-url-audience.registry';

export {
  ImageService,
  type ImageMetadata,
  type ImageQualityMeasurements,
  type ResizeOptions,
  type ThumbnailOptions,
  type WatermarkOptions,
} from './image.service';

export {
  assertRootOutsideRepository,
  findRepositoryRoot,
  isPathInside,
  loadStorageConfig,
  STORAGE_CONFIG,
  STORAGE_DRIVER_TOKEN,
  type LoadStorageConfigOptions,
  type StorageConfig,
  type StorageDriverName,
} from './storage.config';

export {
  ALLOWED_UPLOAD_MIME_TYPES,
  assertValidStorageKey,
  assertValidStoragePrefix,
  buildTryOnCacheKey,
  EXPORT_CONTENT_TYPE,
  EXPORT_EXTENSION,
  exportIdFromKey,
  extensionOf,
  extForMimeType,
  IMAGE_EXTS,
  isAllowedUploadMimeType,
  isImageExt,
  isValidStorageKey,
  isValidStoragePrefix,
  keyPrefixSegment,
  MAX_KEY_LENGTH,
  META_DIR_NAME,
  MIME_BY_EXT,
  mimeTypeForKey,
  mimeTypesMatch,
  normaliseMimeType,
  parseOwnedKey,
  sha256,
  sniffMimeType,
  STORAGE_KEY_PATTERN,
  STORAGE_PREFIX_PATTERN,
  StorageKeys,
  StoragePrefixes,
  TEMP_DIR_NAME,
  tempFileName,
  THUMBNAIL_WIDTHS,
  type ImageExt,
  type OwnedKeyNamespace,
  type ParsedOwnedKey,
  type RasterImageExt,
  type ThumbnailKind,
  type ThumbnailWidth,
} from './storage-key.builder';

export {
  fileNotFound,
  fileTokenExpired,
  fileTokenInvalid,
  fileTokenSubjectMismatch,
  imageCorrupt,
  imageFormatUnsupported,
  imageTooLarge,
  StorageConfigError,
  storagePathRejected,
  storageWriteFailed,
  uploadTicketExpired,
  uploadTicketInvalid,
} from './exceptions/storage.exception';

export { LocalDiskDriver } from './drivers/local-disk.driver';

export type {
  CreateUploadTicketOptions,
  PutOptions,
  StorageDriver,
  StoredObject,
  UploadTicket,
} from './drivers/storage-driver.interface';
