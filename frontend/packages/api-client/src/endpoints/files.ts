/**
 * `files` — ARCHITECTURE.md §5.20, §3.4 and §3.5.
 *
 * Two of the three routes are here. The third, `GET /files/:token`, is deliberately absent: it
 * streams **binary, not an envelope**, and the client never calls it through axios — it puts the
 * URL in an `<img src>` or an anchor. A typed function for it would invite exactly the wrong thing.
 */

import { post, put, type EndpointOptions } from './http';

import type { CreateUploadTicketRequest, UploadResult, UploadTicket } from '../types/files';

export const filePaths = {
  uploadTicket: '/files/upload-ticket',
  /** `PUT /files/upload/:ticket`. Normally you PUT to `UploadTicket.uploadUrl` instead. */
  upload: (ticket: string): string => `/files/upload/${ticket}`,
} as const;

/**
 * `POST /files/upload-ticket` (ADMIN, CONSUMER) — step 1 of §3.5.
 *
 * The purpose is authorised against the role: a consumer asking for a `GARMENT_IMAGE` ticket is
 * refused, and so is an admin asking for a `PERSON_PHOTO` one — an admin has no route to a
 * consumer's photo at all (S-10).
 */
export async function createUploadTicket(
  body: CreateUploadTicketRequest,
  options?: EndpointOptions,
): Promise<UploadTicket> {
  return post<UploadTicket, CreateUploadTicketRequest>(filePaths.uploadTicket, body, options);
}

/**
 * Step 2 of §3.5 — send the bytes to the URL the ticket named.
 *
 * `uploadUrl` comes straight off {@link UploadTicket} and already carries the signed ticket, so
 * this takes the URL rather than rebuilding a path. It is passed to axios as an absolute URL when
 * the driver is direct-to-bucket, and as a same-origin path otherwise; axios honours both.
 *
 * The declared `Content-Type` is checked against the file's magic bytes on the server. A mismatch
 * is refused — the client cannot talk its way past the check by relabelling.
 */
export async function uploadFileBytes(
  uploadUrl: string,
  file: Blob,
  options?: EndpointOptions,
): Promise<UploadResult> {
  return put<UploadResult, Blob>(uploadUrl, file, options);
}
