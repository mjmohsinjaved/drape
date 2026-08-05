import { Injectable, Logger } from '@nestjs/common';

import { ErrorCode, StorageException, type ICurrentUser } from '@library/common';
import { ImageService, SignedUrlService, StorageService } from '@library/storage';

import { policyForKey } from '../constants/upload-purposes.constant';
import { UploadResultResponseDto } from '../dto/upload-ticket-response.dto';
import { guardUploadStream } from '../utils/upload-guard.stream';

import type { Readable } from 'node:stream';

/**
 * `PUT /api/v1/files/upload/:ticket` — ARCHITECTURE §3.5 step 2.
 *
 * "Streamed straight to disk with no buffering of the whole file and a hard `maxBytes`
 * cut-off." This is the only route in the application through which bytes enter, so it is worth
 * being explicit about the order things happen in and why:
 *
 * 1. **the ticket is verified first** — signature, expiry, and subject. A ticket issued to one
 *    account cannot be redeemed by another, so a leaked upload URL is not a write primitive
 *    against somebody else's prefix (PRD §9.2);
 * 2. **the request's own `Content-Type` and `Content-Length` are never read.** Both are
 *    client-supplied. The type and the ceiling come out of the signed ticket;
 * 3. **the stream is guarded before it reaches storage** — magic bytes against the ticket's
 *    declared type, running byte count against the ticket's ceiling, both mid-flight
 *    (`upload-guard.stream.ts`);
 * 4. **the bytes go to `StorageService`**, which re-applies its own ceiling and hands the driver
 *    a stream. The driver writes to `<root>/.tmp/<uuid>`, fsyncs, re-checks the magic bytes and
 *    only then renames into place — so a rejection at any step leaves no object and no temp
 *    file (§3.2 requirement 4);
 * 5. **a person photo is re-encoded** to strip EXIF before it is readable (PRD C-15, §3.6). If
 *    that re-encode fails the object is **deleted**, not kept: a photo whose metadata we cannot
 *    prove we removed must not survive in storage.
 */
@Injectable()
export class FileUploadService {
  private readonly logger = new Logger(FileUploadService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly signedUrls: SignedUrlService,
    private readonly images: ImageService,
  ) {}

  /**
   * @param ticket the opaque token from the URL
   * @param body   the raw request stream — never a parsed body, never a buffer
   * @param actor  the session presenting the ticket, or `undefined` when there is none
   */
  async redeem(
    ticket: string,
    body: Readable,
    actor: ICurrentUser | undefined,
  ): Promise<UploadResultResponseDto> {
    // Step 1. Throws UPLOAD_TICKET_INVALID / UPLOAD_TICKET_EXPIRED. A missing session presents
    // an empty subject, which cannot match a signed one — so an unauthenticated redemption of
    // somebody's ticket fails here, before a byte is read.
    const payload = this.signedUrls.verifyUploadTicket(ticket, { subject: actor?.id ?? '' });

    const policy = policyForKey(payload.key);
    if (policy === null) {
      // A signed ticket for a prefix no purpose owns means the secret leaked or a builder
      // changed. Either way nothing gets written.
      this.logger.warn('Refused an upload ticket whose key belongs to no upload purpose.');
      throw new StorageException(ErrorCode.UPLOAD_TICKET_INVALID);
    }

    // Steps 3 and 4.
    const stored = await this.storage.redeemUploadTicket(
      ticket,
      guardUploadStream(body, {
        maxBytes: payload.maxBytes,
        declaredContentType: payload.contentType,
        allowedContentTypes: policy.contentTypes,
      }),
      actor?.id ?? '',
    );

    // Step 5.
    const byteSize = policy.stripExif
      ? await this.sanitise(stored.key, stored.mimeType)
      : stored.size;

    const response = new UploadResultResponseDto();
    response.key = stored.key;
    response.byteSize = byteSize;
    response.contentType = stored.mimeType;
    return response;
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * PRD C-15 / §3.6 — "every `person-photos/**` write is re-encoded … orientation is applied,
   * all other metadata dropped. Applied server-side even though the client also strips."
   *
   * Re-encoding needs the whole image, which is why it happens **after** the streamed write
   * rather than in the middle of it: the stream stays a stream, and the decode works against a
   * file whose size the ceiling has already bounded.
   *
   * A failure here deletes the object. The alternative — keeping a photograph that may still
   * carry the GPS coordinates of somebody's home because our decoder could not read the
   * container — is not a trade this product makes.
   */
  private async sanitise(key: string, contentType: string): Promise<number> {
    try {
      const original = await this.storage.getBuffer(key);
      const stripped = await this.images.stripExif(original);
      const rewritten = await this.storage.put(key, stripped, {
        contentType,
        failIfExists: false,
      });
      return rewritten.size;
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      this.logger.warn(
        'Removed an uploaded photo whose metadata could not be stripped. Nothing was kept.',
      );
      throw error;
    }
  }
}
