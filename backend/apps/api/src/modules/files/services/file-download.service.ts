import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { ErrorCode, isAdmin, StorageException, type ICurrentUser } from '@library/common';
import { SignedUrlService, StorageService } from '@library/storage';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import type { Readable } from 'node:stream';

/** §3.4 — the blurred moderation thumbnail, the one private object an admin may read (A-34). */
const BLURRED_MODERATION_PREFIX = 'thumbnails/person-blurred/';

/** Everything `GET /files/:token` needs in order to answer. */
export interface ResolvedFile {
  readonly stream: Readable;
  readonly contentType: string;
  readonly byteSize: number;
  /** `private, max-age=…` for a subject-scoped object; `public, max-age=…` otherwise (§3.4/6). */
  readonly cacheControl: string;
}

/**
 * `GET /api/v1/files/:token` — ARCHITECTURE §3.4.
 *
 * Verification runs in the order the contract fixes, and `SignedUrlService` owns steps 1–4 so
 * the HMAC comparison stays constant-time and in one place. What is decided here is everything
 * that needs to know about *this request*: who is asking, whether the object exists, how it may
 * be cached, and whether the read is one A-34 requires an audit row for.
 *
 * ### Why the caching policy is what it is
 *
 * A render is one consumer's photograph of herself. It travels over a URL, and URLs get cached
 * — by the browser, by a corporate proxy, by a CDN nobody told us about. `private` is the
 * directive that means "one user's cache only, never a shared one", and it goes on **every**
 * subject-scoped object. `max-age` is the token's own remaining life, so a cache entry can
 * never outlive the authority that produced it. Public catalog imagery, which has no `sub` and
 * is the same for everybody, is `public` and cached properly — that is what keeps the C-9
 * catalog grid fast on 4G.
 */
@Injectable()
export class FileDownloadService {
  private readonly logger = new Logger(FileDownloadService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly signedUrls: SignedUrlService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * @param requester the session presenting the token, or `undefined` on an anonymous read.
   *        The route is `@Public()` because public assets exist; a `sub`-scoped token still
   *        requires a session whose id matches, which is what stops one consumer replaying
   *        another's render URL (PRD §9.2).
   */
  async open(token: string, requester: ICurrentUser | undefined): Promise<ResolvedFile> {
    // Steps 1–4: malformed → FILE_TOKEN_INVALID, bad HMAC → FILE_TOKEN_INVALID, past `exp` →
    // FILE_TOKEN_EXPIRED, wrong account → FILE_TOKEN_SUBJECT_MISMATCH.
    const payload = this.signedUrls.verify(token, { subject: requester?.id });

    // Step 5. `head` runs the key through `assertValidStorageKey` and `assertInsideRoot`
    // before it touches the filesystem (§3.2 requirements 2 and 3).
    const object = await this.storage.head(payload.key);
    if (object === null) {
      throw new StorageException(ErrorCode.FILE_NOT_FOUND);
    }

    this.auditModerationRead(payload.key, requester);

    const isPrivate = payload.sub !== undefined;
    const maxAge = isPrivate
      ? this.signedUrls.remainingTtlSeconds(payload)
      : this.storage.remainingTtlSeconds(payload);

    return {
      stream: await this.storage.get(payload.key),
      contentType: object.contentType,
      byteSize: object.byteSize,
      cacheControl: isPrivate
        ? // `private` keeps it out of every shared cache; `no-store` is not used because the
          // token already expires and a re-fetch on every scroll would defeat §9.1.
          `private, max-age=${maxAge}, must-revalidate`
        : `public, max-age=${maxAge}`,
    };
  }

  /**
   * A-34 / §3.4 step 4 — "every admin read of a blurred moderation thumbnail emits
   * `MODERATION_ITEM_VIEWED` to the audit log".
   *
   * Emitted, not written: audit rows are the `audit` module's `@OnEvent` listener's business
   * (§2.9 rule 4). The metadata carries no key and no consumer id — the reviewing admin's own
   * id is the token's subject, and that is what the row is about.
   */
  private auditModerationRead(key: string, requester: ICurrentUser | undefined): void {
    if (!key.startsWith(BLURRED_MODERATION_PREFIX) || requester === undefined) {
      return;
    }
    if (!isAdmin(requester.role)) {
      // Only an admin ever holds one of these tokens; if a consumer does, the subject check
      // already let it through because it was issued to her — log it and move on.
      this.logger.warn('A non-admin session read a blurred moderation thumbnail.');
      return;
    }

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.MODERATION_ITEM_VIEWED,
        targetType: AUDIT_TARGET_TYPES.MODERATION_ITEM,
        actorId: requester.id,
        actorRole: requester.role,
        metadata: { via: 'FILE_DOWNLOAD' },
      }),
    );
  }
}
