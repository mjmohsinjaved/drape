'use client';

import { useCallback, useState } from 'react';

import { isApiError, type Uuid } from '@repo/api-client';

import { createUploadTicket, redeemUploadTicket } from '@/features/catalog/api/endpoints';
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  MAX_CATEGORY_COVER_BYTES,
} from '@/features/catalog/types/admin-catalog';

/**
 * A-6 — the category cover image.
 *
 * The §3.5 flow again, minus the gallery: ticket, bytes, then the key goes to
 * `PATCH /admin/categories/:id` as `coverImageKey`. A cover therefore needs an existing category
 * to hang from, because `CATEGORY_COVER` tickets are scoped to an `ownerId` — which is why the
 * create dialog does not offer one and the edit dialog does.
 *
 * The upload-ticket routes live in the catalog feature because that is where the garment
 * uploader needed them first; they are the same two API calls, not a second implementation.
 */

export type CoverUploadStatus = 'idle' | 'uploading' | 'error';

export interface UseCategoryCoverResult {
  status: CoverUploadStatus;
  /** 0–100 while the bytes are going out. */
  progress: number;
  /** An `ErrorCode`, for the caller to translate. Never a raw message. */
  errorCode: string | null;
  /** Uploads the file and resolves with the storage key to send as `coverImageKey`. */
  upload: (categoryId: Uuid, file: File) => Promise<string | null>;
  reset: () => void;
}

export function useCategoryCoverUpload(): UseCategoryCoverResult {
  const [status, setStatus] = useState<CoverUploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const reset = useCallback((): void => {
    setStatus('idle');
    setProgress(0);
    setErrorCode(null);
  }, []);

  const upload = useCallback(async (categoryId: Uuid, file: File): Promise<string | null> => {
    // Refused locally, with the API's own codes so one copy table covers both (D-7).
    if (!ACCEPTED_IMAGE_MIME_TYPES.includes(file.type)) {
      setStatus('error');
      setErrorCode('IMAGE_FORMAT_UNSUPPORTED');
      return null;
    }
    if (file.size > MAX_CATEGORY_COVER_BYTES) {
      setStatus('error');
      setErrorCode('IMAGE_TOO_LARGE');
      return null;
    }

    setStatus('uploading');
    setProgress(0);
    setErrorCode(null);

    try {
      const ticket = await createUploadTicket({
        purpose: 'CATEGORY_COVER',
        contentType: file.type,
        byteSize: file.size,
        ownerId: categoryId,
      });
      const result = await redeemUploadTicket(ticket, file, { onProgress: setProgress });
      setStatus('idle');
      setProgress(100);
      return result.key;
    } catch (error: unknown) {
      setStatus('error');
      setErrorCode(isApiError(error) ? error.errorCode : 'UNKNOWN_ERROR');
      return null;
    }
  }, []);

  return { status, progress, errorCode, upload, reset };
}
