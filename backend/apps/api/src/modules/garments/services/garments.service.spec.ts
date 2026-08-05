import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DataSource, type SelectQueryBuilder } from 'typeorm';

import { ErrorCode, Role } from '@library/common';
import type { ICurrentUser, SortOrder } from '@library/common';

import { AUDIT_RECORD_EVENT, type AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { CategoriesService } from '@api/modules/categories';
import { SettingsService } from '@api/modules/settings';
import {
  createFakeEntityManager,
  createTransactionalDataSource,
  type TransactionState,
} from '@api/modules/users/testing/query-doubles';
import { sessionFor } from '@api/modules/users/testing/route-authorisation';
import { AUDIT_ACTIONS } from '@api/shared/constants/audit-actions.constant';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import {
  buildArchivedGarment,
  buildCategory,
  buildGarment,
  buildPublishedGarment,
  buildRentalGarment,
} from '../../../../test/factories';
import {
  createInMemoryRepository,
  createMock,
  createTestingModule,
} from '../../../../test/fixtures';
import { GarmentBulkAction } from '../dto/garment-bulk.dto';
import { GARMENT_SORT_KEYS, type GarmentSortKey } from '../dto/garment-query.dto';
import { GarmentImage } from '../entities/garment-image.entity';
import { Garment } from '../entities/garment.entity';
import { EmbellishmentWeight } from '../enums/embellishment-weight.enum';
import { GarmentMode } from '../enums/garment-mode.enum';
import { PublishState } from '../enums/publish-state.enum';
import { TestRenderState } from '../enums/test-render-state.enum';
import { starRateOf } from '../mappers/garment.mapper';

import { GarmentsService, STAR_RATE_SQL } from './garments.service';

import type { InMemoryRepository } from '../../../../test/fixtures';
import type { CreateGarmentDto } from '../dto/create-garment.dto';

const MIN_QUALITY_SCORE = 70;

/** A `garment_images` row. There is no shared factory for these — the module owns them. */
function buildTryOnSource(garmentId: string): GarmentImage {
  return Object.assign(new GarmentImage(), {
    id: `image-${garmentId}`,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    garmentId,
    storageKey: `garments/${garmentId}/source.webp`,
    thumbnailKey: null,
    isTryOnSource: true,
    hash: '0'.repeat(64),
    width: 2400,
    height: 3200,
    byteSize: 1_200_000,
    mimeType: 'image/webp',
    position: 0,
    altText: null,
  });
}

/**
 * `GarmentsService` — PRD A-8, A-10 … A-14.
 *
 * The load-bearing cases: **publish is refused without an approved test render**
 * (A-11 / E-10) and **without an override when quality is below threshold** (A-10),
 * and neither refusal can be reached around by the bulk route.
 */
describe('GarmentsService', () => {
  const admin: ICurrentUser = sessionFor(Role.ADMIN);

  interface Harness {
    service: GarmentsService;
    garments: InMemoryRepository<Garment>;
    images: InMemoryRepository<GarmentImage>;
    categories: jest.Mocked<CategoriesService>;
    settings: jest.Mocked<SettingsService>;
    events: jest.Mocked<EventEmitter2>;
    transaction: TransactionState;
    close: () => Promise<void>;
  }

  async function arrange(
    garmentRows: readonly Garment[] = [],
    imageRows: readonly GarmentImage[] = [],
  ): Promise<Harness> {
    const garments = createInMemoryRepository<Garment>({ rows: garmentRows });
    const images = createInMemoryRepository<GarmentImage>({ rows: imageRows });
    const manager = createFakeEntityManager(
      new Map<new (...args: never[]) => object, unknown>([
        [Garment, garments],
        [GarmentImage, images],
      ]),
    );
    const { dataSource, state } = createTransactionalDataSource(manager);

    const categories = createMock<CategoriesService>([
      'requireOpenCategory',
      'findById',
      'findByIds',
      'applyPublishedGarmentDelta',
    ]);
    categories.requireOpenCategory.mockResolvedValue(buildCategory());
    categories.findById.mockResolvedValue(buildCategory({ name: 'Bridal' }));
    categories.findByIds.mockResolvedValue(new Map());
    categories.applyPublishedGarmentDelta.mockResolvedValue(undefined);

    const settings = createMock<SettingsService>(['getNumber']);
    settings.getNumber.mockResolvedValue(MIN_QUALITY_SCORE);

    const events = createMock<EventEmitter2>(['emit']);

    const harness = await createTestingModule({
      providers: [GarmentsService],
      overrides: [
        { token: getRepositoryToken(Garment), value: garments },
        { token: getRepositoryToken(GarmentImage), value: images },
        { token: CategoriesService, value: categories },
        { token: SettingsService, value: settings },
        { token: DataSource, value: dataSource },
        { token: EventEmitter2, value: events },
      ],
    });

    return {
      service: harness.get<GarmentsService>(GarmentsService),
      garments,
      images,
      categories,
      settings,
      events,
      transaction: state,
      close: harness.close,
    };
  }

  function auditActions(events: jest.Mocked<EventEmitter2>): string[] {
    return events.emit.mock.calls
      .filter(([name]) => name === AUDIT_RECORD_EVENT)
      .map(([, event]) => (event as AuditRecordEvent).input.action);
  }

  const validCreate = (overrides: Partial<CreateGarmentDto> = {}): CreateGarmentDto => ({
    sku: 'ZBL-00042',
    title: 'Zarrin Bridal Lehenga',
    categoryId: '11111111-2222-4333-8444-555555555555',
    embellishmentWeight: EmbellishmentWeight.HEAVY,
    price: 185_000,
    mode: GarmentMode.SALE,
    ...overrides,
  });

  /* --------------------------------------------------------------------------------------- */

  describe('A-11 / E-10 — publish is refused without an approved test render', () => {
    it.each([
      ['no test render', TestRenderState.NONE],
      ['a pending test render', TestRenderState.PENDING],
      ['a rejected test render', TestRenderState.REJECTED],
    ])('refuses %s with TEST_RENDER_REQUIRED', async (_case, testRenderState) => {
      const garment = buildGarment({ testRenderState, testRenderApprovedAt: null });
      const harness = await arrange([garment], [buildTryOnSource(garment.id)]);

      await expect(harness.service.publish(garment.id, admin)).rejects.toMatchObject({
        errorCode: ErrorCode.TEST_RENDER_REQUIRED,
      });

      expect(harness.garments.$rows[0]?.publishState).toBe(PublishState.DRAFT);
      expect(harness.transaction.committed).toBe(0);
      expect(harness.categories.applyPublishedGarmentDelta).not.toHaveBeenCalled();
      expect(auditActions(harness.events)).toEqual([]);

      await harness.close();
    });

    it('refuses an APPROVED state with no approval timestamp', async () => {
      const garment = buildGarment({
        testRenderState: TestRenderState.APPROVED,
        testRenderApprovedAt: null,
        qualityScore: 95,
      });
      const harness = await arrange([garment], [buildTryOnSource(garment.id)]);

      await expect(harness.service.publish(garment.id, admin)).rejects.toMatchObject({
        errorCode: ErrorCode.TEST_RENDER_REQUIRED,
      });

      await harness.close();
    });

    it('refuses when the try-on source image is gone', async () => {
      const garment = buildPublishedGarment({
        publishState: PublishState.DRAFT,
        publishedAt: null,
      });
      const harness = await arrange([garment], []);

      await expect(harness.service.publish(garment.id, admin)).rejects.toMatchObject({
        errorCode: ErrorCode.TRYON_SOURCE_REQUIRED,
      });

      await harness.close();
    });

    it('publishes once the gate is clear, and moves the A-7 counter in the same transaction', async () => {
      const garment = buildPublishedGarment({
        publishState: PublishState.DRAFT,
        publishedAt: null,
        qualityScore: 88,
      });
      const harness = await arrange([garment], [buildTryOnSource(garment.id)]);

      const published = await harness.service.publish(garment.id, admin);

      expect(published.publishState).toBe(PublishState.PUBLISHED);
      expect(published.publishedAt).toBeInstanceOf(Date);
      expect(harness.categories.applyPublishedGarmentDelta).toHaveBeenCalledWith(
        expect.anything(),
        garment.categoryId,
        1,
      );
      expect(harness.transaction.committed).toBe(1);
      expect(auditActions(harness.events)).toEqual([AUDIT_ACTIONS.GARMENT_PUBLISHED]);

      await harness.close();
    });
  });

  describe('A-10 — publish is refused below threshold without an override', () => {
    it('refuses a low score with QUALITY_OVERRIDE_REQUIRED', async () => {
      const garment = buildPublishedGarment({
        publishState: PublishState.DRAFT,
        publishedAt: null,
        qualityScore: MIN_QUALITY_SCORE - 1,
      });
      const harness = await arrange([garment], [buildTryOnSource(garment.id)]);

      await expect(harness.service.publish(garment.id, admin)).rejects.toMatchObject({
        errorCode: ErrorCode.QUALITY_OVERRIDE_REQUIRED,
      });

      expect(harness.garments.$rows[0]?.publishState).toBe(PublishState.DRAFT);

      await harness.close();
    });

    it('reads the threshold through the cached SettingsService getter, never the table', async () => {
      const garment = buildPublishedGarment({ publishState: PublishState.DRAFT, qualityScore: 50 });
      const harness = await arrange([garment], [buildTryOnSource(garment.id)]);

      await harness.service.publish(garment.id, admin).catch(() => undefined);

      // A-10 / §4.28: the threshold comes from the registry key through the cached
      // getter. Nothing in this module may reach the `settings` table directly.
      expect(harness.settings.getNumber).toHaveBeenCalledWith(SETTINGS_KEYS.QUALITY_MIN_SCORE);

      await harness.close();
    });

    it('publishes after an override is recorded, and audits the override', async () => {
      const garment = buildPublishedGarment({
        publishState: PublishState.DRAFT,
        publishedAt: null,
        qualityScore: 20,
      });
      const harness = await arrange([garment], [buildTryOnSource(garment.id)]);

      const overridden = await harness.service.recordQualityOverride(
        garment.id,
        { reason: 'Archive piece — the only surviving photograph.' },
        admin,
      );
      expect(overridden.qualityOverridden).toBe(true);
      expect(auditActions(harness.events)).toEqual([AUDIT_ACTIONS.GARMENT_QUALITY_OVERRIDDEN]);

      const published = await harness.service.publish(garment.id, admin);
      expect(published.publishState).toBe(PublishState.PUBLISHED);

      await harness.close();
    });

    it('does not let an override clear the A-11 gate as well', async () => {
      const garment = buildGarment({
        testRenderState: TestRenderState.NONE,
        testRenderApprovedAt: null,
        qualityScore: 10,
      });
      const harness = await arrange([garment], [buildTryOnSource(garment.id)]);

      await harness.service.recordQualityOverride(
        garment.id,
        { reason: 'A perfectly good reason, at length.' },
        admin,
      );

      await expect(harness.service.publish(garment.id, admin)).rejects.toMatchObject({
        errorCode: ErrorCode.TEST_RENDER_REQUIRED,
      });

      await harness.close();
    });
  });

  describe('the publish state machine (A-13, §4.13)', () => {
    it('refuses DRAFT → ARCHIVED', async () => {
      const garment = buildGarment();
      const harness = await arrange([garment]);

      await expect(harness.service.archive(garment.id, admin)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_PUBLISH_TRANSITION,
      });

      await harness.close();
    });

    it('refuses ARCHIVED → DRAFT', async () => {
      const garment = buildArchivedGarment();
      const harness = await arrange([garment]);

      await expect(harness.service.unpublish(garment.id, admin)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_PUBLISH_TRANSITION,
      });

      await harness.close();
    });

    it('archives without deleting anything, keeping the analytics history (A-13)', async () => {
      const garment = buildPublishedGarment({
        tryOnCount: 41,
        loveCount: 30,
        maybeCount: 6,
        rejectCount: 4,
        enquiryCount: 5,
      });
      const harness = await arrange([garment], [buildTryOnSource(garment.id)]);

      const archived = await harness.service.archive(garment.id, admin);

      expect(archived.publishState).toBe(PublishState.ARCHIVED);
      expect(harness.garments.$rows).toHaveLength(1);
      expect(harness.garments.$rows[0]?.deletedAt).toBeNull();
      expect(archived.tryOnCount).toBe(41);
      expect(archived.loveCount).toBe(30);
      expect(archived.enquiryCount).toBe(5);
      // Still dated, because an archived piece is one that *was* live.
      expect(archived.publishedAt).not.toBeNull();
      expect(harness.categories.applyPublishedGarmentDelta).toHaveBeenCalledWith(
        expect.anything(),
        garment.categoryId,
        -1,
      );

      await harness.close();
    });

    it('unpublishes back to draft', async () => {
      const garment = buildPublishedGarment();
      const harness = await arrange([garment], [buildTryOnSource(garment.id)]);

      const draft = await harness.service.unpublish(garment.id, admin);

      expect(draft.publishState).toBe(PublishState.DRAFT);
      expect(auditActions(harness.events)).toEqual([AUDIT_ACTIONS.GARMENT_UNPUBLISHED]);

      await harness.close();
    });

    it('re-validates an archived garment on its way back to published', async () => {
      const garment = buildArchivedGarment({
        testRenderState: TestRenderState.REJECTED,
        testRenderApprovedAt: null,
      });
      const harness = await arrange([garment], [buildTryOnSource(garment.id)]);

      await expect(harness.service.publish(garment.id, admin)).rejects.toMatchObject({
        errorCode: ErrorCode.TEST_RENDER_REQUIRED,
      });

      await harness.close();
    });
  });

  describe('A-8 — the rental/deposit rule', () => {
    it('refuses a rental with no deposit', async () => {
      const harness = await arrange([]);

      await expect(
        harness.service.create(validCreate({ mode: GarmentMode.RENTAL }), admin),
      ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_ERROR });

      await harness.close();
    });

    it('refuses a sale carrying a deposit', async () => {
      const harness = await arrange([]);

      await expect(
        harness.service.create(validCreate({ mode: GarmentMode.SALE, deposit: 1000 }), admin),
      ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_ERROR });

      await harness.close();
    });

    it('accepts a rental with a deposit', async () => {
      const harness = await arrange([]);

      const created = await harness.service.create(
        validCreate({ mode: GarmentMode.RENTAL, deposit: 45_000 }),
        admin,
      );

      expect(created.mode).toBe(GarmentMode.RENTAL);
      expect(created.deposit).toBe(45_000);
      expect(created.publishState).toBe(PublishState.DRAFT);

      await harness.close();
    });

    it('re-checks the merged record when a PATCH changes only the mode', async () => {
      // The DTO cannot catch this: `deposit` was never in the payload.
      const garment = buildRentalGarment();
      const harness = await arrange([garment]);

      await expect(
        harness.service.update(garment.id, { mode: GarmentMode.SALE }, admin),
      ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_ERROR });

      await harness.close();
    });

    it('accepts a mode change that clears the deposit in the same request', async () => {
      const garment = buildRentalGarment();
      const harness = await arrange([garment]);

      const updated = await harness.service.update(
        garment.id,
        { mode: GarmentMode.SALE, deposit: null },
        admin,
      );

      expect(updated.mode).toBe(GarmentMode.SALE);
      expect(updated.deposit).toBeNull();

      await harness.close();
    });
  });

  describe('create and update', () => {
    it('refuses a duplicate SKU', async () => {
      const existing = buildGarment({ sku: 'ZBL-00042' });
      const harness = await arrange([existing]);

      await expect(harness.service.create(validCreate(), admin)).rejects.toMatchObject({
        errorCode: ErrorCode.GARMENT_SKU_EXISTS,
      });

      await harness.close();
    });

    it('refuses a category that is archived or missing', async () => {
      const harness = await arrange([]);
      harness.categories.requireOpenCategory.mockRejectedValue(
        Object.assign(new Error('archived'), { errorCode: ErrorCode.CATEGORY_ARCHIVED }),
      );

      await expect(harness.service.create(validCreate(), admin)).rejects.toThrow('archived');

      await harness.close();
    });

    it('audits a re-categorisation and moves both counters for a published piece', async () => {
      const garment = buildPublishedGarment();
      const harness = await arrange([garment], [buildTryOnSource(garment.id)]);
      const destination = '99999999-8888-4777-8666-555555555555';
      // Captured before the write: the service mutates the loaded row in place.
      const origin = garment.categoryId;

      await harness.service.update(garment.id, { categoryId: destination }, admin);

      expect(harness.categories.applyPublishedGarmentDelta).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        origin,
        -1,
      );
      expect(harness.categories.applyPublishedGarmentDelta).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        destination,
        1,
      );
      expect(auditActions(harness.events)).toEqual([
        AUDIT_ACTIONS.GARMENT_UPDATED,
        AUDIT_ACTIONS.GARMENT_RECATEGORISED,
      ]);
      expect(harness.transaction.committed).toBe(1);

      await harness.close();
    });
  });

  describe('D-17 — delete requires typing the title', () => {
    it('refuses a mismatched confirmation', async () => {
      const garment = buildGarment({ title: 'Zarrin Bridal Lehenga' });
      const harness = await arrange([garment]);

      await expect(
        harness.service.remove(garment.id, { confirmTitle: 'Zarrin' }, admin),
      ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_ERROR });

      expect(harness.garments.$rows[0]?.deletedAt).toBeNull();

      await harness.close();
    });

    it('soft-deletes on an exact match and decrements the A-7 counter when published', async () => {
      const garment = buildPublishedGarment({ title: 'Zarrin Bridal Lehenga' });
      const harness = await arrange([garment]);

      await harness.service.remove(garment.id, { confirmTitle: '  zarrin bridal lehenga ' }, admin);

      expect(harness.garments.$rows[0]?.deletedAt).not.toBeNull();
      expect(harness.categories.applyPublishedGarmentDelta).toHaveBeenCalledWith(
        expect.anything(),
        garment.categoryId,
        -1,
      );
      expect(auditActions(harness.events)).toEqual([AUDIT_ACTIONS.GARMENT_DELETED]);

      await harness.close();
    });
  });

  describe('A-12 / D-16 — bulk actions cannot route around a gate', () => {
    it('applies the A-11 gate item by item and reports per-item results', async () => {
      const ready = buildPublishedGarment({ publishState: PublishState.DRAFT, publishedAt: null });
      const unproven = buildGarment({
        testRenderState: TestRenderState.NONE,
        testRenderApprovedAt: null,
      });
      const harness = await arrange(
        [ready, unproven],
        [buildTryOnSource(ready.id), buildTryOnSource(unproven.id)],
      );

      const result = await harness.service.bulk(
        { action: GarmentBulkAction.PUBLISH, garmentIds: [ready.id, unproven.id] },
        admin,
      );

      expect(result.requested).toBe(2);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results).toEqual([
        { garmentId: ready.id, succeeded: true, errorCode: null, message: null },
        {
          garmentId: unproven.id,
          succeeded: false,
          errorCode: ErrorCode.TEST_RENDER_REQUIRED,
          message: expect.any(String),
        },
      ]);

      expect(harness.garments.$rows.find((row) => row.id === unproven.id)?.publishState).toBe(
        PublishState.DRAFT,
      );
      expect(auditActions(harness.events)).toContain(AUDIT_ACTIONS.GARMENT_BULK_ACTION_APPLIED);

      await harness.close();
    });

    it('reports a missing garment as a per-item failure, not a request failure', async () => {
      const harness = await arrange([]);

      const result = await harness.service.bulk(
        {
          action: GarmentBulkAction.ARCHIVE,
          garmentIds: ['11111111-2222-4333-8444-555555555555'],
        },
        admin,
      );

      expect(result.failed).toBe(1);
      expect(result.results[0]?.errorCode).toBe(ErrorCode.GARMENT_NOT_FOUND);

      await harness.close();
    });
  });

  describe('A-14 — "highest star rate" means the same thing in SQL and in the mapper', () => {
    it('computes the love share of the verdicts cast', () => {
      expect(starRateOf(buildGarment({ loveCount: 3, maybeCount: 1, rejectCount: 0 }))).toBe(0.75);
      expect(starRateOf(buildGarment({ loveCount: 0, maybeCount: 0, rejectCount: 0 }))).toBeNull();
      expect(starRateOf(buildGarment({ tryOnCount: 40, loveCount: 1, maybeCount: 1 }))).toBe(0.5);
    });

    it('uses the same numerator and denominator in the ORDER BY expression', () => {
      // The SQL must not quietly divide by tryOnCount while the mapper divides by
      // verdicts cast — a list sorted one way and labelled the other is a bug nobody
      // reports because both halves look right on their own.
      expect(STAR_RATE_SQL).toContain('garment.loveCount');
      expect(STAR_RATE_SQL).toContain(
        'NULLIF(garment.loveCount + garment.maybeCount + garment.rejectCount, 0)',
      );
      expect(STAR_RATE_SQL).not.toContain('tryOnCount');
    });
  });

  /**
   * §2.8 — a sort key reaches `ORDER BY` by string interpolation, because SQL has no
   * parameter form for a column name. `GarmentQueryDto`'s `@IsIn` is the gate for the
   * one HTTP caller that exists today; these are about the gate that has to hold for
   * the caller that does not exist yet — a second DTO that forgets `@IsIn`, or anything
   * that builds a query object by hand and never passes through validation at all.
   */
  describe('§2.8 — ORDER BY is built from the closed key list, never from the input', () => {
    interface OrderingInternals {
      applyOrdering(
        qb: SelectQueryBuilder<Garment>,
        sortBy: GarmentSortKey,
        sortOrder: SortOrder,
      ): void;
    }

    function stubBuilder(): { qb: SelectQueryBuilder<Garment>; orderBy: jest.Mock } {
      const orderBy = jest.fn();
      const addOrderBy = jest.fn();
      return {
        qb: { orderBy, addOrderBy } as unknown as SelectQueryBuilder<Garment>,
        orderBy,
      };
    }

    async function ordering(): Promise<{
      apply: OrderingInternals['applyOrdering'];
      close: () => Promise<void>;
    }> {
      const harness = await arrange();
      const internals = harness.service as unknown as OrderingInternals;
      return {
        apply: internals.applyOrdering.bind(harness.service),
        close: harness.close,
      };
    }

    it.each(GARMENT_SORT_KEYS.filter((key) => key !== 'starRate'))(
      'orders by the column for %s',
      async (sortBy) => {
        const { apply, close } = await ordering();
        const { qb, orderBy } = stubBuilder();

        apply(qb, sortBy, 'DESC');

        expect(orderBy).toHaveBeenCalledWith(`garment.${sortBy}`, 'DESC', 'NULLS LAST');
        await close();
      },
    );

    it.each([
      'createdAt; DROP TABLE garments--',
      'createdAt, (SELECT password FROM users LIMIT 1)',
      'id) --',
      '',
    ])('refuses %p rather than interpolating it into ORDER BY', async (injected) => {
      const { apply, close } = await ordering();
      const { qb, orderBy } = stubBuilder();

      // The cast models exactly the caller this guard exists for: one that reached the
      // service without `@IsIn` having run. The compiler stops the honest version of
      // this mistake; the re-check stops the dishonest one.
      expect(() => {
        apply(qb, injected as unknown as GarmentSortKey, 'DESC');
      }).toThrow(/not a garment sort key/);

      expect(orderBy).not.toHaveBeenCalled();
      await close();
    });
  });
});
