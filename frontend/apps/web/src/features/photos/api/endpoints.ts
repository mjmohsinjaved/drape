import { apiClient } from '@repo/api-client';

import type {
  CreateUploadTicketBody,
  FinalisePhotoBody,
  PersonPhoto,
  RenamePhotoBody,
  UploadResult,
  UploadTicket,
} from '@/features/photos/api/types';

/**
 * Person-photo and upload calls — ARCHITECTURE §5.9, §5.20, §3.5.
 *
 * The three-step upload (C-15) is deliberately three calls, not one:
 *
 *   1. `POST /files/upload-ticket` — declare the type and size, receive a signed `uploadUrl`.
 *   2. `PUT <uploadUrl>` — **stream the bytes straight at storage**. This never touches the
 *      Next.js server; there is no route handler in the web app and no proxy (B-9, C-15).
 *   3. `POST /person-photos` — hand the key back, which probes, hashes and moderates it.
 *
 * Step 2 is the only one with real progress, which is what the upload bar reports.
 */

export const photoPaths = {
  list: '/person-photos',
  photo: (photoId: string): string => `/person-photos/${encodeURIComponent(photoId)}`,
  activate: (photoId: string): string => `/person-photos/${encodeURIComponent(photoId)}/activate`,
  uploadTicket: '/files/upload-ticket',
} as const;

export async function listPhotos(signal?: AbortSignal): Promise<PersonPhoto[]> {
  const response = await apiClient.get<PersonPhoto[]>(photoPaths.list, { signal });
  return response.data;
}

export async function createUploadTicket(body: CreateUploadTicketBody): Promise<UploadTicket> {
  const response = await apiClient.post<UploadTicket>(photoPaths.uploadTicket, body);
  return response.data;
}

export interface RedeemTicketOptions {
  /** 0–100, emitted as the bytes go out — this is what draws the C-15 progress bar. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * Step 2. `uploadUrl` is absolute, so axios ignores the instance `baseURL`. The `Content-Type`
 * has to be the ticket's, because the API matches it against the file's magic bytes and refuses
 * a mismatch (§3.2 requirement 9).
 */
export async function redeemUploadTicket(
  ticket: UploadTicket,
  file: File,
  options: RedeemTicketOptions = {},
): Promise<UploadResult> {
  const response = await apiClient.put<UploadResult>(ticket.uploadUrl, file, {
    headers: { 'Content-Type': ticket.contentType },
    signal: options.signal,
    onUploadProgress: (event) => {
      if (!options.onProgress) return;
      const total = event.total ?? file.size;
      if (total <= 0) return;
      options.onProgress(Math.min(100, Math.round((event.loaded / total) * 100)));
    },
  });
  return response.data;
}

export async function finalisePhoto(body: FinalisePhotoBody): Promise<PersonPhoto> {
  const response = await apiClient.post<PersonPhoto>(photoPaths.list, body);
  return response.data;
}

export async function activatePhoto(photoId: string): Promise<PersonPhoto> {
  const response = await apiClient.post<PersonPhoto>(photoPaths.activate(photoId));
  return response.data;
}

export async function renamePhoto(photoId: string, body: RenamePhotoBody): Promise<PersonPhoto> {
  const response = await apiClient.patch<PersonPhoto>(photoPaths.photo(photoId), body);
  return response.data;
}

/** `204 No Content`. Renders generated from this photo survive (C-16, C-28). */
export async function deletePhoto(photoId: string): Promise<void> {
  await apiClient.delete<void>(photoPaths.photo(photoId));
}
