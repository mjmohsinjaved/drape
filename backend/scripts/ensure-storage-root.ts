import { mkdirSync, statSync } from 'node:fs';
import { parse, resolve } from 'node:path';

import {
  assertRootOutsideRepository,
  findRepositoryRoot,
  isPathInside,
  META_DIR_NAME,
  TEMP_DIR_NAME,
} from '@library/storage';

import { loadEnvFile } from './load-env';

/**
 * `npm run storage:ensure` — creates the `STORAGE_ROOT` prefix tree from §3.3 if it is
 * missing.
 *
 * The interesting half is what it REFUSES to do. Media never lives inside the repository
 * (§0, §3.2, CLAUDE.md): the database stores a relative storage key, the only read path is
 * `GET /api/v1/files/:token`, and nothing under `STORAGE_ROOT` is ever served by a static
 * file handler. A `STORAGE_ROOT` that resolved inside this repo would put consumer photos
 * one `git add -A` away from being committed, so this script exits non-zero rather than
 * create it.
 *
 * The containment rule itself comes from `@library/storage` — `assertRootOutsideRepository`
 * is the same check `loadStorageConfig()` runs at boot. This script must not have a second,
 * subtly different opinion about what "inside the repository" means.
 *
 * This is a CLI: it writes to stdout deliberately, and it is the one place outside
 * `libs/storage` allowed to touch `fs`, because creating the root is a precondition for the
 * storage library working at all.
 */

/**
 * The prefix tree (§3.3), plus the two dot-directories the local-disk driver creates at init:
 * `.tmp` stages the atomic write (§3.2 requirement 4) and `.meta` holds per-object metadata.
 * Neither is a key prefix — no database row ever references them.
 */
const STORAGE_DIRECTORIES: readonly string[] = [
  TEMP_DIR_NAME,
  META_DIR_NAME,
  'brand',
  'categories',
  'garments',
  'person-photos',
  'reference-models',
  'renders',
  'thumbnails/category',
  'thumbnails/garment',
  'thumbnails/person-blurred',
  'thumbnails/reference-model',
  'thumbnails/render',
];

/** `backend/scripts` → `backend`. */
const BACKEND_ROOT = resolve(__dirname, '..');

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/** Reads and validates `STORAGE_ROOT`, or throws with a message an operator can act on. */
function resolveStorageRoot(repositoryRoot: string): string {
  const raw = process.env.STORAGE_ROOT?.trim();
  if (raw === undefined || raw === '') {
    throw new Error(
      'STORAGE_ROOT is not set. It has no fallback default here on purpose — a silently ' +
        'invented media root is how photos end up somewhere nobody backs up. Set it in ' +
        'backend/.env (see .env.example); D:/drape-storage is the documented value on this machine.',
    );
  }

  // `resolve` normalises separators and expands a relative path against the CWD — which is
  // exactly the case the containment check below exists to catch.
  const root = resolve(raw);

  if (parse(root).root === root) {
    throw new Error(
      `STORAGE_ROOT resolves to the filesystem root "${root}". Point it at a dedicated ` +
        'directory such as D:/drape-storage, not at a drive or volume root.',
    );
  }

  // Throws StorageConfigError when the path is relative or inside the checkout.
  assertRootOutsideRepository(root, [repositoryRoot, BACKEND_ROOT]);

  if (isPathInside(repositoryRoot, root)) {
    throw new Error(
      `STORAGE_ROOT resolves to "${root}", which CONTAINS the repository at "${repositoryRoot}". ` +
        'A media root that encloses the source tree is never what was intended.',
    );
  }

  return root;
}

/** @returns true when the directory already existed. */
function ensureDirectory(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) {
      throw new Error(`${path} exists but is not a directory. Remove it and run this again.`);
    }
    return true;
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') {
      throw error;
    }
  }

  mkdirSync(path, { recursive: true });
  return false;
}

export function ensureStorageRoot(): void {
  loadEnvFile();

  const repositoryRoot = findRepositoryRoot(BACKEND_ROOT) ?? resolve(BACKEND_ROOT, '..');
  const root = resolveStorageRoot(repositoryRoot);

  write(`STORAGE_ROOT  ${root}`);
  write(`repository    ${repositoryRoot}`);
  write('');

  let created = 0;
  let existing = 0;

  for (const relative of ['', ...STORAGE_DIRECTORIES]) {
    // Declared with `/` above; `resolve` normalises for the platform.
    const directory = relative === '' ? root : resolve(root, ...relative.split('/'));
    const label = relative === '' ? '.' : relative;

    if (ensureDirectory(directory)) {
      existing += 1;
      write(`  exists   ${label}/`);
    } else {
      created += 1;
      write(`  created  ${label}/`);
    }
  }

  write('');
  write(`Storage root ready: ${created} created, ${existing} already present.`);
  write(
    'This directory is never served statically, never symlinked into the repo, and never committed.',
  );
}

if (require.main === module) {
  try {
    ensureStorageRoot();
  } catch (error) {
    process.stderr.write(
      `\nensure-storage-root: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
