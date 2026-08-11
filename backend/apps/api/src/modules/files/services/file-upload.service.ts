import { Injectable, Logger } from '@nestjs/common';

import { ErrorCode, StorageException, type ICurrentUser } from '@library/common';
import { ImageService, SignedUrlService, StorageService } from '@library/storage';

import { policyForKey } from '../constants/upload-purposes.constant';
import { UploadResultResponseDto } from '../dto/upload-ticket-response.dto';
import { guardUploadStream } from '../utils/upload-guard.stream';

import type { Readable } from 'node:stream';

@Injectable()
export class FileUploadService {
  private readonly logger = new Logger(FileUploadService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly signedUrls: SignedUrlService,
    private readonly images: ImageService,
  ) {}

  async redeem(
    ticket: string | undefined,
    body: Readable,
    actor: ICurrentUser | undefined,
  ): Promise<UploadResultResponseDto> {
    if (ticket === undefined || ticket === '') {
      throw new StorageException(ErrorCode.UPLOAD_TICKET_INVALID);
    }
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
