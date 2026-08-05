import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { AppException, ErrorCode, Role } from '@library/common';
import type { ICurrentUser } from '@library/common';
import { StorageService } from '@library/storage';

import { Garment } from '@api/modules/garments/entities/garment.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { SettingsService } from '@api/modules/settings';
import { ShortlistService } from '@api/modules/shortlist';
import type { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { ConsumerProfile } from '@api/modules/users/entities/consumer-profile.entity';
import { User } from '@api/modules/users/entities/user.entity';
import { BudgetBand } from '@api/modules/users/enums/budget-band.enum';
import { EventType } from '@api/modules/users/enums/event-type.enum';
import {
  createFakeEntityManager,
  createTransactionalDataSource,
  type TransactionState,
} from '@api/modules/users/testing/query-doubles';
import { sessionFor } from '@api/modules/users/testing/route-authorisation';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import {
  buildEnquiry,
  buildEntity,
  buildPublishedGarment,
  buildShortlistItem,
  buildTryOnResult,
  buildUser,
  uuid,
} from '../../../../test/factories';
import {
  createInMemoryRepository,
  createMock,
  createTestingModule,
} from '../../../../test/fixtures';
import { EnquiryItem } from '../entities/enquiry-item.entity';
import { Enquiry } from '../entities/enquiry.entity';
import { EnquiryStatus } from '../enums/enquiry-status.enum';
import { ENQUIRY_CREATED_EVENT } from '../events/enquiry.events';

import { EnquiriesService } from './enquiries.service';

import type { InMemoryRepository } from '../../../../test/fixtures';

/**
 * **Submitting and reading her own enquiries — C-3, C-35, C-36, A-21.**
 *
 * The test this file exists for is the snapshot one. A-21 promises the admin sees
 * "shortlisted garments in her rank order with their renders" — and an enquiry that
 * re-read her live shortlist would change under the admin's hands every time she moved
 * a piece. So the enquiry is proved to survive a reorder and an emptying alike.
 */
describe('EnquiriesService', () => {
  const her: ICurrentUser = sessionFor(Role.CONSUMER);
  const someoneElse: ICurrentUser = sessionFor(Role.CONSUMER, {
    id: 'd0000000-0000-4000-8000-00000000000d',
  });

  interface Harness {
    service: EnquiriesService;
    enquiries: InMemoryRepository<Enquiry>;
    items: InMemoryRepository<EnquiryItem>;
    shortlist: jest.Mocked<ShortlistService>;
    events: jest.Mocked<EventEmitter2>;
    transaction: TransactionState;
    close: () => Promise<void>;
  }

  function profileFor(overrides: Partial<ConsumerProfile> = {}): ConsumerProfile {
    return buildEntity<ConsumerProfile>(
      ConsumerProfile,
      {
        id: uuid(),
        userId: her.id,
        eventDate: new Date('2026-12-14T00:00:00.000Z'),
        eventType: EventType.BARAAT,
        budgetBand: BudgetBand.BAND_250K_500K,
      },
      overrides,
    );
  }

  async function arrange(
    options: {
      account?: User;
      enquiries?: readonly Enquiry[];
      items?: readonly EnquiryItem[];
      shortlisted?: readonly ShortlistItem[];
      garments?: readonly Garment[];
      results?: readonly TryOnResult[];
      profiles?: readonly ConsumerProfile[];
      enquiriesEnabled?: boolean;
    } = {},
  ): Promise<Harness> {
    const account = options.account ?? buildUser({ id: her.id, name: 'Sana Mahmood' });

    const enquiries = createInMemoryRepository<Enquiry>({
      rows: options.enquiries ?? [],
      create: (partial) => buildEnquiry(partial),
    });
    const items = createInMemoryRepository<EnquiryItem>({ rows: options.items ?? [] });
    const garments = createInMemoryRepository<Garment>({ rows: options.garments ?? [] });
    const results = createInMemoryRepository<TryOnResult>({ rows: options.results ?? [] });
    const users = createInMemoryRepository<User>({ rows: [account] });
    const profiles = createInMemoryRepository<ConsumerProfile>({ rows: options.profiles ?? [] });

    const manager = createFakeEntityManager(
      new Map<new (...args: never[]) => object, unknown>([
        [Enquiry, enquiries],
        [EnquiryItem, items],
      ]),
    );
    const { dataSource, state } = createTransactionalDataSource(manager);

    const shortlist = createMock<ShortlistService>(['rankedItems']);
    shortlist.rankedItems.mockResolvedValue([...(options.shortlisted ?? [])]);

    const settings = createMock<SettingsService>(['getBoolean']);
    settings.getBoolean.mockImplementation(async (key: string) =>
      key === SETTINGS_KEYS.ENQUIRIES_ENABLED ? (options.enquiriesEnabled ?? true) : true,
    );

    const storage = createMock<StorageService>(['signedUrl']);
    storage.signedUrl.mockImplementation((key: string) => `https://api.test/files/${key}`);

    const events = createMock<EventEmitter2>(['emit']);

    const harness = await createTestingModule({
      providers: [EnquiriesService],
      overrides: [
        { token: getRepositoryToken(Enquiry), value: enquiries },
        { token: getRepositoryToken(EnquiryItem), value: items },
        { token: getRepositoryToken(Garment), value: garments },
        { token: getRepositoryToken(TryOnResult), value: results },
        { token: getRepositoryToken(User), value: users },
        { token: getRepositoryToken(ConsumerProfile), value: profiles },
        { token: ShortlistService, value: shortlist },
        { token: SettingsService, value: settings },
        { token: StorageService, value: storage },
        { token: EventEmitter2, value: events },
        { token: DataSource, value: dataSource },
      ],
    });

    return {
      service: harness.get<EnquiriesService>(EnquiriesService),
      enquiries,
      items,
      shortlist,
      events,
      transaction: state,
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

  /** Three shortlisted pieces with garments, notes and renders behind them. */
  function threePieces(): {
    shortlisted: ShortlistItem[];
    garments: Garment[];
    results: TryOnResult[];
  } {
    const garments = [
      buildPublishedGarment({ title: 'Zarrin Bridal Lehenga', sku: 'ZRN-1', price: 200_000 }),
      buildPublishedGarment({ title: 'Ivory Chikankari Kurta', sku: 'IVY-2', price: 120_000 }),
      buildPublishedGarment({ title: 'Gold Tissue Sharara', sku: 'GLD-3', price: 50_000 }),
    ];
    const results = garments.map(() => buildTryOnResult({ userId: her.id }));
    const shortlisted = garments.map((garment, index) =>
      buildShortlistItem({
        userId: her.id,
        garmentId: garment.id,
        rank: index + 1,
        note: `note ${index + 1}`,
        latestResultId: results[index]?.id ?? null,
      }),
    );

    return { shortlisted, garments, results };
  }

  /* --------------------------------------------------------------------------------------- */

  describe('C-35 / A-21 — the submission and its snapshot', () => {
    it('snapshots the shortlist in her rank order, with notes and prices', async () => {
      const { shortlisted, garments, results } = threePieces();
      const harness = await arrange({ shortlisted, garments, results });

      const enquiry = await harness.service.submit(her, { message: 'Can I see these?' });

      expect(enquiry.itemCount).toBe(3);
      expect(enquiry.items.map((item) => item.rank)).toEqual([1, 2, 3]);
      expect(enquiry.items.map((item) => item.title)).toEqual([
        'Zarrin Bridal Lehenga',
        'Ivory Chikankari Kurta',
        'Gold Tissue Sharara',
      ]);
      expect(enquiry.items.map((item) => item.note)).toEqual(['note 1', 'note 2', 'note 3']);
      expect(enquiry.items.map((item) => item.sku)).toEqual(['ZRN-1', 'IVY-2', 'GLD-3']);
      expect(enquiry.totalValue).toBe(370_000);

      await harness.close();
    });

    it('writes the enquiry and its items in one committed transaction', async () => {
      const { shortlisted, garments, results } = threePieces();
      const harness = await arrange({ shortlisted, garments, results });

      await harness.service.submit(her, { message: 'Can I see these?' });

      // §2.9 rule 3: half an enquiry is an admin looking at a message with no pieces.
      expect(harness.transaction).toMatchObject({ started: 1, committed: 1, rolledBack: 0 });

      await harness.close();
    });

    it('snapshots her verified contact details rather than joining her account', async () => {
      const { shortlisted, garments, results } = threePieces();
      const account = buildUser({
        id: her.id,
        name: 'Sana Mahmood',
        email: 'sana@example.invalid',
        phone: '+923001112222',
      });
      const harness = await arrange({ account, shortlisted, garments, results });

      await harness.service.submit(her, { message: 'Can I see these?' });

      expect(harness.enquiries.$rows[0]).toMatchObject({
        contactName: 'Sana Mahmood',
        contactEmail: 'sana@example.invalid',
        contactPhone: '+923001112222',
        status: EnquiryStatus.NEW,
      });

      await harness.close();
    });

    it('pre-fills the event and budget from her profile (C-35)', async () => {
      const { shortlisted, garments, results } = threePieces();
      const harness = await arrange({
        shortlisted,
        garments,
        results,
        profiles: [profileFor()],
      });

      const enquiry = await harness.service.submit(her, { message: 'Can I see these?' });

      expect(enquiry.eventType).toBe(EventType.BARAAT);
      expect(enquiry.budgetBand).toBe(BudgetBand.BAND_250K_500K);

      await harness.close();
    });

    it('lets the payload override what the profile says', async () => {
      const { shortlisted, garments, results } = threePieces();
      const harness = await arrange({
        shortlisted,
        garments,
        results,
        profiles: [profileFor()],
      });

      const enquiry = await harness.service.submit(her, {
        message: 'Can I see these?',
        eventType: EventType.WALIMA,
        budgetBand: BudgetBand.BAND_500K_1M,
      });

      expect(enquiry.eventType).toBe(EventType.WALIMA);
      expect(enquiry.budgetBand).toBe(BudgetBand.BAND_500K_1M);

      await harness.close();
    });

    it('gives it a reference both sides can quote (§4.23)', async () => {
      const { shortlisted, garments, results } = threePieces();
      const harness = await arrange({ shortlisted, garments, results });

      const enquiry = await harness.service.submit(her, { message: 'Can I see these?' });

      expect(enquiry.reference).toMatch(/^ENQ-\d{4}-\d{6}$/);

      await harness.close();
    });

    it('announces the enquiry once, after the commit', async () => {
      const { shortlisted, garments, results } = threePieces();
      const harness = await arrange({ shortlisted, garments, results });

      await harness.service.submit(her, { message: 'Can I see these?' });

      const created = harness.events.emit.mock.calls.filter(
        ([name]) => name === ENQUIRY_CREATED_EVENT,
      );
      expect(created).toHaveLength(1);

      await harness.close();
    });
  });

  describe('A-21 — the snapshot survives whatever she does next', () => {
    it('keeps her original order after she reorders her shortlist', async () => {
      const { shortlisted, garments, results } = threePieces();
      const harness = await arrange({ shortlisted, garments, results });

      const submitted = await harness.service.submit(her, { message: 'Can I see these?' });

      // She reverses her shortlist afterwards. The enquiry is a record, not a view.
      harness.shortlist.rankedItems.mockResolvedValue([...shortlisted].reverse());

      const reread = await harness.service.findOne(her, submitted.id);

      expect(reread.items.map((item) => item.title)).toEqual([
        'Zarrin Bridal Lehenga',
        'Ivory Chikankari Kurta',
        'Gold Tissue Sharara',
      ]);
      expect(reread.items.map((item) => item.rank)).toEqual([1, 2, 3]);

      await harness.close();
    });

    it('keeps every piece after she empties her shortlist entirely', async () => {
      const { shortlisted, garments, results } = threePieces();
      const harness = await arrange({ shortlisted, garments, results });

      const submitted = await harness.service.submit(her, { message: 'Can I see these?' });

      harness.shortlist.rankedItems.mockResolvedValue([]);

      const reread = await harness.service.findOne(her, submitted.id);

      expect(reread.itemCount).toBe(3);
      expect(reread.totalValue).toBe(370_000);

      await harness.close();
    });

    it('still reads after the garment is repriced — the price is the one she saw', async () => {
      const { shortlisted, garments, results } = threePieces();
      const harness = await arrange({ shortlisted, garments, results });

      const submitted = await harness.service.submit(her, { message: 'Can I see these?' });

      const first = garments[0];
      if (first !== undefined) {
        first.price = 999_999;
      }

      const reread = await harness.service.findOne(her, submitted.id);

      expect(reread.items[0]?.price).toBe(200_000);

      await harness.close();
    });
  });

  describe('the gates before anything is written', () => {
    it('C-3 — a consumer with an unverified phone cannot submit', async () => {
      const { shortlisted, garments, results } = threePieces();
      const harness = await arrange({
        account: buildUser({ id: her.id, phoneVerifiedAt: null }),
        shortlisted,
        garments,
        results,
      });

      expect(await errorCodeOf(harness.service.submit(her, { message: 'Hello' }))).toBe(
        ErrorCode.PHONE_NOT_VERIFIED,
      );
      expect(harness.enquiries.$rows).toHaveLength(0);

      await harness.close();
    });

    it('C-3 — nor can one with no phone number at all', async () => {
      const { shortlisted, garments, results } = threePieces();
      const harness = await arrange({
        account: buildUser({ id: her.id, phone: null, phoneVerifiedAt: null }),
        shortlisted,
        garments,
        results,
      });

      expect(await errorCodeOf(harness.service.submit(her, { message: 'Hello' }))).toBe(
        ErrorCode.PHONE_NOT_VERIFIED,
      );

      await harness.close();
    });

    it('A-30 — enquiries can be closed, and the refusal comes before anything else', async () => {
      const harness = await arrange({ enquiriesEnabled: false });

      expect(await errorCodeOf(harness.service.submit(her, { message: 'Hello' }))).toBe(
        ErrorCode.ENQUIRIES_DISABLED,
      );

      await harness.close();
    });

    it('refuses an empty shortlist', async () => {
      const harness = await arrange({ shortlisted: [] });

      expect(await errorCodeOf(harness.service.submit(her, { message: 'Hello' }))).toBe(
        ErrorCode.SHORTLIST_EMPTY,
      );

      await harness.close();
    });

    it('refuses a second enquiry while one is still open', async () => {
      const { shortlisted, garments, results } = threePieces();
      const open = buildEnquiry({ userId: her.id, status: EnquiryStatus.CONTACTED });
      const harness = await arrange({ shortlisted, garments, results, enquiries: [open] });

      expect(await errorCodeOf(harness.service.submit(her, { message: 'Hello' }))).toBe(
        ErrorCode.ENQUIRY_ALREADY_OPEN,
      );

      await harness.close();
    });

    it('allows a new one once the last is closed', async () => {
      const { shortlisted, garments, results } = threePieces();
      const closed = buildEnquiry({ userId: her.id, status: EnquiryStatus.CLOSED_WON });
      const harness = await arrange({ shortlisted, garments, results, enquiries: [closed] });

      await expect(harness.service.submit(her, { message: 'Again please' })).resolves.toBeDefined();

      await harness.close();
    });
  });

  describe('C-36 / E-7 — she sees her own and nothing else', () => {
    it('lists only her enquiries', async () => {
      const mine = buildEnquiry({ userId: her.id });
      const theirs = buildEnquiry({ userId: someoneElse.id });
      const harness = await arrange({ enquiries: [mine, theirs] });

      const page = await harness.service.list(her, {
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.id).toBe(mine.id);

      await harness.close();
    });

    it('refuses to read another consumer’s enquiry, with the code the client sees masked from', async () => {
      const theirs = buildEnquiry({ userId: someoneElse.id });
      const harness = await arrange({ enquiries: [theirs] });

      expect(await errorCodeOf(harness.service.findOne(her, theirs.id))).toBe(
        ErrorCode.ENQUIRY_NOT_OWNED,
      );

      await harness.close();
    });

    it('answers NOT_FOUND for an id that belongs to nobody', async () => {
      const harness = await arrange();

      expect(
        await errorCodeOf(harness.service.findOne(her, 'f0000000-0000-4000-8000-00000000000f')),
      ).toBe(ErrorCode.ENQUIRY_NOT_FOUND);

      await harness.close();
    });

    it('A-24 — her view has no field for an internal note, and none for a lost reason', async () => {
      const mine = buildEnquiry({
        userId: her.id,
        status: EnquiryStatus.CLOSED_LOST,
        lostReason: 'Went with a competitor on price.',
      });
      const harness = await arrange({ enquiries: [mine] });

      const enquiry = await harness.service.findOne(her, mine.id);

      expect(enquiry).not.toHaveProperty('lostReason');
      expect(enquiry).not.toHaveProperty('notes');
      expect(JSON.stringify(enquiry)).not.toContain('competitor');

      await harness.close();
    });
  });
});
