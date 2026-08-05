import { getRepositoryToken } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { AppException, ErrorCode, Role } from '@library/common';
import type { ICurrentUser } from '@library/common';
import { StorageService } from '@library/storage';

import { Garment } from '@api/modules/garments/entities/garment.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { ConsumerProfile } from '@api/modules/users/entities/consumer-profile.entity';
import { BudgetBand } from '@api/modules/users/enums/budget-band.enum';
import {
  createFakeEntityManager,
  createTransactionalDataSource,
  type TransactionState,
} from '@api/modules/users/testing/query-doubles';
import { sessionFor } from '@api/modules/users/testing/route-authorisation';

import {
  buildEntity,
  buildMaybeShortlistItem,
  buildPublishedGarment,
  buildRejectedShortlistItem,
  buildShortlistItem,
  buildTryOnResult,
  uuid,
} from '../../../../test/factories';
import {
  createInMemoryRepository,
  createMock,
  createTestingModule,
} from '../../../../test/fixtures';
import { ShortlistItem } from '../entities/shortlist-item.entity';
import { RejectReason } from '../enums/reject-reason.enum';
import { Verdict } from '../enums/verdict.enum';

import { ShortlistService } from './shortlist.service';

import type { InMemoryRepository } from '../../../../test/fixtures';

/**
 * **The shortlist — C-20, C-21, C-32, §4.20.**
 *
 * The two rules worth proving are the ones §4.20 had to pin down because they are
 * otherwise ambiguous: a rejection is kept but never appears on the shortlist or in the
 * budget total, and ordering is contiguous after every write. The third is E-7: another
 * consumer's shortlist is unreachable, and unreachable in a way that tells the caller
 * nothing.
 */
describe('ShortlistService', () => {
  const her: ICurrentUser = sessionFor(Role.CONSUMER);
  const someoneElse: ICurrentUser = sessionFor(Role.CONSUMER, {
    id: 'd0000000-0000-4000-8000-00000000000d',
  });

  interface Harness {
    service: ShortlistService;
    items: InMemoryRepository<ShortlistItem>;
    transaction: TransactionState;
    close: () => Promise<void>;
  }

  async function arrange(
    options: {
      items?: readonly ShortlistItem[];
      garments?: readonly Garment[];
      results?: readonly TryOnResult[];
      budgetBand?: BudgetBand | null;
    } = {},
  ): Promise<Harness> {
    const items = createInMemoryRepository<ShortlistItem>({
      rows: options.items ?? [],
      // Real instances with sane defaults, so a row created by the service under test
      // carries the same shape as one loaded from PostgreSQL would.
      create: (partial) => buildShortlistItem(partial),
    });
    const garments = createInMemoryRepository<Garment>({ rows: options.garments ?? [] });
    const results = createInMemoryRepository<TryOnResult>({ rows: options.results ?? [] });
    const profiles = createInMemoryRepository<ConsumerProfile>({
      rows:
        options.budgetBand === undefined
          ? []
          : [
              buildEntity<ConsumerProfile>(
                ConsumerProfile,
                { id: uuid(), userId: her.id, budgetBand: options.budgetBand },
                {},
              ),
            ],
    });

    const manager = createFakeEntityManager(
      new Map<new (...args: never[]) => object, unknown>([[ShortlistItem, items]]),
    );
    const { dataSource, state } = createTransactionalDataSource(manager);

    const storage = createMock<StorageService>(['signedUrl']);
    storage.signedUrl.mockImplementation((key: string) => `https://api.test/files/${key}`);

    const harness = await createTestingModule({
      providers: [ShortlistService],
      overrides: [
        { token: getRepositoryToken(ShortlistItem), value: items },
        { token: getRepositoryToken(Garment), value: garments },
        { token: getRepositoryToken(TryOnResult), value: results },
        { token: getRepositoryToken(ConsumerProfile), value: profiles },
        { token: StorageService, value: storage },
        { token: DataSource, value: dataSource },
      ],
    });

    return {
      service: harness.get<ShortlistService>(ShortlistService),
      items,
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

  /* --------------------------------------------------------------------------------------- */

  describe('§4.20 — a rejection is kept, and never appears on the shortlist', () => {
    it('lists Love it and Maybe, in rank order, and not Not for me', async () => {
      const loved = buildShortlistItem({ userId: her.id, rank: 2 });
      const maybe = buildMaybeShortlistItem({ userId: her.id, rank: 1 });
      const rejected = buildRejectedShortlistItem(RejectReason.TOO_HEAVY, { userId: her.id });

      const harness = await arrange({
        items: [loved, maybe, rejected],
        garments: [
          buildPublishedGarment({ id: loved.garmentId, price: 200_000 }),
          buildPublishedGarment({ id: maybe.garmentId, price: 100_000 }),
          buildPublishedGarment({ id: rejected.garmentId, price: 900_000 }),
        ],
      });

      const shortlist = await harness.service.list(her);

      expect(shortlist.items.map((item) => item.id)).toEqual([maybe.id, loved.id]);
      expect(shortlist.items.map((item) => item.verdict)).not.toContain(Verdict.NOT_FOR_ME);

      await harness.close();
    });

    it('keeps the rejection row, with its reason, for the A-38 rollup', async () => {
      const rejected = buildRejectedShortlistItem(RejectReason.NECKLINE, { userId: her.id });
      const harness = await arrange({ items: [rejected] });

      await harness.service.list(her);

      expect(harness.items.$rows).toHaveLength(1);
      expect(harness.items.$rows[0]).toMatchObject({
        verdict: Verdict.NOT_FOR_ME,
        rejectReason: RejectReason.NECKLINE,
        rank: null,
      });

      await harness.close();
    });

    it('leaves a rejected piece out of the running total', async () => {
      const loved = buildShortlistItem({ userId: her.id, rank: 1 });
      const rejected = buildRejectedShortlistItem(RejectReason.PRICE, { userId: her.id });

      const harness = await arrange({
        items: [loved, rejected],
        garments: [
          buildPublishedGarment({ id: loved.garmentId, price: 150_000 }),
          buildPublishedGarment({ id: rejected.garmentId, price: 900_000 }),
        ],
      });

      const shortlist = await harness.service.list(her);

      expect(shortlist.budget.total).toBe(150_000);
      expect(shortlist.budget.itemCount).toBe(1);

      await harness.close();
    });
  });

  describe('C-32 — the running total against her stated budget', () => {
    it('measures the total against the band on her profile', async () => {
      const loved = buildShortlistItem({ userId: her.id, rank: 1 });
      const harness = await arrange({
        items: [loved],
        garments: [buildPublishedGarment({ id: loved.garmentId, price: 300_000 })],
        budgetBand: BudgetBand.BAND_250K_500K,
      });

      const { budget } = await harness.service.list(her);

      expect(budget).toMatchObject({
        total: 300_000,
        budgetBand: BudgetBand.BAND_250K_500K,
        budgetCeiling: 500_000,
        withinBudget: true,
      });

      await harness.close();
    });

    it('says she is over when she is', async () => {
      const loved = buildShortlistItem({ userId: her.id, rank: 1 });
      const harness = await arrange({
        items: [loved],
        garments: [buildPublishedGarment({ id: loved.garmentId, price: 600_000 })],
        budgetBand: BudgetBand.BAND_250K_500K,
      });

      expect((await harness.service.list(her)).budget.withinBudget).toBe(false);

      await harness.close();
    });

    it('says nothing either way when she has stated no band', async () => {
      const loved = buildShortlistItem({ userId: her.id, rank: 1 });
      const harness = await arrange({
        items: [loved],
        garments: [buildPublishedGarment({ id: loved.garmentId, price: 600_000 })],
      });

      const { budget } = await harness.service.list(her);

      // Not false. A consumer who never named a budget is neither within it nor over it.
      expect(budget.withinBudget).toBeNull();
      expect(budget.budgetCeiling).toBeNull();

      await harness.close();
    });
  });

  describe('C-20 / C-21 — recording a verdict', () => {
    it('upserts the one row per (userId, garmentId) rather than adding a second', async () => {
      const garment = buildPublishedGarment();
      const existing = buildShortlistItem({
        userId: her.id,
        garmentId: garment.id,
        rank: 1,
        verdict: Verdict.LOVE_IT,
      });
      const harness = await arrange({ items: [existing], garments: [garment] });

      const updated = await harness.service.recordVerdict(her, {
        garmentId: garment.id,
        verdict: Verdict.MAYBE,
      });

      expect(harness.items.$rows).toHaveLength(1);
      expect(updated.verdict).toBe(Verdict.MAYBE);
      // Re-tapping a verdict is not a request to reorder her list.
      expect(updated.rank).toBe(1);

      await harness.close();
    });

    it('adds a new piece at the bottom of the list', async () => {
      const first = buildShortlistItem({ userId: her.id, rank: 1 });
      const garment = buildPublishedGarment();
      const harness = await arrange({
        items: [first],
        garments: [garment, buildPublishedGarment({ id: first.garmentId })],
      });

      const added = await harness.service.recordVerdict(her, { garmentId: garment.id });

      expect(added.verdict).toBe(Verdict.LOVE_IT);
      expect(added.rank).toBe(2);

      await harness.close();
    });

    it('drops the rank when a piece is rejected, and closes the gap', async () => {
      const garment = buildPublishedGarment();
      const first = buildShortlistItem({ userId: her.id, garmentId: garment.id, rank: 1 });
      const second = buildShortlistItem({ userId: her.id, rank: 2 });
      const harness = await arrange({
        items: [first, second],
        garments: [garment, buildPublishedGarment({ id: second.garmentId })],
      });

      await harness.service.recordVerdict(her, {
        garmentId: garment.id,
        verdict: Verdict.NOT_FOR_ME,
        rejectReason: RejectReason.SILHOUETTE,
      });

      const rejected = harness.items.$rows.find((row) => row.id === first.id);
      const survivor = harness.items.$rows.find((row) => row.id === second.id);

      expect(rejected).toMatchObject({ rank: null, rejectReason: RejectReason.SILHOUETTE });
      expect(survivor?.rank).toBe(1);

      await harness.close();
    });

    it('ignores a reject reason that arrives without a rejection', async () => {
      const garment = buildPublishedGarment();
      const harness = await arrange({ garments: [garment] });

      const added = await harness.service.recordVerdict(her, {
        garmentId: garment.id,
        verdict: Verdict.LOVE_IT,
        rejectReason: RejectReason.PRICE,
      });

      // A reason without a rejection would corrupt the A-38 rollup.
      expect(added.rejectReason).toBeNull();

      await harness.close();
    });

    it('refuses a verdict on a piece that does not exist', async () => {
      const harness = await arrange();

      expect(
        await errorCodeOf(
          harness.service.recordVerdict(her, {
            garmentId: 'f0000000-0000-4000-8000-00000000000f',
          }),
        ),
      ).toBe(ErrorCode.GARMENT_NOT_FOUND);

      await harness.close();
    });

    it('silently drops a render that is not hers rather than confirming it exists', async () => {
      const garment = buildPublishedGarment();
      const notHers = buildTryOnResult({ userId: someoneElse.id });
      const harness = await arrange({ garments: [garment], results: [notHers] });

      const added = await harness.service.recordVerdict(her, {
        garmentId: garment.id,
        resultId: notHers.id,
      });

      expect(added.latestResultId).toBeNull();
      expect(added.renderThumbnailUrl).toBeNull();

      await harness.close();
    });
  });

  describe('C-32 — drag-to-rank, atomically', () => {
    it('renumbers the whole set inside one committed transaction', async () => {
      const a = buildShortlistItem({ userId: her.id, rank: 1 });
      const b = buildShortlistItem({ userId: her.id, rank: 2 });
      const c = buildShortlistItem({ userId: her.id, rank: 3 });
      const harness = await arrange({
        items: [a, b, c],
        garments: [a, b, c].map((item) => buildPublishedGarment({ id: item.garmentId })),
      });

      const reordered = await harness.service.reorder(her, { itemIds: [c.id, a.id, b.id] });

      expect(reordered.items.map((item) => item.id)).toEqual([c.id, a.id, b.id]);
      expect(reordered.items.map((item) => item.rank)).toEqual([1, 2, 3]);
      expect(harness.transaction).toMatchObject({ started: 1, committed: 1, rolledBack: 0 });

      await harness.close();
    });

    it('refuses a partial set rather than merging it', async () => {
      const a = buildShortlistItem({ userId: her.id, rank: 1 });
      const b = buildShortlistItem({ userId: her.id, rank: 2 });
      const harness = await arrange({ items: [a, b] });

      expect(await errorCodeOf(harness.service.reorder(her, { itemIds: [a.id] }))).toBe(
        ErrorCode.VALIDATION_ERROR,
      );

      // The previous order survives intact.
      expect(harness.items.$rows.map((row) => row.rank)).toEqual([1, 2]);

      await harness.close();
    });

    it('refuses a set naming a rejected piece — it is not on the shortlist', async () => {
      const a = buildShortlistItem({ userId: her.id, rank: 1 });
      const rejected = buildRejectedShortlistItem(RejectReason.COLOR, { userId: her.id });
      const harness = await arrange({ items: [a, rejected] });

      expect(
        await errorCodeOf(harness.service.reorder(her, { itemIds: [rejected.id, a.id] })),
      ).toBe(ErrorCode.VALIDATION_ERROR);

      await harness.close();
    });

    it('refuses a set naming another consumer’s item', async () => {
      const mine = buildShortlistItem({ userId: her.id, rank: 1 });
      const theirs = buildShortlistItem({ userId: someoneElse.id, rank: 1 });
      const harness = await arrange({ items: [mine, theirs] });

      expect(
        await errorCodeOf(harness.service.reorder(her, { itemIds: [mine.id, theirs.id] })),
      ).toBe(ErrorCode.VALIDATION_ERROR);

      await harness.close();
    });
  });

  describe('removing a piece', () => {
    it('soft-deletes it and closes the gap it leaves', async () => {
      const a = buildShortlistItem({ userId: her.id, rank: 1 });
      const b = buildShortlistItem({ userId: her.id, rank: 2 });
      const c = buildShortlistItem({ userId: her.id, rank: 3 });
      const harness = await arrange({ items: [a, b, c] });

      await harness.service.remove(her, b.id);

      expect(harness.items.$rows.find((row) => row.id === b.id)?.deletedAt).not.toBeNull();
      expect(harness.items.$rows.find((row) => row.id === a.id)?.rank).toBe(1);
      expect(harness.items.$rows.find((row) => row.id === c.id)?.rank).toBe(2);

      await harness.close();
    });

    it('records no rejection reason — removing is not rejecting', async () => {
      const a = buildShortlistItem({ userId: her.id, rank: 1 });
      const harness = await arrange({ items: [a] });

      await harness.service.remove(her, a.id);

      expect(harness.items.$rows[0]?.rejectReason).toBeNull();
      expect(harness.items.$rows[0]?.verdict).toBe(Verdict.LOVE_IT);

      await harness.close();
    });
  });

  describe('E-7 — one consumer cannot reach another’s shortlist', () => {
    it('never lists it', async () => {
      const mine = buildShortlistItem({ userId: her.id, rank: 1 });
      const theirs = buildShortlistItem({ userId: someoneElse.id, rank: 1 });
      const harness = await arrange({
        items: [mine, theirs],
        garments: [mine, theirs].map((item) => buildPublishedGarment({ id: item.garmentId })),
      });

      const shortlist = await harness.service.list(her);

      expect(shortlist.items).toHaveLength(1);
      expect(shortlist.items[0]?.id).toBe(mine.id);

      await harness.close();
    });

    it.each([
      ['reading through an update', 'update'],
      ['deleting', 'remove'],
    ])('refuses %s with the code the client sees masked from', async (_case, operation) => {
      const theirs = buildShortlistItem({ userId: someoneElse.id, rank: 1 });
      const harness = await arrange({ items: [theirs] });

      const work =
        operation === 'update'
          ? harness.service.update(her, theirs.id, { note: 'not mine to annotate' })
          : harness.service.remove(her, theirs.id);

      expect(await errorCodeOf(work)).toBe(ErrorCode.SHORTLIST_ITEM_NOT_OWNED);
      expect(harness.items.$rows[0]?.note).toBeNull();

      await harness.close();
    });

    it('answers NOT_FOUND for an id that belongs to nobody', async () => {
      const harness = await arrange();

      expect(
        await errorCodeOf(harness.service.remove(her, 'f0000000-0000-4000-8000-00000000000f')),
      ).toBe(ErrorCode.SHORTLIST_ITEM_NOT_FOUND);

      await harness.close();
    });
  });

  describe('updating a note or a verdict', () => {
    it('saves a note and clears it again', async () => {
      const item = buildShortlistItem({ userId: her.id, rank: 1 });
      const harness = await arrange({
        items: [item],
        garments: [buildPublishedGarment({ id: item.garmentId })],
      });

      expect((await harness.service.update(her, item.id, { note: 'For the Mehndi' })).note).toBe(
        'For the Mehndi',
      );
      expect((await harness.service.update(her, item.id, { note: null })).note).toBeNull();

      await harness.close();
    });

    it('moving a piece to Not for me takes it off the list', async () => {
      const item = buildShortlistItem({ userId: her.id, rank: 1 });
      const harness = await arrange({
        items: [item],
        garments: [buildPublishedGarment({ id: item.garmentId })],
      });

      await harness.service.update(her, item.id, {
        verdict: Verdict.NOT_FOR_ME,
        rejectReason: RejectReason.TOO_HEAVY,
      });

      expect((await harness.service.list(her)).items).toHaveLength(0);
      expect(harness.items.$rows[0]).toMatchObject({
        verdict: Verdict.NOT_FOR_ME,
        rank: null,
        rejectReason: RejectReason.TOO_HEAVY,
      });

      await harness.close();
    });
  });

  describe('rankedItems — the one definition share and enquiries both read', () => {
    it('returns Love it and Maybe in rank order, and never a rejection', async () => {
      const loved = buildShortlistItem({ userId: her.id, rank: 2 });
      const maybe = buildMaybeShortlistItem({ userId: her.id, rank: 1 });
      const rejected = buildRejectedShortlistItem(RejectReason.PRICE, { userId: her.id });
      const harness = await arrange({ items: [loved, maybe, rejected] });

      const ranked = await harness.service.rankedItems(her.id);

      expect(ranked.map((item) => item.id)).toEqual([maybe.id, loved.id]);

      await harness.close();
    });
  });
});
