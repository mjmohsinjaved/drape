/**
 * `files` — ARCHITECTURE.md §5.20, §3.4 and §3.5.
 *
 * Two of the three routes are here. The third, `GET /files/:token`, is deliberately absent: it
 * streams **binary, not an envelope**, and the client never calls it through axios — it puts the
 * URL in an `<img src>` or an anchor. A typed function for it would invite exactly the wrong thing.
 */

import { apiClient } from '../axios-instance';

import { post, type EndpointOptions } from './http';

import type { CreateUploadTicketRequest, UploadResult, UploadTicket } from '../types/files';

export const UPLOAD_TICKET_HEADER = 'X-Upload-Ticket';

export const filePaths = {
  uploadTicket: '/files/upload-ticket',
  /** `PUT /files/upload`. Normally you PUT to `UploadTicket.uploadUrl` instead. */
  upload: '/files/upload',
} as const;

export async function createUploadTicket(
  body: CreateUploadTicketRequest,
  options?: EndpointOptions,
): Promise<UploadTicket> {
  return post<UploadTicket, CreateUploadTicketRequest>(filePaths.uploadTicket, body, options);
}

export async function uploadFileBytes(
  ticket: UploadTicket,
  file: Blob,
  options: EndpointOptions = {},
): Promise<UploadResult> {
  const response = await (options.client ?? apiClient).put<UploadResult>(ticket.uploadUrl, file, {
    headers: { [UPLOAD_TICKET_HEADER]: ticket.ticket, 'Content-Type': ticket.contentType },
    signal: options.signal,
  });
  return response.data;
}
