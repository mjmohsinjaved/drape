'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { isApiError, queryKeys, type Uuid } from '@repo/api-client';

import {
  createGarmentImage,
  createUploadTicket,
  redeemUploadTicket,
} from '@/features/catalog/api/endpoints';
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  MAX_GARMENT_IMAGE_BYTES,
  type GarmentImageWithQuality,
  type ImageQualityReport,
} from '@/features/catalog/types/admin-catalog';

/**
 * A-9 — drag-and-drop, many files, **a progress row per file**.
 *
 * The three §3.5 steps run per file, which is why the console can draw one bar each:
 *
 *   1. `POST /files/upload-ticket` — declare the type and size, receive a signed `uploadUrl`.
 *   2. `PUT <uploadUrl>` — stream the bytes. This is the only step with real progress.
 *   3. `POST /admin/garments/:id/images` — hand the key back, which creates the row and, for a
 *      try-on source, runs the A-10 validator.
 *
 * Files are processed **one at a time**. Both file routes are rate-limited to 20 requests a
 * minute (§5.22) and a ten-file drop is twenty requests; firing them in parallel would turn a
 * successful upload into a `RATE_LIMIT_EXCEEDED` on the last two. Serial also makes gallery
 * position deterministic, so what the admin dropped is the order they get.
 *
 * A failure belongs to its own row, keeps its own message and keeps its own retry — never one
 * opaque result for the batch (D-16).
 */

export type UploadRowStatus = 'queued' | 'uploading' | 'finalising' | 'done' | 'error';

export interface UploadRow {
  /** Client-side id, stable for the life of the row. */
  id: string;
  file: File;
  name: string;
  size: number;
  /** 0–100, from the `PUT`. */
  progress: number;
  status: UploadRowStatus;
  /** An `ErrorCode`, mapped to copy by the caller — never a raw message. */
  errorCode?: string;
  /** `URL.createObjectURL` of the local file, revoked when the row is dropped. */
  previewUrl: string;
  /** Set once step 3 has run. */
  imageId?: Uuid;
  /** Set when the finalised image was the try-on source, so A-10 ran (§5.7). */
  quality?: ImageQualityReport;
}

export interface UseImageUploaderOptions {
  garmentId: Uuid;
  /**
   * Whether the garment already has a try-on source. The first accepted file of a drop claims
   * the role when it does not — a garment with images and no source cannot be published (A-9,
   * `TRYON_SOURCE_REQUIRED`), so leaving it unset would be a trap.
   */
  hasTryOnSource: boolean;
  /** Called with the A-10 verdict whenever a try-on source is finalised. */
  onQualityReport?: (report: ImageQualityReport) => void;
}

export interface UseImageUploaderResult {
  rows: UploadRow[];
  addFiles: (files: File[]) => void;
  retryRow: (rowId: string) => void;
  removeRow: (rowId: string) => void;
  /** Drops every finished row, leaving anything still in flight. */
  clearFinished: () => void;
  isUploading: boolean;
}

function isQualityWrapped(
  value: GarmentImageWithQuality | { id: Uuid },
): value is GarmentImageWithQuality {
  return 'image' in value && 'quality' in value;
}

/** Client-side refusals reuse the API's own codes so one copy table covers both (D-7). */
function localRejection(file: File): string | null {
  if (!ACCEPTED_IMAGE_MIME_TYPES.includes(file.type)) return 'IMAGE_FORMAT_UNSUPPORTED';
  if (file.size > MAX_GARMENT_IMAGE_BYTES) return 'IMAGE_TOO_LARGE';
  return null;
}

let rowCounter = 0;

export function useGarmentImageUploader({
  garmentId,
  hasTryOnSource,
  onQualityReport,
}: UseImageUploaderOptions): UseImageUploaderResult {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<UploadRow[]>([]);

  // The queue and the "a file is in flight" flag are refs: they drive an async loop, and a
  // re-render must never restart it.
  const queueRef = useRef<string[]>([]);
  const runningRef = useRef(false);
  const rowsRef = useRef<UploadRow[]>([]);
  const hasSourceRef = useRef(hasTryOnSource);
  const mountedRef = useRef(true);

  rowsRef.current = rows;
  hasSourceRef.current = hasTryOnSource;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const row of rowsRef.current) URL.revokeObjectURL(row.previewUrl);
    };
  }, []);

  const patchRow = useCallback((rowId: string, patch: Partial<UploadRow>): void => {
    if (!mountedRef.current) return;
    setRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }, []);

  const uploadOne = useCallback(
    async (rowId: string): Promise<void> => {
      const row = rowsRef.current.find((candidate) => candidate.id === rowId);
      if (!row) return;

      const rejection = localRejection(row.file);
      if (rejection) {
        patchRow(rowId, { status: 'error', errorCode: rejection, progress: 0 });
        return;
      }

      patchRow(rowId, { status: 'uploading', progress: 0, errorCode: undefined });

      try {
        const ticket = await createUploadTicket({
          purpose: 'GARMENT_IMAGE',
          contentType: row.file.type,
          byteSize: row.file.size,
          ownerId: garmentId,
        });

        const uploaded = await redeemUploadTicket(ticket, row.file, {
          onProgress: (percent) => {
            patchRow(rowId, { progress: percent });
          },
        });

        patchRow(rowId, { status: 'finalising', progress: 100 });

        // The first file of a drop claims the try-on role when the garment has none.
        const claimSource = !hasSourceRef.current;
        const finalised = await createGarmentImage(garmentId, {
          key: uploaded.key,
          isTryOnSource: claimSource,
        });

        if (isQualityWrapped(finalised)) {
          hasSourceRef.current = true;
          patchRow(rowId, {
            status: 'done',
            imageId: finalised.image.id,
            quality: finalised.quality,
          });
          onQualityReport?.(finalised.quality);
        } else {
          if (claimSource) hasSourceRef.current = true;
          patchRow(rowId, { status: 'done', imageId: finalised.id });
        }

        void queryClient.invalidateQueries({ queryKey: queryKeys.garments.images(garmentId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.garments.detail(garmentId) });
      } catch (error: unknown) {
        patchRow(rowId, {
          status: 'error',
          errorCode: isApiError(error) ? error.errorCode : 'UNKNOWN_ERROR',
        });
      }
    },
    [garmentId, onQualityReport, patchRow, queryClient],
  );

  const drain = useCallback((): void => {
    if (runningRef.current) return;
    runningRef.current = true;

    void (async () => {
      let next = queueRef.current.shift();
      while (next !== undefined) {
        await uploadOne(next);
        next = queueRef.current.shift();
      }
      runningRef.current = false;
    })();
  }, [uploadOne]);

  const addFiles = useCallback(
    (files: File[]): void => {
      if (files.length === 0) return;

      const created = files.map<UploadRow>((file) => {
        rowCounter += 1;
        return {
          id: `upload-${String(rowCounter)}`,
          file,
          name: file.name,
          size: file.size,
          progress: 0,
          status: 'queued',
          previewUrl: URL.createObjectURL(file),
        };
      });

      setRows((current) => [...current, ...created]);
      rowsRef.current = [...rowsRef.current, ...created];
      queueRef.current.push(...created.map((row) => row.id));
      drain();
    },
    [drain],
  );

  const retryRow = useCallback(
    (rowId: string): void => {
      patchRow(rowId, { status: 'queued', progress: 0, errorCode: undefined });
      queueRef.current.push(rowId);
      drain();
    },
    [drain, patchRow],
  );

  const removeRow = useCallback((rowId: string): void => {
    queueRef.current = queueRef.current.filter((id) => id !== rowId);
    setRows((current) => {
      const target = current.find((row) => row.id === rowId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((row) => row.id !== rowId);
    });
  }, []);

  const clearFinished = useCallback((): void => {
    setRows((current) => {
      for (const row of current) {
        if (row.status === 'done') URL.revokeObjectURL(row.previewUrl);
      }
      return current.filter((row) => row.status !== 'done');
    });
  }, []);

  const isUploading = rows.some(
    (row) => row.status === 'queued' || row.status === 'uploading' || row.status === 'finalising',
  );

  return { rows, addFiles, retryRow, removeRow, clearFinished, isUploading };
}
