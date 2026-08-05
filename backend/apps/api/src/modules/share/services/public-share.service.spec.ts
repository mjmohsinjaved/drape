import type { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { AppException, ErrorCode } from '@library/common';
import { StorageService, type IssueOptions } from '@library/storage';

import { SettingsService } from '@api/modules/settings';
import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import {
  attachQueryBuilder,
  createFakeEntityManager,
  createQueryBuilderSpy,
  createTransactionalDataSource,
} from '@api/modules/users/testing/query-doubles';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import {
  createInMemoryRepository,
  createMock,
  createTestingModule,
} from '../../../../test/fixtures';
import { freezeClock, restoreClock } from '../../../../test/setup/time';
import { ShareLink } from '../entities/share-link.entity';
import { Vote } from '../entities/vote.entity';
import { Reaction } from '../enums/reaction.enum';
import { SHARE_COMMENT_LEFT_EVENT } from '../events/share.events';
import {
  buildExpiredShareLink,
  buildRevokedShareLink,
  buildSharedLinkFixture,
  buildVote,
} from '../testing/share-fixtures';

import { PublicShareService } from './public-share.service';
import { ShareTokenService } from './share-token.service';

import type { InMemoryRepository } from '../../../../test/fixtures';
import type { CastVoteDto } from '../dto/cast-vote.dto';
import type { SharedShortlistRow } from '../queries/public-share.scope';

/**
 * **The recipient view — C-33, C-34, S-9.**
 *
 * Two properties carry this file:
 *
 * 1. **A bad link is always the same answer.** Revoked, expired and never-existed are
 *    indistinguishable from outside, because a caller who can tell them apart has an
 *    oracle for enumerating tokens.
 * 2. **One comment per item**, including when two requests race — the constraint is
 *    the database's, and the service's job is to turn its refusal into the same answer
 *    it would have given had it seen the row first.
 */
describe('PublicShareService', () => {
  const OWNER_ID = 'c0000000-0000-4000-8000-00000000000c';
  const GARMENT_ID = 'a1111111-1111-4111-8111-111111111111';
  const VOTER_TOKEN = 'a-visitor-cookie-value';

  interface Harness {
    service: PublicShareService;
    links: InMemoryRepository<ShareLink>;
    votes: InMemoryRepository<Vote>;
    events: jest.Mocked<EventEmitter2>;
    settings: jest.Mocked<SettingsService>;
    storage: jest.Mocked<StorageService>;
    close: () => Promise<void>;
  }

  const sharedRow: SharedShortlistRow = {
    itemId: 'b2222222-2222-4222-8222-222222222222',
    rank: 1,
    garmentId: GARMENT_ID,
    garmentTitle: 'Zarrin Bridal Lehenga',
    garmentSlug: 'zarrin-bridal-lehenga',
    garmentPrice: '185000.00',
    garmentCurrency: 'PKR',
    categoryName: 'Bridal Lehenga',
    renderThumbnailKey: 'thumbnails/render/abc-320.webp',
  };

  /** The real token service, so hashing is real rather than a mock that always agrees. */
  const tokens = new ShareTokenService({
    getOrThrow: (key: string) => (key === 'APP_WEB_URL' ? 'https://app.test' : true),
  } as unknown as ConfigService);

  async function arrange(
    options: {
      links?: readonly ShareLink[];
      votes?: readonly Vote[];
      rows?: readonly SharedShortlistRow[];
      sharingEnabled?: boolean;
    } = {},
  ): Promise<Harness> {
    const links = createInMemoryRepository<ShareLink>({ rows: options.links ?? [] });
    const votes = createInMemoryRepository<Vote>({ rows: options.votes ?? [] });
    const items = createInMemoryRepository<ShortlistItem>();

    attachQueryBuilder(
      items,
      createQueryBuilderSpy<ShortlistItem>({ raw: options.rows ?? [sharedRow] }),
    );

    const manager = createFakeEntityManager(
      new Map<new (...args: never[]) => object, unknown>([
        [Vote, votes],
        [ShareLink, links],
      ]),
    );
    const { dataSource } = createTransactionalDataSource(manager);

    const settings = createMock<SettingsService>(['getBoolean']);
    settings.getBoolean.mockImplementation(async (key: string) =>
      key === SETTINGS_KEYS.SHARING_ENABLED ? (options.sharingEnabled ?? true) : true,
    );

    const storage = createMock<StorageService>(['signedUrl', 'signedUrlWith']);
    storage.signedUrl.mockImplementation((key: string) => `https://api.test/files/${key}`);
    // C-34: a share thumbnail is signed with an `aud` naming this link and a short TTL,
    // so revocation reaches the images and not just the page. The double records both so
    // the tests below can assert on them.
    storage.signedUrlWith.mockImplementation(
      (key: string, issue: IssueOptions) =>
        `https://api.test/files/${key}?aud=${issue.audience ?? ''}&ttl=${issue.ttlSeconds ?? ''}`,
    );

    const events = createMock<EventEmitter2>(['emit']);

    const harness = await createTestingModule({
      providers: [PublicShareService],
      overrides: [
        { token: getRepositoryToken(ShareLink), value: links },
        { token: getRepositoryToken(Vote), value: votes },
        { token: getRepositoryToken(ShortlistItem), value: items },
        { token: ShareTokenService, value: tokens },
        { token: SettingsService, value: settings },
        { token: StorageService, value: storage },
        { token: EventEmitter2, value: events },
        { token: DataSource, value: dataSource },
      ],
    });

    return {
      service: harness.get<PublicShareService>(PublicShareService),
      links,
      votes,
      events,
      settings,
      storage,
      close: harness.close,
    };
  }

  /**
   * The in-memory repository's methods are jest mocks typed as the real signatures, so
   * a test that needs to force a failure re-widens one deliberately and in one place.
   */
  function asMock(method: unknown): jest.Mock {
    return method as jest.Mock;
  }

  async function errorCodeOf(work: Promise<unknown>): Promise<ErrorCode | undefined> {
    try {
      await work;
      return undefined;
    } catch (error) {
      if (error instanceof AppException) {
        return error.errorCode;
      }
      throw error;
    }
  }

  const voteDto = (overrides: Partial<CastVoteDto> = {}): CastVoteDto => ({
    garmentId: GARMENT_ID,
    reaction: Reaction.HEART,
    voterLabel: 'Ammi',
    ...overrides,
  });

  beforeEach(() => freezeClock());
  afterEach(() => restoreClock());

  /* --------------------------------------------------------------------------------------- */

  describe('C-34 — a link that does not open is always the same refusal (S-9)', () => {
    it('a token that never existed is SHARE_LINK_NOT_FOUND', async () => {
      const harness = await arrange({ links: [] });

      expect(await errorCodeOf(harness.service.view('never-existed', undefined))).toBe(
        ErrorCode.SHARE_LINK_NOT_FOUND,
      );

      await harness.close();
    });

    it('a revoked link is indistinguishable from one that never existed', async () => {
      const revoked = buildRevokedShareLink({ userId: OWNER_ID });
      const harness = await arrange({ links: [revoked.link] });

      expect(await errorCodeOf(harness.service.view(revoked.rawToken, undefined))).toBe(
        ErrorCode.SHARE_LINK_NOT_FOUND,
      );

      await harness.close();
    });

    it('an expired link is indistinguishable from one that never existed', async () => {
      const expired = buildExpiredShareLink({ userId: OWNER_ID });
      const harness = await arrange({ links: [expired.link] });

      expect(await errorCodeOf(harness.service.view(expired.rawToken, undefined))).toBe(
        ErrorCode.SHARE_LINK_NOT_FOUND,
      );

      await harness.close();
    });

    it('refuses a vote on a revoked link the same way', async () => {
      const revoked = buildRevokedShareLink({ userId: OWNER_ID });
      const harness = await arrange({ links: [revoked.link] });

      expect(
        await errorCodeOf(harness.service.castVote(revoked.rawToken, voteDto(), VOTER_TOKEN)),
      ).toBe(ErrorCode.SHARE_LINK_NOT_FOUND);

      await harness.close();
    });

    it('never reveals a working link by its digest — the raw token is what opens it', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const harness = await arrange({ links: [live.link] });

      // Presenting the stored digest is not presenting the token.
      expect(await errorCodeOf(harness.service.view(live.link.tokenHash, undefined))).toBe(
        ErrorCode.SHARE_LINK_NOT_FOUND,
      );

      await harness.close();
    });
  });

  describe('A-30 — the toggle is read before the token, so it leaks nothing', () => {
    it('answers SHARING_DISABLED for a valid token', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const harness = await arrange({ links: [live.link], sharingEnabled: false });

      expect(await errorCodeOf(harness.service.view(live.rawToken, undefined))).toBe(
        ErrorCode.SHARING_DISABLED,
      );

      await harness.close();
    });

    it('answers SHARING_DISABLED for an invalid one too', async () => {
      const harness = await arrange({ links: [], sharingEnabled: false });

      expect(await errorCodeOf(harness.service.view('nonsense', undefined))).toBe(
        ErrorCode.SHARING_DISABLED,
      );

      await harness.close();
    });
  });

  describe('the recipient view', () => {
    it('returns the shared pieces and counts the view', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const harness = await arrange({ links: [live.link] });

      const { shortlist } = await harness.service.view(live.rawToken, VOTER_TOKEN);

      expect(shortlist.itemCount).toBe(1);
      expect(shortlist.items[0]).toMatchObject({
        garmentId: GARMENT_ID,
        title: 'Zarrin Bridal Lehenga',
        price: 185_000,
      });
      expect(shortlist.items[0]?.renderUrl).toContain('thumbnails/render/abc-320.webp');
      expect(harness.links.$rows[0]?.viewCount).toBe(1);

      await harness.close();
    });

    /**
     * PRD C-34 — "share links are revocable at any time."
     *
     * A recipient has no session, so the thumbnail is signed with no `sub` — which is
     * correct, and which used to mean it was a plain bearer URL with the *public*
     * one-hour TTL, served `Cache-Control: public`. Revoking removed the page and left
     * every image URL already handed out working for up to an hour, on a URL that the
     * two-minute issue bucket makes a stable shared-cache key.
     *
     * Both halves are asserted: the `aud` that lets `GET /files/:token` refuse a revoked
     * link on the next request, and the TTL that bounds a copy already in a cache.
     */
    it('binds every share thumbnail to the link, on a short TTL (C-34)', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const harness = await arrange({ links: [live.link] });

      const { shortlist } = await harness.service.view(live.rawToken, VOTER_TOKEN);

      expect(shortlist.items[0]?.renderUrl).toContain(`aud=share-link:${live.link.id}`);
      // Not the 3600-second public class TTL an unbound thumbnail used to take.
      expect(shortlist.items[0]?.renderUrl).toContain('ttl=300');

      await harness.close();
    });

    it('never signs a share thumbnail through the unbound path', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const harness = await arrange({ links: [live.link] });

      await harness.service.view(live.rawToken, VOTER_TOKEN);

      expect(harness.storage.signedUrl).not.toHaveBeenCalled();
      expect(harness.storage.signedUrlWith).toHaveBeenCalled();
    });

    it('mints a cookie for a visitor arriving without one, and keeps an existing one', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const harness = await arrange({ links: [live.link] });

      const fresh = await harness.service.view(live.rawToken, undefined);
      expect(fresh.visitor.isNewVisitor).toBe(true);
      expect(fresh.visitor.voterToken).toHaveLength(43);

      const returning = await harness.service.view(live.rawToken, VOTER_TOKEN);
      expect(returning.visitor).toEqual({ voterToken: VOTER_TOKEN, isNewVisitor: false });

      await harness.close();
    });

    it('hides the price entirely while A-30 has prices off', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const harness = await arrange({ links: [live.link] });
      harness.settings.getBoolean.mockImplementation(async (key: string) =>
        key === SETTINGS_KEYS.CATALOG_SHOW_PRICES_PUBLICLY ? false : true,
      );

      const { shortlist } = await harness.service.view(live.rawToken, VOTER_TOKEN);

      expect(shortlist.items[0]?.price).toBeNull();
      // The currency alone would still say what the studio deals in.
      expect(shortlist.items[0]?.currency).toBeNull();

      await harness.close();
    });
  });

  describe('C-33 — one comment per item', () => {
    it('records the first reaction and comment', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const harness = await arrange({ links: [live.link] });

      const { vote } = await harness.service.castVote(
        live.rawToken,
        voteDto({ comment: 'This one.' }),
        VOTER_TOKEN,
      );

      expect(vote).toMatchObject({ reaction: Reaction.HEART, comment: 'This one.' });
      expect(harness.votes.$rows).toHaveLength(1);
      // The cookie is hashed before it is stored (§4.22).
      expect(harness.votes.$rows[0]?.voterFingerprint).toBe(tokens.fingerprint(VOTER_TOKEN));
      expect(harness.votes.$rows[0]?.voterFingerprint).not.toBe(VOTER_TOKEN);

      await harness.close();
    });

    it('refuses a second comment on the same piece from the same visitor', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const existing = buildVote({
        shareLinkId: live.link.id,
        garmentId: GARMENT_ID,
        voterFingerprint: tokens.fingerprint(VOTER_TOKEN),
        comment: 'Already said my piece.',
      });
      const harness = await arrange({ links: [live.link], votes: [existing] });

      expect(
        await errorCodeOf(
          harness.service.castVote(
            live.rawToken,
            voteDto({ comment: 'Second thoughts.' }),
            VOTER_TOKEN,
          ),
        ),
      ).toBe(ErrorCode.VOTE_ALREADY_CAST);

      await harness.close();
    });

    it('still lets the visitor change their reaction (§4.22)', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const existing = buildVote({
        shareLinkId: live.link.id,
        garmentId: GARMENT_ID,
        voterFingerprint: tokens.fingerprint(VOTER_TOKEN),
        comment: 'Already said my piece.',
        reaction: Reaction.HEART,
      });
      const harness = await arrange({ links: [live.link], votes: [existing] });

      const { vote } = await harness.service.castVote(
        live.rawToken,
        voteDto({ reaction: Reaction.UNSURE }),
        VOTER_TOKEN,
      );

      expect(vote.reaction).toBe(Reaction.UNSURE);
      expect(vote.comment).toBe('Already said my piece.');
      expect(harness.votes.$rows).toHaveLength(1);

      await harness.close();
    });

    it('under concurrency: the losing insert re-reads and is refused, not duplicated', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const harness = await arrange({ links: [live.link] });

      // The winner commits between our read and our write. `UQ_votes_link_voter_garment`
      // refuses the insert with 23505, which is the mechanism, not a fault.
      const winner = buildVote({
        shareLinkId: live.link.id,
        garmentId: GARMENT_ID,
        voterFingerprint: tokens.fingerprint(VOTER_TOKEN),
        comment: 'Got there first.',
      });

      asMock(harness.votes.save).mockImplementationOnce(async () => {
        harness.votes.$rows.push(winner);
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
        });
      });

      expect(
        await errorCodeOf(
          harness.service.castVote(live.rawToken, voteDto({ comment: 'Mine.' }), VOTER_TOKEN),
        ),
      ).toBe(ErrorCode.VOTE_ALREADY_CAST);

      // One row, one comment — the retry did not append a second.
      expect(harness.votes.$rows).toHaveLength(1);
      expect(harness.votes.$rows[0]?.comment).toBe('Got there first.');

      await harness.close();
    });

    it('propagates an error that is not a unique violation rather than retrying it', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const harness = await arrange({ links: [live.link] });

      asMock(harness.votes.save).mockRejectedValueOnce(new Error('connection terminated'));

      await expect(harness.service.castVote(live.rawToken, voteDto(), VOTER_TOKEN)).rejects.toThrow(
        'connection terminated',
      );

      await harness.close();
    });

    it('refuses a vote on a piece that is not on this shortlist', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const harness = await arrange({ links: [live.link] });

      expect(
        await errorCodeOf(
          harness.service.castVote(
            live.rawToken,
            voteDto({ garmentId: 'f0000000-0000-4000-8000-00000000000f' }),
            VOTER_TOKEN,
          ),
        ),
      ).toBe(ErrorCode.GARMENT_NOT_FOUND);

      expect(harness.votes.$rows).toHaveLength(0);

      await harness.close();
    });

    it('tells the owner about a comment, and says nothing on a bare reaction', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const harness = await arrange({ links: [live.link] });

      await harness.service.castVote(live.rawToken, voteDto(), VOTER_TOKEN);
      expect(harness.events.emit).not.toHaveBeenCalledWith(
        SHARE_COMMENT_LEFT_EVENT,
        expect.anything(),
      );

      await harness.service.castVote(live.rawToken, voteDto({ comment: 'Lovely.' }), VOTER_TOKEN);
      expect(harness.events.emit).toHaveBeenCalledWith(SHARE_COMMENT_LEFT_EVENT, expect.anything());

      await harness.close();
    });
  });

  describe('one recipient never sees another recipient’s notes', () => {
    it('returns only the votes matching the caller’s own fingerprint', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const mine = buildVote({
        shareLinkId: live.link.id,
        garmentId: GARMENT_ID,
        voterFingerprint: tokens.fingerprint(VOTER_TOKEN),
        comment: 'Mine.',
      });
      const theirs = buildVote({
        shareLinkId: live.link.id,
        garmentId: GARMENT_ID,
        voterFingerprint: tokens.fingerprint('a-different-visitor'),
        comment: 'Someone else’s.',
      });
      const harness = await arrange({ links: [live.link], votes: [mine, theirs] });

      const own = await harness.service.ownVotes(live.rawToken, VOTER_TOKEN);

      expect(own).toHaveLength(1);
      expect(own[0]?.comment).toBe('Mine.');

      await harness.close();
    });

    it('shows a first-time visitor nothing at all', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const theirs = buildVote({ shareLinkId: live.link.id, comment: 'Someone else’s.' });
      const harness = await arrange({ links: [live.link], votes: [theirs] });

      expect(await harness.service.ownVotes(live.rawToken, undefined)).toEqual([]);

      await harness.close();
    });

    it('does not fold another visitor’s reaction into the recipient view', async () => {
      const live = buildSharedLinkFixture({ userId: OWNER_ID });
      const theirs = buildVote({
        shareLinkId: live.link.id,
        garmentId: GARMENT_ID,
        voterFingerprint: tokens.fingerprint('a-different-visitor'),
        reaction: Reaction.NO,
        comment: 'Not this one.',
      });
      const harness = await arrange({ links: [live.link], votes: [theirs] });

      const { shortlist } = await harness.service.view(live.rawToken, VOTER_TOKEN);

      expect(shortlist.items[0]?.myReaction).toBeNull();
      expect(shortlist.items[0]?.myComment).toBeNull();

      await harness.close();
    });
  });
});
