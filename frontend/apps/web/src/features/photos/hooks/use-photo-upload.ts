'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createUploadTicket,
  finalisePhoto,
  redeemUploadTicket,
} from '@/features/photos/api/endpoints';
import { preparePhotoForUpload } from '@/features/photos/lib/compress';
import { validatePhoto, type PhotoValidationResult } from '@/features/photos/lib/validate-photo';
import { resolveErrorCode } from '@/features/tryon/lib/error-copy';

import type { PersonPhoto } from '@/features/photos/api/types';

export type UploadPhase =
  | 'idle'
  | 'checking'
  | 'reviewing'
  | 'preparing'
  | 'uploading'
  | 'finalising'
  | 'saved'
  | 'error';

export interface PhotoUploadState {
  phase: UploadPhase;
  /** Local object URL for the preview. Revoked whenever the selection changes or unmounts. */
  previewUrl: string | null;
  validation: PhotoValidationResult | null;
  /** 0–100, from the `PUT` in step 2. */
  progress: number;
  /** An `ErrorCode`. Mapped to copy by the component, never displayed raw. */
  errorCode: string | null;
  saved: PersonPhoto | null;
}

export interface UsePhotoUploadResult extends PhotoUploadState {
  select: (file: File) => void;
  upload: (options: { label?: string; activate: boolean }) => void;
  clear: () => void;
}

/**
 * The C-14 / C-15 upload pipeline.
 *
 * Five steps, in this order, and the order is the point:
 *
 *   1. **Validate locally** — before a single byte leaves the device. A rejection here costs her
 *      nothing and names exactly what to change (C-14).
 *   2. **Let her review** — the checks are shown, passed and failed alike, next to a preview.
 *      Nothing uploads until she says so.
 *   3. **Compress and strip EXIF** — the canvas re-encode, which removes GPS, device identity
 *      and the embedded original thumbnail along with everything else (C-15).
 *   4. **Ticket, then `PUT` straight at storage** — never through the web server (C-15, B-9).
 *   5. **Finalise** — hand the key back so the API probes, hashes and moderates it.
 *
 * The object URL is revoked on every change and on unmount; a preview left behind pins the whole
 * decoded image in memory, which on a mid-range Android is the difference between smooth and
 * not.
 */
export function usePhotoUpload(): UsePhotoUploadResult {
  const [state, setState] = useState<PhotoUploadState>({
    phase: 'idle',
    previewUrl: null,
    validation: null,
    progress: 0,
    errorCode: null,
    saved: null,
  });

  const fileRef = useRef<File | null>(null);
  const previewRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (previewRef.current !== null) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const patch = useCallback((next: Partial<PhotoUploadState>): void => {
    if (!mountedRef.current) return;
    setState((current) => ({ ...current, ...next }));
  }, []);

  const clear = useCallback((): void => {
    if (previewRef.current !== null) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    fileRef.current = null;
    setState({
      phase: 'idle',
      previewUrl: null,
      validation: null,
      progress: 0,
      errorCode: null,
      saved: null,
    });
  }, []);

  const select = useCallback(
    (file: File): void => {
      if (previewRef.current !== null) URL.revokeObjectURL(previewRef.current);
      const previewUrl = URL.createObjectURL(file);
      previewRef.current = previewUrl;
      fileRef.current = file;

      setState({
        phase: 'checking',
        previewUrl,
        validation: null,
        progress: 0,
        errorCode: null,
        saved: null,
      });

      void validatePhoto(file)
        .then((validation) => {
          patch({ phase: 'reviewing', validation });
        })
        .catch(() => {
          // The validator itself failed — a decode that threw outside its own guard. Treat it
          // as the same actionable "we couldn't open this file" rather than a system error.
          patch({
            phase: 'reviewing',
            validation: {
              passed: false,
              dimensions: null,
              results: [{ check: 'DECODE', passed: false, messageKey: 'fail' }],
            },
          });
        });
    },
    [patch],
  );

  const upload = useCallback(
    ({ label, activate }: { label?: string; activate: boolean }): void => {
      const file = fileRef.current;
      if (file === null) return;

      patch({ phase: 'preparing', progress: 0, errorCode: null });

      void (async () => {
        try {
          const prepared = await preparePhotoForUpload(file);
          if (prepared === null) {
            patch({ phase: 'error', errorCode: 'IMAGE_CORRUPT' });
            return;
          }

          const ticket = await createUploadTicket({
            purpose: 'PERSON_PHOTO',
            contentType: prepared.file.type,
            byteSize: prepared.file.size,
          });

          patch({ phase: 'uploading', progress: 0 });

          const uploaded = await redeemUploadTicket(ticket, prepared.file, {
            onProgress: (percent) => {
              patch({ progress: percent });
            },
          });

          patch({ phase: 'finalising', progress: 100 });

          const saved = await finalisePhoto({
            key: uploaded.key,
            label: label === undefined || label.trim() === '' ? undefined : label.trim(),
            activate,
          });

          patch({ phase: 'saved', saved });
        } catch (error: unknown) {
          patch({ phase: 'error', errorCode: resolveErrorCode(error) });
        }
      })();
    },
    [patch],
  );

  return { ...state, select, upload, clear };
}
