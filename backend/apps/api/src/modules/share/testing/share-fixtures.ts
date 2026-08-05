import { sha256Hex } from '@library/common';

import { buildEntity, uuid } from '../../../../test/factories';
import { FIXED_NOW } from '../../../../test/setup/time';
import { MILLISECONDS_PER_DAY, SHARE_LINK_TTL_DAYS } from '../constants/share.constants';
import { ShareLink } from '../entities/share-link.entity';
import { Vote } from '../entities/vote.entity';
import { Reaction } from '../enums/reaction.enum';

/**
 * Fixtures for `share_links` and `votes` (§4.21, §4.22).
 *
 * They live in the module rather than in `test/factories` for the same reason
 * `auth/testing/auth-fixtures.ts` does: they encode rules that belong to this module —
 * a link is live for 30 days, a token is stored as a digest and never in the clear —
 * and a fixture that got either wrong would make the C-34 tests pass for the wrong
 * reason.
 */

/** A raw token and the link that stores its digest. The raw value is what a test presents. */
export interface SharedLinkFixture {
  readonly rawToken: string;
  readonly link: ShareLink;
}

/** A live link: not revoked, 30 days of life left (C-34). */
export function buildShareLink(overrides: Partial<ShareLink> = {}): ShareLink {
  return buildEntity<ShareLink>(
    ShareLink,
    {
      id: uuid(),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      deletedAt: null,

      userId: uuid(),
      // A digest, never a token. §4.21 stores `char(64)`.
      tokenHash: sha256Hex(`share-token-${uuid()}`),
      label: 'Ammi',
      expiresAt: new Date(FIXED_NOW.getTime() + SHARE_LINK_TTL_DAYS * MILLISECONDS_PER_DAY),
      revokedAt: null,
      viewCount: 0,
      lastViewedAt: null,
    },
    overrides,
  );
}

/** A link and the raw token that opens it, so a test can present one. */
export function buildSharedLinkFixture(overrides: Partial<ShareLink> = {}): SharedLinkFixture {
  const rawToken = `token-${uuid()}`;
  return {
    rawToken,
    link: buildShareLink({ tokenHash: sha256Hex(rawToken), ...overrides }),
  };
}

/** A link its owner has turned off (C-34). */
export function buildRevokedShareLink(overrides: Partial<ShareLink> = {}): SharedLinkFixture {
  return buildSharedLinkFixture({ revokedAt: FIXED_NOW, ...overrides });
}

/** A link that has run out its 30 days (C-34). */
export function buildExpiredShareLink(overrides: Partial<ShareLink> = {}): SharedLinkFixture {
  return buildSharedLinkFixture({
    expiresAt: new Date(FIXED_NOW.getTime() - MILLISECONDS_PER_DAY),
    ...overrides,
  });
}

/** A reaction left by a visitor with no account (§4.22). */
export function buildVote(overrides: Partial<Vote> = {}): Vote {
  return buildEntity<Vote>(
    Vote,
    {
      id: uuid(),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      deletedAt: null,

      shareLinkId: uuid(),
      garmentId: uuid(),
      voterLabel: 'Ammi',
      // sha256 of a first-party cookie value — never the cookie itself.
      voterFingerprint: sha256Hex(`voter-${uuid()}`),
      reaction: Reaction.HEART,
      comment: null,
    },
    overrides,
  );
}
