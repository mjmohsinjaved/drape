/**
 * ARCHITECTURE.md §3.2 requirement 1 and §7 — storage configuration, resolved **once** at module
 * init.
 *
 * The root is asserted to be an absolute path that is not inside the repository. If it is, the
 * process fails to start: a storage root inside the working tree would put consumer photos into
 * version control and into any static file handler that ever gets pointed at the repo (§3.2
 * requirement 8, PRD §9.2). No value here has a fallback that could resolve inside the repository,
 * and no secret has a fallback at all (CLAUDE.md, E-2).
 */
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

import { StorageConfigError } from './exceptions/storage.exception';

export type StorageDriverName = 'local' | 's3';

export interface StorageConfig {
  /** `STORAGE_DRIVER` — `local` in V1, `s3` later without a call-site change. */
  readonly driver: StorageDriverName;
  /** `resolve(STORAGE_ROOT)`. Absolute, outside the repository. */
  readonly root: string;
  /** `STORAGE_URL_SECRET` — HMAC key for signed download and upload tokens (§3.4, §3.5). */
  readonly urlSecret: string;
  /** `APP_API_URL` — public base for signed file URLs. No trailing slash. */
  readonly apiBaseUrl: string;
  /** `STORAGE_URL_TTL_PHOTO_SECONDS` — person photos and blurred moderation thumbnails. */
  readonly photoUrlTtlSeconds: number;
  /** `STORAGE_URL_TTL_RENDER_SECONDS` */
  readonly renderUrlTtlSeconds: number;
  /** `STORAGE_URL_TTL_PUBLIC_SECONDS` — garments, categories, brand, reference models. */
  readonly publicUrlTtlSeconds: number;
  /** `STORAGE_UPLOAD_TICKET_TTL_SECONDS` */
  readonly uploadTicketTtlSeconds: number;
  /** `STORAGE_MAX_UPLOAD_MB`, in bytes. */
  readonly maxUploadBytes: number;
  /** `STORAGE_MIN_FREE_MB`, in bytes. Below this `/health/ready` degrades (E-14). */
  readonly minFreeBytes: number;
}

/** DI token for the resolved configuration. */
export const STORAGE_CONFIG = Symbol('STORAGE_CONFIG');

/** DI token for the active `StorageDriver`, chosen by `STORAGE_DRIVER`. */
export const STORAGE_DRIVER_TOKEN = Symbol('STORAGE_DRIVER');

const MEGABYTE = 1024 * 1024;

/**
 * **The window `exp` is quantised to — the reason a signed URL is cacheable at all.**
 *
 * `exp` used to be stamped from the exact millisecond of the call, so asking for the same object
 * twice produced two different tokens, two different URLs and therefore two different cache keys.
 * Nothing downstream could reuse anything: not the browser, not a CDN, and not Next's image
 * optimiser, whose cache key *is* the URL — which is why `next.config.ts`'s `minimumCacheTTL: 300`
 * was inert and why one component had already fallen back to a plain `<img>`.
 *
 * Quantising the **issue instant** — not the expiry — is what makes it safe. `exp` becomes
 * `floor(now / bucket) * bucket + ttl`, so every call inside the same two-minute window signs a
 * byte-identical payload and yields a byte-identical URL, while the token still expires, is still
 * subject-scoped and is still tamper-evident. Nothing about *what* is signed changed; only when the
 * clock is read.
 *
 * Rounding down rather than up is deliberate: it can only ever shorten a token's life (to at worst
 * `ttl - bucket`), never extend it past the §3.4 TTL for its object class. A photo URL that lived
 * longer than §3.4 says it may would be a security change dressed up as a cache fix.
 *
 * "At worst `ttl - bucket`" is precisely why {@link assertTtlsOutliveTheExpiryBucket} exists: a TTL
 * at or below this value makes the worst case zero or negative, and the URL is dead on arrival.
 *
 * Upload tickets are **not** bucketed: a ticket is used once by one client, nothing caches it, and
 * shortening its life by up to two minutes would buy nothing and cost a retry. Its TTL is therefore
 * not constrained by this value.
 *
 * It lives here rather than beside the signing code because the assertion below is what gives it
 * teeth, and a constant that constrains configuration belongs with the configuration.
 * `signed-url.service.ts` re-exports it, so every existing import still resolves.
 */
export const URL_EXPIRY_BUCKET_SECONDS = 120;

/** Long enough that a 64-hex-character secret passes and a placeholder does not. */
const MIN_SECRET_LENGTH = 32;

export interface LoadStorageConfigOptions {
  /**
   * Overrides repository detection. Only tests pass this — production walks up from this file and
   * from the working directory so a build layout change cannot silently disable the assertion.
   */
  readonly repositoryRoot?: string | null;
}

/* -------------------------------------------------------------------------------------------------
 * Repository containment
 * ---------------------------------------------------------------------------------------------- */

/** Windows paths are compared case-insensitively; POSIX paths are not. */
function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * `true` when `child` is `parent` or lives underneath it. Compares whole segments, so
 * `/srv/drape-storage-2` is not "inside" `/srv/drape-storage`.
 */
export function isPathInside(child: string, parent: string): boolean {
  const normalisedChild = resolve(child);
  const normalisedParent = resolve(parent);
  return (
    samePath(normalisedChild, normalisedParent) ||
    samePath(normalisedChild.slice(0, normalisedParent.length + sep.length), normalisedParent + sep)
  );
}

/**
 * Walks up from `startDir` looking for the repository root. `.git` is the primary marker;
 * `docs/ARCHITECTURE.md` covers a checkout without a `.git` directory (a CI export, a worktree
 * file, a vendored copy).
 */
export function findRepositoryRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, '.git')) || existsSync(join(dir, 'docs', 'ARCHITECTURE.md'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function candidateRepositoryRoots(options: LoadStorageConfigOptions): string[] {
  if (options.repositoryRoot !== undefined) {
    return options.repositoryRoot === null ? [] : [resolve(options.repositoryRoot)];
  }
  const found = [findRepositoryRoot(__dirname), findRepositoryRoot(process.cwd())];
  const unique: string[] = [];
  for (const root of found) {
    if (root !== null && !unique.some((existing) => samePath(existing, root))) {
      unique.push(root);
    }
  }
  return unique;
}

/**
 * §3.2 requirement 1. Throws `StorageConfigError` — the process must fail to start.
 *
 * Both directions are rejected: the root must not be inside the repository, and the repository must
 * not be inside the root (a root of `D:/` would make every requirement below meaningless).
 */
export function assertRootOutsideRepository(
  root: string,
  repositoryRoots: readonly string[],
): void {
  if (!isAbsolute(root)) {
    throw new StorageConfigError(
      `STORAGE_ROOT must be an absolute path. Received a relative path (${root.length} characters).`,
    );
  }
  for (const repositoryRoot of repositoryRoots) {
    if (isPathInside(root, repositoryRoot)) {
      throw new StorageConfigError(
        'STORAGE_ROOT resolves inside the repository. Images must live outside the working tree ' +
          '(ARCHITECTURE.md §3.2). Point STORAGE_ROOT at a directory outside the checkout, e.g. ' +
          'D:/drape-storage.',
      );
    }
    if (isPathInside(repositoryRoot, root)) {
      throw new StorageConfigError(
        'STORAGE_ROOT contains the repository. Choose a dedicated directory that holds nothing ' +
          'but stored objects (ARCHITECTURE.md §3.2).',
      );
    }
  }
}

/* -------------------------------------------------------------------------------------------------
 * Loading
 * ---------------------------------------------------------------------------------------------- */

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw new StorageConfigError(`${name} is required and has no default. Set it in backend/.env.`);
  }
  return value.trim();
}

function optionalInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new StorageConfigError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseDriver(raw: string | undefined): StorageDriverName {
  const value = (raw ?? 'local').trim().toLowerCase();
  if (value === 'local' || value === 's3') {
    return value;
  }
  throw new StorageConfigError(`STORAGE_DRIVER must be 'local' or 's3'. Received '${value}'.`);
}

/**
 * Reads and validates the storage environment. Called once, from the `StorageModule` factory.
 *
 * `STORAGE_ROOT`, `STORAGE_URL_SECRET` and `APP_API_URL` are required (§7). In particular
 * `STORAGE_ROOT` carries **no** default: the §3.2 example value `D:/drape-storage` is a Windows path
 * that would be meaningless on a Linux host, and a silent default is exactly how a storage root ends
 * up somewhere nobody intended.
 */
export function loadStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: LoadStorageConfigOptions = {},
): StorageConfig {
  const root = resolve(required(env, 'STORAGE_ROOT'));
  assertRootOutsideRepository(root, candidateRepositoryRoots(options));

  const urlSecret = required(env, 'STORAGE_URL_SECRET');
  if (urlSecret.length < MIN_SECRET_LENGTH) {
    throw new StorageConfigError(
      `STORAGE_URL_SECRET must be at least ${MIN_SECRET_LENGTH} characters (§7 expects 64 hex characters).`,
    );
  }

  const apiBaseUrl = required(env, 'APP_API_URL').replace(/\/+$/, '');

  const ttls = {
    photoUrlTtlSeconds: optionalInt(env, 'STORAGE_URL_TTL_PHOTO_SECONDS', 300),
    renderUrlTtlSeconds: optionalInt(env, 'STORAGE_URL_TTL_RENDER_SECONDS', 900),
    publicUrlTtlSeconds: optionalInt(env, 'STORAGE_URL_TTL_PUBLIC_SECONDS', 3600),
  };

  assertTtlsOutliveTheExpiryBucket(ttls);

  return {
    driver: parseDriver(env.STORAGE_DRIVER),
    root,
    urlSecret,
    apiBaseUrl,
    ...ttls,
    // Not bucketed, so not constrained by the assertion above — see URL_EXPIRY_BUCKET_SECONDS.
    uploadTicketTtlSeconds: optionalInt(env, 'STORAGE_UPLOAD_TICKET_TTL_SECONDS', 900),
    maxUploadBytes: optionalInt(env, 'STORAGE_MAX_UPLOAD_MB', 25) * MEGABYTE,
    minFreeBytes: optionalInt(env, 'STORAGE_MIN_FREE_MB', 2048) * MEGABYTE,
  };
}

/** The env var each TTL comes from, for an error message that names what to change. */
const TTL_ENV_NAMES: Readonly<Record<string, string>> = {
  photoUrlTtlSeconds: 'STORAGE_URL_TTL_PHOTO_SECONDS',
  renderUrlTtlSeconds: 'STORAGE_URL_TTL_RENDER_SECONDS',
  publicUrlTtlSeconds: 'STORAGE_URL_TTL_PUBLIC_SECONDS',
};

/**
 * **A URL must not be able to be born expired.**
 *
 * `SignedUrlService` rounds the issue instant *down* to `URL_EXPIRY_BUCKET_SECONDS` so two
 * calls for the same key and subject inside one window produce the same URL — which is what
 * makes a signed URL cacheable and keeps a gallery of thirty renders from minting thirty
 * distinct tokens. The cost is that a URL issued at the end of a bucket has already spent
 * up to `URL_EXPIRY_BUCKET_SECONDS` of its life before it is handed over.
 *
 * With a TTL at or below the bucket, that is not a shortened lifetime, it is no lifetime:
 * the token is stamped with an expiry already in the past and the very first click 403s. It
 * would be intermittent, too — fine for a request that landed early in a bucket, broken for
 * one that landed late — which is the worst way for a configuration error to present.
 *
 * So the relationship is asserted here, at boot, where a bad value stops the process rather
 * than reaching a consumer. §7's defaults clear it by a wide margin; this exists for the
 * operator who tightens one of them without knowing about the bucket.
 */
export function assertTtlsOutliveTheExpiryBucket(ttls: Readonly<Record<string, number>>): void {
  for (const [field, seconds] of Object.entries(ttls)) {
    if (seconds <= URL_EXPIRY_BUCKET_SECONDS) {
      const name = TTL_ENV_NAMES[field] ?? field;
      throw new StorageConfigError(
        `${name} is ${seconds}s, which is not longer than the ${URL_EXPIRY_BUCKET_SECONDS}s ` +
          'signed-URL expiry bucket. Signed URLs are issued from the start of the current ' +
          'bucket so they can be cached, so a TTL this short can hand out a URL that has ' +
          `already expired. Set it above ${URL_EXPIRY_BUCKET_SECONDS}.`,
      );
    }
  }
}
