import type { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AppException, ErrorCode, Role } from '@library/common';
import type { ICurrentUser } from '@library/common';

import { AUDIT_RECORD_EVENT, type AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { Garment } from '@api/modules/garments/entities/garment.entity';
import { SettingsService } from '@api/modules/settings';
import { sessionFor } from '@api/modules/users/testing/route-authorisation';
import { AUDIT_ACTIONS } from '@api/shared/constants/audit-actions.constant';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { buildPublishedGarment } from '../../../../test/factories';
import {
  createInMemoryRepository,
  createMock,
  createTestingModule,
} from '../../../../test/fixtures';
import { freezeClock, FIXED_NOW, restoreClock } from '../../../../test/setup/time';
import { MILLISECONDS_PER_DAY, SHARE_LINK_TTL_DAYS } from '../constants/share.constants';
import { ShareLink } from '../entities/share-link.entity';
import { Vote } from '../entities/vote.entity';
import { buildShareLink, buildVote } from '../testing/share-fixtures';

import { ShareLinksService } from './share-links.service';
import { ShareTokenService } from './share-token.service';

import type { InMemoryRepository } from '../../../../test/fixtures';

/**
 * **The owner's side — C-33, C-34, A-30, and the E-7 cross-account rule.**
 *
 * The tests that carry weight here are the ownership ones. A share link is the only
 * object in the product that hands a render to somebody with no account, so "another
 * consumer cannot revoke, read or even confirm the existence of one" is the property
 * worth proving, and proving it as the masked answer the client actually receives.
 */
describe('ShareLinksService', () => {
  const her: ICurrentUser = sessionFor(Role.CONSUMER);
  const someoneElse: ICurrentUser = sessionFor(Role.CONSUMER, {
    id: 'd0000000-0000-4000-8000-00000000000d',
  });

  const tokens = new ShareTokenService({
    getOrThrow: (key: string) => (key === 'APP_WEB_URL' ? 'https://app.test' : true),
  } as unknown as ConfigService);

  interface Harness {
    service: ShareLinksService;
    links: InMemoryRepository<ShareLink>;
    events: jest.Mocked<EventEmitter2>;
    close: () => Promise<void>;
  }

  async function arrange(
    options: {
      links?: readonly ShareLink[];
      votes?: readonly Vote[];
      garments?: readonly Garment[];
      sharingEnabled?: boolean;
    } = {},
  ): Promise<Harness> {
    const links = createInMemoryRepository<ShareLink>({ rows: options.links ?? [] });
    const votes = createInMemoryRepository<Vote>({ rows: options.votes ?? [] });
    const garments = createInMemoryRepository<Garment>({ rows: options.garments ?? [] });

    const settings = createMock<SettingsService>(['getBoolean']);
    settings.getBoolean.mockImplementation(async (key: string) =>
      key === SETTINGS_KEYS.SHARING_ENABLED ? (options.sharingEnabled ?? true) : true,
    );

    const events = createMock<EventEmitter2>(['emit']);

    const harness = await createTestingModule({
      providers: [ShareLinksService],
      overrides: [
        { token: getRepositoryToken(ShareLink), value: links },
        { token: getRepositoryToken(Vote), value: votes },
        { token: getRepositoryToken(Garment), value: garments },
        { token: ShareTokenService, value: tokens },
        { token: SettingsService, value: settings },
        { token: EventEmitter2, value: events },
      ],
    });

    return {
      service: harness.get<ShareLinksService>(ShareLinksService),
      links,
      events,
      close: harness.close,
    };
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

  beforeEach(() => freezeClock());
  afterEach(() => restoreClock());

  /* --------------------------------------------------------------------------------------- */

  describe('E-7 — one consumer cannot reach another’s share link', () => {
    it('refuses to revoke it, with the code the client actually receives masked from', async () => {
      const hers = buildShareLink({ userId: her.id });
      const harness = await arrange({ links: [hers] });

      // The true code is logged; `GlobalExceptionFilter` returns SHARE_LINK_NOT_FOUND
      // to the client, so the two cases are indistinguishable from outside (§2.4, S-9).
      expect(await errorCodeOf(harness.service.revoke(someoneElse, hers.id))).toBe(
        ErrorCode.SHARE_LINK_NOT_OWNED,
      );
      expect(harness.links.$rows[0]?.revokedAt).toBeNull();

      await harness.close();
    });

    it('refuses to read its reactions', async () => {
      const hers = buildShareLink({ userId: her.id });
      const harness = await arrange({
        links: [hers],
        votes: [buildVote({ shareLinkId: hers.id, comment: 'Private to her.' })],
      });

      expect(await errorCodeOf(harness.service.listVotes(someoneElse, hers.id))).toBe(
        ErrorCode.SHARE_LINK_NOT_OWNED,
      );

      await harness.close();
    });

    it('never lists it', async () => {
      const harness = await arrange({
        links: [buildShareLink({ userId: her.id }), buildShareLink({ userId: someoneElse.id })],
      });

      const mine = await harness.service.list(someoneElse);

      expect(mine).toHaveLength(1);
      expect(mine[0]?.id).toBe(harness.links.$rows[1]?.id);

      await harness.close();
    });

    it('answers NOT_FOUND for an id that belongs to nobody', async () => {
      const harness = await arrange({ links: [] });

      expect(
        await errorCodeOf(harness.service.revoke(her, 'f0000000-0000-4000-8000-00000000000f')),
      ).toBe(ErrorCode.SHARE_LINK_NOT_FOUND);

      await harness.close();
    });
  });

  describe('C-34 — 30 days, and revocable at any time', () => {
    it('creates a link that expires in exactly 30 days', async () => {
      const harness = await arrange();

      const created = await harness.service.create(her, { label: 'Ammi' });

      expect(created.expiresAt.getTime()).toBe(
        FIXED_NOW.getTime() + SHARE_LINK_TTL_DAYS * MILLISECONDS_PER_DAY,
      );
      expect(created.active).toBe(true);

      await harness.close();
    });

    it('returns the link once, and stores only its digest', async () => {
      const harness = await arrange();

      const created = await harness.service.create(her, {});
      const stored = harness.links.$rows[0];

      expect(created.url).toMatch(/^https:\/\/app\.test\/share\//);
      const rawToken = created.url?.split('/share/')[1] ?? '';
      expect(stored?.tokenHash).toBe(tokens.hash(decodeURIComponent(rawToken)));
      // The digest is not the token, and the token is not stored anywhere.
      expect(stored?.tokenHash).not.toBe(rawToken);

      // Listing never hands it back — it could not, and it does not pretend to.
      const listed = await harness.service.list(her);
      expect(listed[0]?.url).toBeNull();

      await harness.close();
    });

    it('revokes immediately and writes an audit row', async () => {
      const hers = buildShareLink({ userId: her.id });
      const harness = await arrange({ links: [hers] });

      await harness.service.revoke(her, hers.id);

      expect(harness.links.$rows[0]?.revokedAt).toEqual(FIXED_NOW);

      const audits = harness.events.emit.mock.calls
        .filter(([name]) => name === AUDIT_RECORD_EVENT)
        .map(([, event]) => (event as AuditRecordEvent).input);

      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: AUDIT_ACTIONS.SHARE_LINK_REVOKED,
        actorId: her.id,
        targetId: hers.id,
      });
      // No token, no digest, no recipient in the log line (E-12).
      expect(JSON.stringify(audits[0])).not.toContain(hers.tokenHash);

      await harness.close();
    });

    it('refuses to revoke a link that is already off', async () => {
      const hers = buildShareLink({ userId: her.id, revokedAt: FIXED_NOW });
      const harness = await arrange({ links: [hers] });

      expect(await errorCodeOf(harness.service.revoke(her, hers.id))).toBe(
        ErrorCode.SHARE_LINK_REVOKED,
      );

      await harness.close();
    });

    it('reports a revoked and an expired link as inactive, and says which is which', async () => {
      const revoked = buildShareLink({ userId: her.id, revokedAt: FIXED_NOW });
      const expired = buildShareLink({
        userId: her.id,
        expiresAt: new Date(FIXED_NOW.getTime() - MILLISECONDS_PER_DAY),
      });
      const harness = await arrange({ links: [revoked, expired] });

      const listed = await harness.service.list(her);

      // She is signed in and it is her link: telling her which applies is the point.
      // A recipient is told neither — see `public-share.service.spec.ts`.
      expect(listed.every((link) => !link.active)).toBe(true);
      expect(listed.find((link) => link.id === revoked.id)?.revokedAt).toEqual(FIXED_NOW);
      expect(listed.find((link) => link.id === expired.id)?.revokedAt).toBeNull();

      await harness.close();
    });
  });

  describe('A-30 — the sharing toggle', () => {
    it('refuses to mint a link that would not open', async () => {
      const harness = await arrange({ sharingEnabled: false });

      expect(await errorCodeOf(harness.service.create(her, {}))).toBe(ErrorCode.SHARING_DISABLED);
      expect(harness.links.$rows).toHaveLength(0);

      await harness.close();
    });
  });

  describe('what she sees of her recipients', () => {
    it('shows every reaction on her own link, with the piece it is about', async () => {
      const garment = buildPublishedGarment({ title: 'Zarrin Bridal Lehenga' });
      const hers = buildShareLink({ userId: her.id });
      const harness = await arrange({
        links: [hers],
        garments: [garment],
        votes: [
          buildVote({ shareLinkId: hers.id, garmentId: garment.id, voterLabel: 'Ammi' }),
          buildVote({ shareLinkId: hers.id, garmentId: garment.id, voterLabel: 'Sara' }),
        ],
      });

      const votes = await harness.service.listVotes(her, hers.id);

      expect(votes).toHaveLength(2);
      expect(votes[0]).toMatchObject({ voterLabel: 'Ammi', garmentTitle: 'Zarrin Bridal Lehenga' });
      // A hash of a cookie in someone else's browser has no business on the wire.
      expect(JSON.stringify(votes)).not.toContain('voterFingerprint');

      await harness.close();
    });
  });
});
