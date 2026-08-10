/**
 * ARCHITECTURE.md §3.3 — the **only** place a storage key is constructed.
 *
 * String concatenation of a key anywhere else in the codebase is a review failure. This file also
 * owns the closed vocabulary that surrounds a key: the accepted extensions, the MIME allow-list, and
 * the magic-byte sniffing that maps bytes back into that same closed set (§3.2 requirement 9). Those
 * live here rather than in a util so that "what a key may look like" has exactly one home.
 */
import { createHash, randomUUID } from 'node:crypto';

import { storagePathRejected } from './exceptions/storage.exception';

/* -------------------------------------------------------------------------------------------------
 * Vocabulary
 * ---------------------------------------------------------------------------------------------- */

/** §3.3 — the closed extension set. `svg` is only ever legal under `brand/`. */
export type ImageExt = 'jpg' | 'jpeg' | 'png' | 'webp' | 'heic' | 'svg';

/** Every extension except `svg`. The type system, not a comment, keeps `svg` out of `garments/`. */
export type RasterImageExt = Exclude<ImageExt, 'svg'>;

export const IMAGE_EXTS: readonly ImageExt[] = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'svg'];

export type ThumbnailKind =
  'garment' | 'render' | 'category' | 'person-blurred' | 'reference-model';

/**
 * §3.3 / C-39 — the extension and content type of a data-export archive.
 *
 * A real ZIP, written by `retention`'s `buildZipArchive`. The constants live here
 * rather than beside the writer for the same reason every other key constant does:
 * "what a key may look like" has exactly one home.
 */
export const EXPORT_EXTENSION = 'zip';

/** `application/zip`. Stored on the object so `GET /files/:token` serves it correctly. */
export const EXPORT_CONTENT_TYPE = 'application/zip';

/** §3.3 — `320w` grid, `640w` detail, `160w` admin table. */
export type ThumbnailWidth = 160 | 320 | 640;

export const THUMBNAIL_WIDTHS: readonly ThumbnailWidth[] = [160, 320, 640];

/**
 * §3.5 / PRD A-10 — the upload allow-list. `image/heif` is accepted alongside `image/heic` because
 * Apple's exporters emit either for the same container.
 */
export const ALLOWED_UPLOAD_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

export const MIME_BY_EXT: Readonly<Record<ImageExt, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  svg: 'image/svg+xml',
};

const EXT_BY_MIME: Readonly<Record<string, ImageExt>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'image/svg+xml': 'svg',
};

/* -------------------------------------------------------------------------------------------------
 * Key validation (§3.2 requirement 3)
 * ---------------------------------------------------------------------------------------------- */

/** §3.2 requirement 3, verbatim. Lowercase, slash-separated, single trailing extension. */
export const STORAGE_KEY_PATTERN = /^[a-z0-9][a-z0-9\-/]*\.[a-z0-9]{2,5}$/;

/** A prefix is a key without the file part. Used by `deletePrefix` and `list`. */
export const STORAGE_PREFIX_PATTERN = /^[a-z0-9][a-z0-9\-/]*\/$/;

export const MAX_KEY_LENGTH = 512;

/**
 * Driver-private directories. They start with a dot, which `STORAGE_KEY_PATTERN` forbids, so a
 * caller-supplied key can never address them.
 */
export const TEMP_DIR_NAME = '.tmp';
export const META_DIR_NAME = '.meta';

/** A name for a file inside `<root>/.tmp/`. Not a storage key — it never reaches the database. */
export const tempFileName = (): string => randomUUID();

function hasHostileSegment(value: string): boolean {
  return (
    value.length === 0 ||
    value.length > MAX_KEY_LENGTH ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.includes(':') ||
    value.startsWith('/') ||
    value.includes('//') ||
    value.split('/').some((segment) => segment === '.' || segment === '..')
  );
}

export function isValidStorageKey(key: string): boolean {
  if (typeof key !== 'string' || hasHostileSegment(key)) {
    return false;
  }
  return STORAGE_KEY_PATTERN.test(key);
}

export function isValidStoragePrefix(prefix: string): boolean {
  if (typeof prefix !== 'string' || hasHostileSegment(prefix)) {
    return false;
  }
  return STORAGE_PREFIX_PATTERN.test(prefix);
}

/** Throws `STORAGE_PATH_REJECTED` before any filesystem call is made. */
export function assertValidStorageKey(key: string): void {
  if (!isValidStorageKey(key)) {
    throw storagePathRejected();
  }
}

/** Throws `STORAGE_PATH_REJECTED` before any filesystem call is made. */
export function assertValidStoragePrefix(prefix: string): void {
  if (!isValidStoragePrefix(prefix)) {
    throw storagePathRejected();
  }
}

/* -------------------------------------------------------------------------------------------------
 * Builders (§3.3)
 * ---------------------------------------------------------------------------------------------- */

/**
 * `<uuid>` is v4 and unguessable. §3.3: that is **not** a substitute for an authorisation check —
 * every read still goes through a signed URL and the owning module still checks ownership.
 */
export const StorageKeys = {
  /** `garments/<garmentId>/<uuid>.<ext>` */
  garmentImage: (garmentId: string, ext: RasterImageExt): string =>
    `garments/${garmentId}/${randomUUID()}.${ext}`,

  /** `categories/<categoryId>/<uuid>.<ext>` */
  categoryCover: (categoryId: string, ext: RasterImageExt): string =>
    `categories/${categoryId}/${randomUUID()}.${ext}`,

  /** `person-photos/<userId>/<uuid>.<ext>` */
  personPhoto: (userId: string, ext: RasterImageExt): string =>
    `person-photos/${userId}/${randomUUID()}.${ext}`,

  /**
   * `renders/<userId>/<uuid>.<ext>`
   *
   * The extension was hardcoded to `png` here, on the comment "always png, that is what the
   * upstream returns". TryOnCloud returns **JPEG**, and nothing found out until the first real
   * generation: the mock driver produces PNG, so every test agreed with the comment. The
   * consequence was not a wrong file name — `LocalDiskDriver` checks the declared content type
   * against the magic bytes, so the write was refused, the render was discarded, and the
   * upstream image was spent for nothing.
   *
   * `ext` is required rather than defaulted for that reason: the caller holds the bytes and is
   * the only thing that can answer honestly. `sniffMimeType` + `extForMimeType` turn them into
   * this argument, and `sniffMimeType` is the same function the driver validates with, so the
   * two cannot disagree.
   */
  render: (userId: string, ext: RasterImageExt): string =>
    `renders/${userId}/${randomUUID()}.${ext}`,

  /**
   * `thumbnails/<kind>/<uuid>.webp`, or `thumbnails/<kind>/<uuid>-<width>.webp` when a width is
   * given (§3.3: "the width is encoded in the filename suffix by ImageService").
   */
  thumbnail: (kind: ThumbnailKind, width?: ThumbnailWidth): string =>
    width === undefined
      ? `thumbnails/${kind}/${randomUUID()}.webp`
      : `thumbnails/${kind}/${randomUUID()}-${width}.webp`,

  /** `reference-models/<uuid>.jpg` */
  referenceModel: (): string => `reference-models/${randomUUID()}.jpg`,

  /** `brand/<uuid>.<ext>` — the only prefix allowed to hold an `svg`, sanitised before write. */
  brandAsset: (ext: ImageExt): string => `brand/${randomUUID()}.${ext}`,

  /**
   * `exports/<userId>/<uuid>.zip` — one C-39 data-export archive.
   *
   * Built from a **session-derived** `userId` and a fresh v4 uuid, and nothing else.
   * There is no code path where a caller supplies a segment, which is what makes
   * `GET /me/export/:exportId` safe: the key it reconstructs is always inside her own
   * prefix, so an id belonging to somebody else addresses an object that does not
   * exist rather than one that does.
   */
  dataExport: (userId: string): string => `exports/${userId}/${randomUUID()}.${EXPORT_EXTENSION}`,

  /**
   * The key an export id resolves to.
   *
   * Both segments are validated by the caller — `userId` comes from the session and
   * `exportId` through `@IsUUID()` — so this cannot compose a key outside her prefix.
   */
  dataExportFor: (userId: string, exportId: string): string =>
    `exports/${userId}/${exportId}.${EXPORT_EXTENSION}`,
} as const;

/**
 * Prefixes, for `deletePrefix` and `list`. §3.3: deleting a consumer deletes `person-photos/<id>/`
 * and `renders/<id>/`, and the returned count is written to `deletion_log.itemsDeleted` (§9.3).
 */
export const StoragePrefixes = {
  garment: (garmentId: string): string => `garments/${garmentId}/`,
  category: (categoryId: string): string => `categories/${categoryId}/`,
  personPhotosOfUser: (userId: string): string => `person-photos/${userId}/`,
  rendersOfUser: (userId: string): string => `renders/${userId}/`,
  thumbnailsOfKind: (kind: ThumbnailKind): string => `thumbnails/${kind}/`,
  referenceModels: (): string => 'reference-models/',
  brand: (): string => 'brand/',
  /** `exports/<userId>/` — dropped wholesale on account deletion (§3.3, §9.3). */
  exportsOfUser: (userId: string): string => `exports/${userId}/`,
  /** `person-photos/` — every account's photographs. Only the retention sweep walks it. */
  allPersonPhotos: (): string => 'person-photos/',
  /** `renders/` — every account's renders. Only the retention sweep walks it. */
  allRenders: (): string => 'renders/',
  /** `exports/` — every account's archives. Only the retention sweep walks it. */
  allExports: (): string => 'exports/',
} as const;

/** The `thumbnails/<kind>/` a key belongs to, used to pick the §3.4 TTL and subject rule. */
export function keyPrefixSegment(key: string): string {
  const slash = key.indexOf('/');
  return slash === -1 ? key : key.slice(0, slash);
}

/* -------------------------------------------------------------------------------------------------
 * Reading a key back (§3.3, §3.5 step 4)
 * ---------------------------------------------------------------------------------------------- */

/** The three key namespaces that are private to exactly one account. */
export type OwnedKeyNamespace = 'person-photos' | 'renders' | 'exports';

/** What {@link parseOwnedKey} recovers from `<namespace>/<userId>/<objectId>.<ext>`. */
export interface ParsedOwnedKey {
  readonly namespace: OwnedKeyNamespace;
  /** The account the object belongs to — the second segment of the key. */
  readonly userId: string;
  /** The object's own uuid — the filename stem. */
  readonly objectId: string;
}

const OWNED_KEY_PATTERN =
  /^(person-photos|renders|exports)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[a-z0-9]{2,5}$/;

/**
 * Recovers the owner and the object id a key encodes, or `null` when it is not one of ours.
 *
 * The **only** sanctioned way to read a key. §3.3 says keys are built here and nowhere
 * else; taking them apart with an ad-hoc `split('/')` at a call site is the same defect
 * in the other direction, and it is how a sweep ends up deleting `renders/` itself.
 *
 * The retention orphan sweep (§3.5 step 4) needs both halves: the owner, so a
 * `deletion_log` row can name whose object was removed, and the object id, so the row
 * has a `subjectId` that was never invented. A key that does not parse is left alone
 * rather than guessed at — an unrecognised object is a reason to investigate, never a
 * reason to delete.
 */
export function parseOwnedKey(key: string): ParsedOwnedKey | null {
  const match = OWNED_KEY_PATTERN.exec(key);
  if (match === null) {
    return null;
  }
  const [, namespace, userId, objectId] = match;
  if (namespace === undefined || userId === undefined || objectId === undefined) {
    return null;
  }
  return { namespace: namespace as OwnedKeyNamespace, userId, objectId };
}

/** The export id encoded in an `exports/**` key, or `null` when the key is not one. */
export function exportIdFromKey(key: string): string | null {
  const parsed = parseOwnedKey(key);
  return parsed !== null && parsed.namespace === 'exports' ? parsed.objectId : null;
}

/* -------------------------------------------------------------------------------------------------
 * Extension / MIME helpers
 * ---------------------------------------------------------------------------------------------- */

export function extensionOf(key: string): string | null {
  const dot = key.lastIndexOf('.');
  return dot === -1 ? null : key.slice(dot + 1).toLowerCase();
}

export function isImageExt(value: string): value is ImageExt {
  return (IMAGE_EXTS as readonly string[]).includes(value);
}

/** The extension to store bytes of this MIME type under, or `null` when it is not accepted. */
export function extForMimeType(mimeType: string): ImageExt | null {
  return EXT_BY_MIME[normaliseMimeType(mimeType)] ?? null;
}

/** The content type to serve a key with, derived from its extension only — never from the client. */
export function mimeTypeForKey(key: string): string {
  const ext = extensionOf(key);
  return ext !== null && isImageExt(ext) ? MIME_BY_EXT[ext] : 'application/octet-stream';
}

/** Lower-cases and drops any `; charset=…` parameter so comparisons are exact. */
export function normaliseMimeType(mimeType: string): string {
  const semicolon = mimeType.indexOf(';');
  return (semicolon === -1 ? mimeType : mimeType.slice(0, semicolon)).trim().toLowerCase();
}

/** `image/heic` and `image/heif` describe the same container and are treated as equal. */
export function mimeTypesMatch(a: string, b: string): boolean {
  const left = normaliseMimeType(a);
  const right = normaliseMimeType(b);
  if (left === right) {
    return true;
  }
  const heif = new Set(['image/heic', 'image/heif']);
  return heif.has(left) && heif.has(right);
}

export function isAllowedUploadMimeType(mimeType: string): boolean {
  return ALLOWED_UPLOAD_MIME_TYPES.includes(normaliseMimeType(mimeType));
}

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heif', 'avif']);

/**
 * §3.2 requirement 9 — content type is decided by the magic bytes, never by the client-supplied
 * header. Returns `null` when the head does not match any format we accept.
 *
 * Only the first bytes are needed, so this works on the first chunk of a stream as well as a buffer.
 */
export function sniffMimeType(head: Buffer): string | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    head.length >= 12 &&
    head.toString('ascii', 0, 4) === 'RIFF' &&
    head.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (head.length >= 12 && head.toString('ascii', 4, 8) === 'ftyp') {
    const brand = head.toString('ascii', 8, 12).toLowerCase();
    if (HEIF_BRANDS.has(brand)) {
      return 'image/heic';
    }
  }
  const text = head.toString('utf8', 0, Math.min(head.length, 256)).trimStart().toLowerCase();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) {
    return 'image/svg+xml';
  }
  return null;
}

/* -------------------------------------------------------------------------------------------------
 * Content hashing (§3.2 requirement 7, §3.7)
 * ---------------------------------------------------------------------------------------------- */

/** The sha256 the driver returns as `etag` and callers persist as the `hash` column. */
export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * §3.7 — `sha256(`${garmentSourceHash}:${personPhotoHash}:${TRYON_API_VERSION}`)`.
 *
 * `apiVersion` is supplied by the caller (`TRYON_API_VERSION` belongs to the tryon module, not to
 * storage). Bumping it invalidates the whole cache without a migration.
 */
export function buildTryOnCacheKey(
  garmentSourceHash: string,
  personPhotoHash: string,
  apiVersion: string,
): string {
  return createHash('sha256')
    .update(`${garmentSourceHash}:${personPhotoHash}:${apiVersion}`)
    .digest('hex');
}
