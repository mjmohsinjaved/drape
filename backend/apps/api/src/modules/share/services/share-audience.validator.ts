import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { SignedUrlAudienceRegistry, type SignedUrlAudienceValidator } from '@library/storage';

import { ShareLink } from '../entities/share-link.entity';

/** The `aud` scheme this module owns. `share-link:<uuid>`. */
export const SHARE_LINK_AUDIENCE_SCHEME = 'share-link';

/**
 * **What makes C-34's "revocable at any time" true of the pictures as well as the page.**
 *
 * ### The gap
 *
 * A share-page thumbnail is signed with **no subject**, and that is architecturally
 * correct: C-33 gives the recipient a link and nothing else, so there is no session for a
 * `sub` to match. The consequence was that the URL was a plain bearer token with the
 * *public* object-class TTL — an hour — and `FileDownloadService` served it
 * `Cache-Control: public`. With the two-minute issue bucket making the URL a stable
 * shared-cache key, revoking a link removed the page and left every image URL already
 * handed out working until its own expiry. The owner was told her link was revoked; the
 * renders on it were still fetchable.
 *
 * ### The fix, in two halves
 *
 * `PublicShareService` now signs those thumbnails with an `aud` of `share-link:<id>` and a
 * short TTL. This class answers the first half — *is that link still live?* — on every
 * single request, so a revoked link fails on the next fetch rather than at expiry. The
 * short TTL answers the second half, which no server-side check can: bytes already sitting
 * in a proxy's cache are past our reach, and the only control over those is how long the
 * response said they could be kept.
 *
 * ### Why it is registered rather than injected
 *
 * `modules/files` is the byte choke point every other module depends on; making it import
 * `ShareModule` to check a claim would invert that dependency. `SignedUrlAudienceRegistry`
 * lives in the `@Global()` storage module, so this registers on init and
 * `FileDownloadService` asks — neither module knows the other exists. See the registry's
 * own comment.
 *
 * ### The predicate is exactly `resolve()`'s
 *
 * Live means: the row exists, is not soft-deleted, is not revoked, and has not expired.
 * Deliberately identical to `PublicShareService.resolve`, because a thumbnail that
 * outlives the page it is on is the whole defect. Never throws — the registry treats a
 * throw as a refusal, and this returns the same answer explicitly.
 */
@Injectable()
export class ShareAudienceValidator implements SignedUrlAudienceValidator, OnModuleInit {
  constructor(
    @InjectRepository(ShareLink)
    private readonly links: Repository<ShareLink>,
    private readonly registry: SignedUrlAudienceRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(SHARE_LINK_AUDIENCE_SCHEME, this);
  }

  /** The `aud` claim a thumbnail issued under this link carries. */
  static audienceFor(shareLinkId: string): string {
    return SignedUrlAudienceRegistry.audience(SHARE_LINK_AUDIENCE_SCHEME, shareLinkId);
  }

  async isAudienceLive(shareLinkId: string): Promise<boolean> {
    const link = await this.links.findOne({
      where: { id: shareLinkId },
      select: { id: true, revokedAt: true, expiresAt: true },
    });

    if (link === null || link.revokedAt !== null) {
      return false;
    }
    return link.expiresAt.getTime() > Date.now();
  }
}
