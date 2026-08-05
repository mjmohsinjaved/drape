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

  return {
    driver: parseDriver(env.STORAGE_DRIVER),
    root,
    urlSecret,
    apiBaseUrl,
    photoUrlTtlSeconds: optionalInt(env, 'STORAGE_URL_TTL_PHOTO_SECONDS', 300),
    renderUrlTtlSeconds: optionalInt(env, 'STORAGE_URL_TTL_RENDER_SECONDS', 900),
    publicUrlTtlSeconds: optionalInt(env, 'STORAGE_URL_TTL_PUBLIC_SECONDS', 3600),
    uploadTicketTtlSeconds: optionalInt(env, 'STORAGE_UPLOAD_TICKET_TTL_SECONDS', 900),
    maxUploadBytes: optionalInt(env, 'STORAGE_MAX_UPLOAD_MB', 25) * MEGABYTE,
    minFreeBytes: optionalInt(env, 'STORAGE_MIN_FREE_MB', 2048) * MEGABYTE,
  };
}
