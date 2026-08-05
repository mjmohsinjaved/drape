/**
 * ARCHITECTURE §3.5 step 2 — "streamed straight to disk with no buffering of the whole file and
 * a hard `maxBytes` cut-off", and §3.2 requirement 9 — "content type is validated against the
 * magic bytes of the buffer, not the client-supplied header".
 *
 * Both of those are enforced **here, mid-flight**, before the bytes reach `StorageService`:
 *
 *  - the byte counter throws the moment the running total passes the ticket's ceiling, so a
 *    client that lied about `byteSize` cannot fill the volume by simply continuing to send. A
 *    check performed after the write is not a limit, it is a report;
 *  - the first 256 bytes are sniffed and compared with what the **ticket** committed to, not
 *    with the `Content-Type` header on the request. The header is client-supplied and therefore
 *    evidence of nothing; the ticket is HMAC-signed by us.
 *
 * The generator throws rather than emitting an error event, which matters: `LocalDiskDriver.put`
 * consumes it inside a `try` that unlinks `<root>/.tmp/<uuid>` and never renames into place, so
 * a rejected upload leaves nothing behind — not a partial object, not a temp file, not a `.meta`
 * sidecar.
 *
 * This is deliberately a free function over a `Readable`. It is the single most security-load-
 * bearing loop in the application, and a pure function is one a unit test can starve, overfeed
 * and lie to without standing up an HTTP server.
 */
import { Readable } from 'node:stream';

import {
  imageFormatUnsupported,
  imageTooLarge,
  isAllowedUploadMimeType,
  mimeTypesMatch,
  normaliseMimeType,
  sniffMimeType,
} from '@library/storage';

/** Enough for every signature `sniffMimeType` knows, including the SVG text probe. */
export const SNIFF_BYTES = 256;

export interface UploadGuardOptions {
  /** The ticket's ceiling. Never the `Content-Length` header. */
  readonly maxBytes: number;
  /** The content type the ticket committed to. */
  readonly declaredContentType: string;
  /**
   * The purpose's accepted formats. A type that sniffs cleanly but is not on this list is still
   * rejected — the allow-list is per purpose, not global.
   */
  readonly allowedContentTypes?: readonly string[];
}

/**
 * Wraps `source` so that it can only ever yield bytes that are within the ceiling and of the
 * declared type.
 *
 * Throws `IMAGE_TOO_LARGE` on overrun and `IMAGE_FORMAT_UNSUPPORTED` on a magic-byte mismatch,
 * an unaccepted type, or a head too short to identify at all.
 */
export function guardUploadStream(source: Readable, options: UploadGuardOptions): Readable {
  return Readable.from(guardedChunks(source, options));
}

/** The loop itself, exposed so a test can drive it without a stream wrapper. */
export async function* guardedChunks(
  source: AsyncIterable<Buffer | string>,
  options: UploadGuardOptions,
): AsyncGenerator<Buffer> {
  const maxBytes = options.maxBytes;
  const maxMb = Math.max(1, Math.round(maxBytes / (1024 * 1024)));

  let total = 0;
  let head = Buffer.alloc(0);
  let sniffed = false;

  for await (const raw of source) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

    total += chunk.byteLength;
    if (total > maxBytes) {
      // Mid-stream, before this chunk is handed on. The socket is torn down by the framework
      // when the handler rejects; nothing further is written.
      throw imageTooLarge(maxMb);
    }

    if (!sniffed) {
      head = Buffer.concat([head, chunk.subarray(0, SNIFF_BYTES - head.length)]);
      if (head.length >= SNIFF_BYTES) {
        assertDeclaredTypeMatchesBytes(head, options);
        sniffed = true;
      }
    }

    yield chunk;
  }

  // A file shorter than the sniff window still has to identify itself. An empty body cannot.
  if (!sniffed) {
    assertDeclaredTypeMatchesBytes(head, options);
  }
}

/**
 * §3.2 requirement 9. Three ways to fail, one error code: the bytes match nothing we accept,
 * they match something outside this purpose's allow-list, or they contradict the ticket.
 *
 * `details` never carries the key, the token or the filename — §3.4 keeps storage keys off the
 * wire and E-12 keeps them out of logs.
 */
function assertDeclaredTypeMatchesBytes(head: Buffer, options: UploadGuardOptions): void {
  const declared = normaliseMimeType(options.declaredContentType);
  const detected = sniffMimeType(head);

  if (detected === null) {
    throw imageFormatUnsupported({ declared });
  }

  const allowed = options.allowedContentTypes;
  const permitted =
    allowed === undefined
      ? isAllowedUploadMimeType(detected)
      : allowed.some((candidate) => mimeTypesMatch(candidate, detected));

  if (!permitted || !mimeTypesMatch(detected, declared)) {
    throw imageFormatUnsupported({ declared, detected });
  }
}
