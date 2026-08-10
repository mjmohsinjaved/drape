import { getRepositoryToken } from '@nestjs/typeorm';

import { ErrorCode } from '@library/common';
import { StorageService } from '@library/storage';

import { Category } from '@api/modules/categories/entities/category.entity';
import { GarmentImage } from '@api/modules/garments/entities/garment-image.entity';
import { Garment } from '@api/modules/garments/entities/garment.entity';
import { EmbellishmentWeight } from '@api/modules/garments/enums/embellishment-weight.enum';
import { GarmentMode } from '@api/modules/garments/enums/garment-mode.enum';
import { PublishState } from '@api/modules/garments/enums/publish-state.enum';
import { TestRenderState } from '@api/modules/garments/enums/test-render-state.enum';
import { SettingsService } from '@api/modules/settings';
import {
  attachQueryBuilder,
  createQueryBuilderSpy,
} from '@api/modules/users/testing/query-doubles';
import type { QueryBuilderSpy } from '@api/modules/users/testing/query-doubles';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import {
  buildArchivedGarment,
  buildCategory,
  buildGarment,
  buildPublishedGarment,
  buildRentalGarment,
  buildSubCategory,
} from '../../../../test/factories';
import {
  createInMemoryRepository,
  createMock,
  createTestingModule,
} from '../../../../test/fixtures';

import { CatalogService } from './catalog.service';

import type { CatalogQueryDto, NewArrivalsQueryDto } from '../dto/catalog-query.dto';

/** The default browse query, so each case below changes exactly one thing. */
const browse = (overrides: Partial<CatalogQueryDto> = {}): CatalogQueryDto => ({
  page: 1,
  limit: 24,
  sortBy: 'newest',
  sortOrder: 'DESC',
  ...overrides,
});

const arrivals = (overrides: Partial<NewArrivalsQueryDto> = {}): NewArrivalsQueryDto => ({
  limit: 12,
  ...overrides,
});

function imageFor(garmentId: string): GarmentImage {
  return Object.assign(new GarmentImage(), {
    id: `image-${garmentId}`,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    garmentId,
    storageKey: `garments/${garmentId}/front.webp`,
    thumbnailKey: `garments/${garmentId}/front.thumb.webp`,
    isTryOnSource: true,
    hash: '0'.repeat(64),
    width: 2400,
    height: 3200,
    byteSize: 900_000,
    mimeType: 'image/webp',
    position: 0,
    altText: 'Front view',
  });
}

/**
 * `CatalogService` — the public browse projection (C-1, C-8, C-17, C-18).
 *
 * Two things are being proved here, and they are the two the module exists for.
 *
 * **Visibility.** Nothing that is not published can appear through any public route, by
 * any filter or sort combination. That is asserted twice over: the query every route
 * builds carries the predicate, *and* rows that should not be visible are fed back
 * through the service as if the query had been wrong — and still nothing comes out.
 *
 * The test render is no longer part of that rule. It used to be — E-10 required an
 * approved one before a piece could be browsed — and the cases below now assert the
 * opposite, that a published piece is reachable whatever state its test render is in.
 * Keeping them pointed the other way rather than deleting them is what stops the gate
 * coming back unnoticed.
 *
 * **A-30.** With `catalog.showPricesPublicly` off, no price reaches a public response
 * — not in the card, not in the detail, not as a filter that would let one be
 * inferred, and not as a range on the facets endpoint.
 */
describe('CatalogService', () => {
  interface Harness {
    service: CatalogService;
    spy: QueryBuilderSpy<Garment>;
    settings: jest.Mocked<SettingsService>;
    close: () => Promise<void>;
  }

  async function arrange(options: {
    rows?: readonly Garment[];
    raw?: readonly unknown[];
    categories?: readonly Category[];
    images?: readonly GarmentImage[];
    showPrices?: boolean;
  }): Promise<Harness> {
    const garments = createInMemoryRepository<Garment>();
    const spy = createQueryBuilderSpy<Garment>({
      alias: 'garment',
      many: options.rows ?? [],
      raw: options.raw ?? [],
    });
    attachQueryBuilder(garments, spy);

    const images = createInMemoryRepository<GarmentImage>({ rows: options.images ?? [] });
    const categories = createInMemoryRepository<Category>({ rows: options.categories ?? [] });

    const settings = createMock<SettingsService>(['getBoolean']);
    settings.getBoolean.mockResolvedValue(options.showPrices ?? true);

    const storage = createMock<StorageService>(['signedUrl']);
    storage.signedUrl.mockImplementation((key: string) => `https://api.test/files/${key}`);

    const harness = await createTestingModule({
      providers: [CatalogService],
      overrides: [
        { token: getRepositoryToken(Garment), value: garments },
        { token: getRepositoryToken(GarmentImage), value: images },
        { token: getRepositoryToken(Category), value: categories },
        { token: SettingsService, value: settings },
        { token: StorageService, value: storage },
      ],
    });

    return {
      service: harness.get<CatalogService>(CatalogService),
      spy,
      settings,
      close: harness.close,
    };
  }

  /** Every condition the visibility predicate must put on a query — and the two it must not. */
  function expectVisibilityPredicate(spy: QueryBuilderSpy<Garment>): void {
    const sql = spy.sql();
    expect(sql).toContain('garment.publishState = :publicPublishState');
    expect(sql).toContain('garment.deletedAt IS NULL');
    expect(sql).not.toContain('garment.testRenderState');
    expect(sql).not.toContain('garment.testRenderApprovedAt');
  }

  /* --------------------------------------------------------------------------------------- */

  describe('nothing unpublished is reachable', () => {
    const invisible: ReadonlyArray<readonly [string, Garment]> = [
      ['a draft', buildGarment()],
      [
        'a draft carrying an approved test render',
        buildPublishedGarment({ publishState: PublishState.DRAFT, publishedAt: null }),
      ],
      ['an archived garment', buildArchivedGarment()],
      ['a soft-deleted garment', buildPublishedGarment({ deletedAt: new Date() })],
    ];

    /**
     * The rows that used to be in the list above. Publishing is now the whole decision,
     * so each of these reaches the catalogue.
     */
    const visibleDespiteTestRender: ReadonlyArray<readonly [string, Garment]> = [
      [
        'a published garment whose test render is pending',
        buildPublishedGarment({
          testRenderState: TestRenderState.PENDING,
          testRenderApprovedAt: null,
        }),
      ],
      [
        'a published garment whose test render was rejected',
        buildPublishedGarment({
          testRenderState: TestRenderState.REJECTED,
          testRenderApprovedAt: null,
        }),
      ],
      [
        'a published garment that was never test-rendered',
        buildPublishedGarment({
          testRenderState: TestRenderState.NONE,
          testRenderApprovedAt: null,
        }),
      ],
      [
        'a published garment with no approval timestamp',
        buildPublishedGarment({ testRenderApprovedAt: null }),
      ],
    ];

    describe.each(visibleDespiteTestRender)('%s', (_case, garment) => {
      it('appears in the browse grid', async () => {
        const harness = await arrange({
          rows: [garment],
          categories: [buildCategory({ id: garment.categoryId })],
          images: [imageFor(garment.id)],
        });

        const page = await harness.service.list(browse());

        expect(page.items.map((item) => item.id)).toEqual([garment.id]);
        await harness.close();
      });

      it('is reachable on the detail route', async () => {
        const harness = await arrange({
          rows: [garment],
          categories: [buildCategory({ id: garment.categoryId })],
          images: [imageFor(garment.id)],
        });

        await expect(harness.service.findOne(garment.slug)).resolves.toMatchObject({
          id: garment.id,
        });

        await harness.close();
      });
    });

    describe.each(invisible)('%s', (_case, garment) => {
      it('never appears in the browse grid, even if the query returned it', async () => {
        const harness = await arrange({ rows: [garment] });

        const page = await harness.service.list(browse());

        expect(page.items).toEqual([]);
        await harness.close();
      });

      it('is GARMENT_NOT_FOUND on the detail route', async () => {
        const harness = await arrange({ rows: [garment] });

        await expect(harness.service.findOne(garment.slug)).rejects.toMatchObject({
          errorCode: ErrorCode.GARMENT_NOT_FOUND,
        });

        await harness.close();
      });

      it('never appears in new arrivals', async () => {
        const harness = await arrange({ rows: [garment] });

        expect(await harness.service.newArrivals(arrivals())).toEqual([]);
        await harness.close();
      });
    });

    it('a visible garment does come through, so the assertions above are not vacuous', async () => {
      const garment = buildPublishedGarment();
      const harness = await arrange({
        rows: [garment],
        categories: [buildCategory({ id: garment.categoryId })],
        images: [imageFor(garment.id)],
      });

      const page = await harness.service.list(browse());

      expect(page.items.map((item) => item.id)).toEqual([garment.id]);
      await harness.close();
    });

    it('applies the predicate on the browse grid', async () => {
      const harness = await arrange({});
      await harness.service.list(browse());
      expectVisibilityPredicate(harness.spy);
      await harness.close();
    });

    it('applies the predicate on the detail route', async () => {
      const harness = await arrange({});
      await harness.service.findOne('zarrin-bridal-lehenga').catch(() => undefined);
      expectVisibilityPredicate(harness.spy);
      await harness.close();
    });

    it('applies the predicate on new arrivals', async () => {
      const harness = await arrange({});
      await harness.service.newArrivals(arrivals());
      expectVisibilityPredicate(harness.spy);
      await harness.close();
    });

    it('applies the predicate on the facets endpoint', async () => {
      const harness = await arrange({ raw: [] });
      await harness.service.filters();
      expectVisibilityPredicate(harness.spy);
      await harness.close();
    });

    it.each([
      ['a colour filter', browse({ color: 'maroon' })],
      ['a size filter', browse({ size: 'M' })],
      ['a weight filter', browse({ embellishmentWeight: EmbellishmentWeight.HEAVY })],
      ['a mode filter', browse({ mode: GarmentMode.RENTAL })],
      ['a price band', browse({ priceMin: 1000, priceMax: 500_000 })],
      ['a search term', browse({ search: 'lehenga' })],
      ['the mostTried sort', browse({ sortBy: 'mostTried' })],
      ['the priceAsc sort', browse({ sortBy: 'priceAsc' })],
      ['the priceDesc sort', browse({ sortBy: 'priceDesc' })],
      ['a deep page', browse({ page: 7, limit: 100 })],
    ])('keeps the predicate under %s', async (_case, query) => {
      const harness = await arrange({ rows: [buildGarment()] });

      const page = await harness.service.list(query);

      expectVisibilityPredicate(harness.spy);
      // …and the draft the query "returned" still does not come out.
      expect(page.items).toEqual([]);
      await harness.close();
    });

    it('keeps the predicate under a category filter', async () => {
      const parent = buildCategory();
      const harness = await arrange({ categories: [parent] });

      await harness.service.list(browse({ categoryId: parent.id }));

      expectVisibilityPredicate(harness.spy);
      await harness.close();
    });
  });

  describe('A-30 — the public price toggle', () => {
    it('omits price, currency and deposit from the grid when it is off', async () => {
      const garment = buildRentalGarment({
        publishState: PublishState.PUBLISHED,
        publishedAt: new Date(),
        testRenderState: TestRenderState.APPROVED,
        testRenderApprovedAt: new Date(),
        price: 185_000,
        deposit: 45_000,
      });
      const harness = await arrange({
        rows: [garment],
        categories: [buildCategory({ id: garment.categoryId })],
        images: [imageFor(garment.id)],
        showPrices: false,
      });

      const page = await harness.service.list(browse());

      expect(page.items[0]?.price).toBeNull();
      expect(page.items[0]?.currency).toBeNull();
      expect(page.items[0]?.deposit).toBeNull();
      expect(JSON.stringify(page.items)).not.toContain('185000');
      expect(JSON.stringify(page.items)).not.toContain('45000');

      await harness.close();
    });

    it('omits them from the detail response too', async () => {
      const garment = buildRentalGarment({
        publishState: PublishState.PUBLISHED,
        publishedAt: new Date(),
        testRenderState: TestRenderState.APPROVED,
        testRenderApprovedAt: new Date(),
      });
      const harness = await arrange({
        rows: [garment],
        categories: [buildCategory({ id: garment.categoryId })],
        images: [imageFor(garment.id)],
        showPrices: false,
      });

      const detail = await harness.service.findOne(garment.slug);

      expect(detail.price).toBeNull();
      expect(detail.currency).toBeNull();
      expect(detail.deposit).toBeNull();

      await harness.close();
    });

    it('omits them from new arrivals too', async () => {
      const garment = buildPublishedGarment({ price: 500_000 });
      const harness = await arrange({
        rows: [garment],
        categories: [buildCategory({ id: garment.categoryId })],
        showPrices: false,
      });

      const [card] = await harness.service.newArrivals(arrivals());

      expect(card?.price).toBeNull();
      expect(card?.currency).toBeNull();

      await harness.close();
    });

    it('ignores the price band filters rather than honouring them', async () => {
      // A filter that narrows by price discloses prices a binary search at a time.
      const harness = await arrange({ showPrices: false });

      await harness.service.list(browse({ priceMin: 100_000, priceMax: 200_000 }));

      expect(harness.spy.sql()).not.toContain('garment.price >= :priceMin');
      expect(harness.spy.sql()).not.toContain('garment.price <= :priceMax');

      await harness.close();
    });

    it('falls the price sorts back to newest', async () => {
      const harness = await arrange({ showPrices: false });

      await harness.service.list(browse({ sortBy: 'priceAsc' }));

      const orderings = harness.spy.argsFor('orderBy').map(([expression]) => expression);
      expect(orderings).not.toContain('garment.price');
      expect(orderings).toContain('garment.publishedAt');

      await harness.close();
    });

    it('omits the price range from the facets endpoint', async () => {
      const harness = await arrange({ raw: [], showPrices: false });

      const filters = await harness.service.filters();

      expect(filters.priceRange).toBeNull();
      await harness.close();
    });

    it('shows prices again when the toggle is on', async () => {
      const garment = buildPublishedGarment({ price: 185_000, currency: 'PKR' });
      const harness = await arrange({
        rows: [garment],
        categories: [buildCategory({ id: garment.categoryId })],
        showPrices: true,
      });

      const page = await harness.service.list(browse());

      expect(page.items[0]?.price).toBe(185_000);
      expect(page.items[0]?.currency).toBe('PKR');

      await harness.close();
    });

    it('reads the toggle through the cached settings getter, never the table', async () => {
      const harness = await arrange({});

      await harness.service.list(browse());

      expect(harness.settings.getBoolean).toHaveBeenCalledWith(
        SETTINGS_KEYS.CATALOG_SHOW_PRICES_PUBLICLY,
      );
      await harness.close();
    });
  });

  describe('no admin-only field ever reaches a public response', () => {
    it('carries none of them on the grid card or the detail page', async () => {
      const garment = buildPublishedGarment({
        sku: 'SECRET-SKU-9',
        qualityScore: 41,
        qualityChecks: [
          { check: 'LONG_EDGE', passed: false, score: 10, remediation: 'Reshoot larger.' },
        ],
        flaggedForReview: true,
        failureCount: 7,
        tryOnCount: 99,
      });
      const harness = await arrange({
        rows: [garment],
        categories: [buildCategory({ id: garment.categoryId })],
        images: [imageFor(garment.id)],
      });

      const [card] = (await harness.service.list(browse())).items;
      const detail = await harness.service.findOne(garment.id);

      for (const payload of [card, detail]) {
        for (const forbidden of [
          'sku',
          'publishState',
          'qualityScore',
          'qualityChecks',
          'qualityOverriddenBy',
          'testRenderId',
          'testRenderState',
          'testRenderApprovedAt',
          'approvedBy',
          'flaggedForReview',
          'failureCount',
          'tryOnCount',
          'loveCount',
          'enquiryCount',
        ]) {
          expect(payload).not.toHaveProperty(forbidden);
        }
      }

      const serialised = JSON.stringify({ card, detail });
      expect(serialised).not.toContain('SECRET-SKU-9');
      expect(serialised).not.toContain('LONG_EDGE');
      expect(serialised).not.toContain('Reshoot larger.');

      await harness.close();
    });

    it('signs image keys rather than returning them (§3.4)', async () => {
      const garment = buildPublishedGarment();
      const harness = await arrange({
        rows: [garment],
        categories: [buildCategory({ id: garment.categoryId })],
        images: [imageFor(garment.id)],
      });

      const detail = await harness.service.findOne(garment.slug);

      expect(detail.images).toHaveLength(1);
      expect(detail.images[0]?.url).toBe(
        `https://api.test/files/garments/${garment.id}/front.webp`,
      );
      expect(detail.images[0]?.altText).toBe('Front view');
      expect(detail.primaryImage?.thumbnailUrl).toContain('front.thumb.webp');

      await harness.close();
    });
  });

  describe('C-17 filters and search', () => {
    it('searches title, category name, colour and style tags', async () => {
      const harness = await arrange({});

      await harness.service.list(browse({ search: 'lehenga' }));

      const sql = harness.spy.sql();
      expect(sql).toContain('garment.title ILIKE :search');
      expect(sql).toContain('category.name ILIKE :search');
      expect(sql).toContain('unnest(garment.colors)');
      expect(sql).toContain('unnest(garment.styleTags)');
      expect(harness.spy.called('leftJoin')).toBe(true);

      await harness.close();
    });

    it('includes a category’s sub-categories so browsing a parent is not empty (A-5)', async () => {
      const parent = buildCategory();
      const child = buildSubCategory(parent);
      const harness = await arrange({ categories: [parent, child] });

      await harness.service.list(browse({ categoryId: parent.id }));

      const bound = harness.spy
        .argsFor('andWhere')
        .map(([, parameters]) => parameters)
        .find(
          (parameters): parameters is { categoryIds: string[] } =>
            typeof parameters === 'object' && parameters !== null && 'categoryIds' in parameters,
        );

      expect(bound?.categoryIds).toEqual(expect.arrayContaining([parent.id, child.id]));

      await harness.close();
    });

    it('returns an empty catalogue for an unknown category rather than the whole one', async () => {
      const harness = await arrange({ categories: [] });

      await harness.service.list(browse({ categoryId: '11111111-2222-4333-8444-555555555555' }));

      expect(harness.spy.sql()).toContain('garment.categoryId IN (:...categoryIds)');

      await harness.close();
    });

    it('binds the colour and size facets as array membership', async () => {
      const harness = await arrange({});

      await harness.service.list(browse({ color: 'maroon', size: 'M' }));

      const sql = harness.spy.sql();
      expect(sql).toContain(':color = ANY(garment.colors)');
      expect(sql).toContain(':size = ANY(garment.sizes)');

      await harness.close();
    });
  });

  describe('detail lookup', () => {
    it('accepts a uuid as well as a slug', async () => {
      const garment = buildPublishedGarment();
      const harness = await arrange({
        rows: [garment],
        categories: [buildCategory({ id: garment.categoryId })],
      });

      await harness.service.findOne(garment.id);

      expect(harness.spy.sql()).toContain('garment.id = :slugOrId');
      await harness.close();
    });

    it('looks a non-uuid up by slug', async () => {
      const garment = buildPublishedGarment();
      const harness = await arrange({
        rows: [garment],
        categories: [buildCategory({ id: garment.categoryId })],
      });

      await harness.service.findOne(garment.slug);

      expect(harness.spy.sql()).toContain('garment.slug = :slugOrId');
      await harness.close();
    });
  });
});
