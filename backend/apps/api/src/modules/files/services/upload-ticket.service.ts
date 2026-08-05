import { Injectable, Logger } from '@nestjs/common';

import {
  ErrorCode,
  ForbiddenException,
  StorageException,
  ValidationException,
  type ICurrentUser,
} from '@library/common';
import {
  extForMimeType,
  isValidStorageKey,
  normaliseMimeType,
  StorageService,
  type RasterImageExt,
} from '@library/storage';

import {
  UPLOAD_PURPOSE_POLICIES,
  type UploadPurposePolicy,
} from '../constants/upload-purposes.constant';
import { UploadTicketResponseDto } from '../dto/upload-ticket-response.dto';

import type { CreateUploadTicketDto } from '../dto/create-upload-ticket.dto';

/**
 * `POST /api/v1/files/upload-ticket` — ARCHITECTURE §3.5 step 1.
 *
 * "The API authorises the purpose against the caller's role, builds the key, and returns an
 * `UploadTicket`." Four things happen here and nothing else does:
 *
 * 1. **the purpose is authorised against the role.** A consumer asking for a `GARMENT_IMAGE`
 *    ticket is refused, and so is an admin asking for a `PERSON_PHOTO` one — an admin has no
 *    business writing into `person-photos/` any more than reading out of it (S-10);
 * 2. **the owner is resolved server-side.** `PERSON_PHOTO` is filed under the caller's own id
 *    whatever `ownerId` said, so a consumer cannot obtain a ticket that writes into another
 *    consumer's prefix (PRD §9.2);
 * 3. **the extension comes from the declared MIME type**, through the closed map in
 *    `storage-key.builder.ts`. No filename is accepted, so there is no filename to sanitise;
 * 4. **the ceiling is the lower of what was asked for and what the purpose allows**, and
 *    `StorageService` clamps it again to `STORAGE_MAX_UPLOAD_MB`.
 *
 * The ticket that comes back is subject-scoped: only the account that asked for it can redeem
 * it, and only until it expires.
 */
@Injectable()
export class UploadTicketService {
  private readonly logger = new Logger(UploadTicketService.name);

  constructor(private readonly storage: StorageService) {}

  async issue(dto: CreateUploadTicketDto, actor: ICurrentUser): Promise<UploadTicketResponseDto> {
    const policy = UPLOAD_PURPOSE_POLICIES[dto.purpose];

    this.assertRoleMayUse(policy, actor);

    const contentType = this.assertAcceptedContentType(policy, dto.contentType);
    const ext = this.extensionFor(contentType);
    const ownerId = this.resolveOwnerId(policy, dto, actor);

    const key = policy.buildKey(ownerId, ext);
    this.assertBuiltKeyIsSound(policy, key, ownerId);

    const maxBytes = Math.min(dto.byteSize, policy.maxBytes);
    const ticket = await this.storage.createUploadTicket({
      key,
      contentType,
      subject: actor.id,
      maxBytes,
    });

    const response = new UploadTicketResponseDto();
    response.uploadUrl = ticket.uploadUrl;
    response.key = ticket.key;
    response.fields = ticket.fields;
    response.expiresAt = ticket.expiresAt;
    response.isDirect = ticket.isDirect;
    response.purpose = policy.purpose;
    response.maxBytes = maxBytes;
    response.contentType = contentType;
    return response;
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * §3.5 step 1. `INSUFFICIENT_ROLE` rather than a 404: the purpose vocabulary is public and
   * documented, so there is nothing to conceal by pretending it does not exist.
   */
  private assertRoleMayUse(policy: UploadPurposePolicy, actor: ICurrentUser): void {
    if (!policy.roles.includes(actor.role)) {
      throw new ForbiddenException(ErrorCode.INSUFFICIENT_ROLE, {
        details: { purpose: policy.purpose },
      });
    }
  }

  private assertAcceptedContentType(policy: UploadPurposePolicy, requested: string): string {
    const contentType = normaliseMimeType(requested);
    if (!policy.contentTypes.includes(contentType)) {
      throw new ValidationException(ErrorCode.IMAGE_FORMAT_UNSUPPORTED, {
        details: { declared: contentType, purpose: policy.purpose },
      });
    }
    return contentType;
  }

  /** The closed MIME → extension map (§3.3). `svg` never reaches here — no policy accepts it. */
  private extensionFor(contentType: string): RasterImageExt {
    const ext = extForMimeType(contentType);
    if (ext === null || ext === 'svg') {
      throw new ValidationException(ErrorCode.IMAGE_FORMAT_UNSUPPORTED, {
        details: { declared: contentType },
      });
    }
    return ext;
  }

  /**
   * `SELF` ignores the client entirely. `GARMENT`/`CATEGORY` require a uuid, which the owning
   * module re-checks at finalise — a ticket for a garment that does not exist writes an object
   * nobody ever claims, and the §3.5 step 4 sweep removes it after six hours.
   */
  private resolveOwnerId(
    policy: UploadPurposePolicy,
    dto: CreateUploadTicketDto,
    actor: ICurrentUser,
  ): string {
    switch (policy.owner) {
      case 'SELF':
        return actor.id;
      case 'NONE':
        return '';
      case 'GARMENT':
      case 'CATEGORY':
        if (dto.ownerId === undefined) {
          throw new ValidationException(ErrorCode.VALIDATION_ERROR, {
            errors: [
              {
                field: 'ownerId',
                message: `ownerId is required for a ${policy.purpose} upload.`,
                code: 'IS_DEFINED',
              },
            ],
          });
        }
        return dto.ownerId;
    }
  }

  /**
   * A built key is server-generated, so this can only fire on a programming error — a key
   * builder changed, or a policy points at the wrong prefix. Loud and early beats an object
   * landing somewhere nobody expects.
   */
  private assertBuiltKeyIsSound(policy: UploadPurposePolicy, key: string, ownerId: string): void {
    if (isValidStorageKey(key) && key.startsWith(policy.prefix(ownerId))) {
      return;
    }
    this.logger.error(
      `Built an unusable ${policy.purpose} key. Check the StorageKeys builder for this purpose.`,
    );
    throw new StorageException(ErrorCode.STORAGE_PATH_REJECTED);
  }
}
