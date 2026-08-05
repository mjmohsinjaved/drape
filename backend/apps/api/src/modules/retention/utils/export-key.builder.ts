import { randomUUID } from 'node:crypto';

import { isValidStorageKey, isValidStoragePrefix } from '@library/storage';

/**
 * Storage keys for the C-39 data export.
 *
 * ### Why this is here and not in `@library/storage`
 *
 * It should be there. §3.3 is explicit: "Keys are built **only** by
 * `storage-key.builder.ts`. String concatenation of a key anywhere else is a review
 * failure." The `exports/` prefix is simply not in that file's vocabulary yet, and
 * `libs/storage` is outside this workstream's ownership, so the builder lives here —
 * in **one** function, validated against the library's own `isValidStorageKey`, and
 * flagged for the move.
 *
 * The move is three lines: add `dataExport: (userId) => \`exports/${userId}/${uuid}.zip\``
 * to `StorageKeys`, add `exportsOfUser` to `StoragePrefixes`, and delete this file. The
 * §3.4 issuing table gains one row — `exports/**`, `sub` required, and the render TTL is
 * the right one, because an export contains renders.
 *
 * ### The property that matters until then
 *
 * A key is built from a **session-derived** `userId` and a fresh v4 uuid, and nothing
 * else. There is no code path where a caller supplies a segment. That is what makes
 * `GET /me/export/:exportId` safe: the key it reconstructs is always inside her own
 * prefix, so an id belonging to somebody else addresses an object that does not exist
 * rather than one that does.
 */

/** `exports/` — the prefix an account's archives live under. */
export const EXPORT_PREFIX = 'exports';

/** `.zip` — a real ZIP, written by `buildZipArchive` (C-39). */
export const EXPORT_EXTENSION = 'zip';

/** `application/zip`. Stored on the object so `GET /files/:token` serves it correctly. */
export const EXPORT_CONTENT_TYPE = 'application/zip';

export const ExportKeys = {
  /** `exports/<userId>/<uuid>.zip` */
  archive: (userId: string): string =>
    `${EXPORT_PREFIX}/${userId}/${randomUUID()}.${EXPORT_EXTENSION}`,

  /**
   * The key an export id resolves to.
   *
   * Both segments are validated by the caller — `userId` comes from the session and
   * `exportId` through `@IsUUID()` — so this cannot compose a key outside her prefix.
   */
  archiveFor: (userId: string, exportId: string): string =>
    `${EXPORT_PREFIX}/${userId}/${exportId}.${EXPORT_EXTENSION}`,
} as const;

export const ExportPrefixes = {
  /** `exports/<userId>/` — dropped wholesale on account deletion (§3.3, §9.3). */
  ofUser: (userId: string): string => `${EXPORT_PREFIX}/${userId}/`,
} as const;

/** The export id encoded in a key, or `null` when the key is not one of ours. */
export function exportIdFromKey(key: string): string | null {
  const match = /^exports\/[0-9a-f-]{36}\/([0-9a-f-]{36})\.zip$/.exec(key);
  return match?.[1] ?? null;
}

/**
 * Asserts that what this builder produced is a key the storage library will accept.
 *
 * Belt and braces: the library validates on every call anyway, but a prefix that was
 * legal in this file and illegal in `libs/storage` would fail at write time, on her
 * request, rather than here.
 */
export function assertExportKeysAreValid(sampleUserId: string): void {
  const key = ExportKeys.archive(sampleUserId);
  if (!isValidStorageKey(key) || !isValidStoragePrefix(ExportPrefixes.ofUser(sampleUserId))) {
    throw new Error(
      `The export key layout is not accepted by @library/storage: "${key}". ` +
        'Fix the layout here, or move the builder into storage-key.builder.ts (§3.3).',
    );
  }
}
