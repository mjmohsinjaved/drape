import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Category } from '@api/modules/categories/entities/category.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';

import { createInMemoryRepository, type InMemoryRepository } from '../../../../test/fixtures';
import { installQueryBuilderDouble } from '../../../../test/fixtures/query-builder-double';

import { CatalogAnalyticsService } from './catalog-analytics.service';

import type { AnalyticsWindow } from '../queries/analytics-window';

/**
 * **A-39's category table — and the two subqueries that could report more than 100%.**
 *
 * `starRate` is `stars / tryOns`. The denominator counts `tryon_results` rows in the window
 * with `isTestRender = false` and `deletedAt IS NULL`. The numerator used to count
 * `shortlist_items` joined `garments` → `categories` and matched on
 * `categories.name = tryon_results.garmentCategorySnapshot`, which broke the ratio twice, both
 * times upward:
 *
 *  - **neither join carried `deletedAt IS NULL`**, so a verdict against a soft-deleted garment
 *    counted while its renders did not — numerator and denominator over different populations;
 *  - **`categories.name` is not unique.** §4.12 makes the tree unique on `(parentId, slug)`, so
 *    two "Formal" categories under different parents are two rows and the join multiplied every
 *    verdict by however many matched.
 *
 * A rate above 100% is not an imprecision, it is an impossibility, on a screen a buyer uses to
 * decide what to stock. The subqueries now correlate on the snapshot through `tryon_results` —
 * the same table, the same predicates, the same population — so the ratio is like for like.
 *
 * The query builder cannot be executed without PostgreSQL, so this asserts on the SQL the
 * service *builds*, through a double that models TypeORM's real select semantics. That is a
 * narrower claim than "the number is right", and it is the claim that fails if either defect
 * is reintroduced.
 */
describe('CatalogAnalyticsService — categoryPerformance (A-39)', () => {
  let service: CatalogAnalyticsService;
  let results: InMemoryRepository<TryOnResult>;
  let categories: InMemoryRepository<Category>;

  const window: AnalyticsWindow = {
    from: new Date('2026-01-01T00:00:00.000Z'),
    to: new Date('2026-01-31T00:00:00.000Z'),
    days: 30,
  };

  beforeEach(async () => {
    results = createInMemoryRepository<TryOnResult>();
    categories = createInMemoryRepository<Category>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        CatalogAnalyticsService,
        { provide: getRepositoryToken(TryOnResult), useValue: results },
        { provide: getRepositoryToken(ShortlistItem), useValue: createInMemoryRepository() },
        { provide: getRepositoryToken(Category), useValue: categories },
        { provide: getRepositoryToken(TryOnJob), useValue: createInMemoryRepository() },
        { provide: ConfigService, useValue: { get: (): string => 'Asia/Karachi' } },
      ],
    }).compile();

    service = moduleRef.get(CatalogAnalyticsService);
  });

  /** The star and enquiry subquery expressions, as the service built them. */
  const subqueries = (
    builders: ReturnType<typeof installQueryBuilderDouble>,
  ): { stars: string; enquiries: string } => {
    const selects = builders.$last().selects;
    const find = (alias: string): string =>
      selects.find((entry) => entry.alias === alias)?.expression ?? '';

    return { stars: find('stars'), enquiries: find('enquiries') };
  };

  it('never joins categories on a non-unique name (H9)', async () => {
    const builders = installQueryBuilderDouble(results, { rows: [] });

    await service.categoryPerformance(window, 25);

    const { stars, enquiries } = subqueries(builders);

    // The join on `c."name"` is what multiplied a verdict by the number of same-named
    // categories in the tree.
    for (const expression of [stars, enquiries]) {
      expect(expression).not.toMatch(/JOIN\s+"categories"/i);
      expect(expression).not.toMatch(/c\."name"\s*=/i);
    }
  });

  it('scopes both subqueries to live rows, like the denominator (H9)', async () => {
    const builders = installQueryBuilderDouble(results, { rows: [] });

    await service.categoryPerformance(window, 25);

    const { stars, enquiries } = subqueries(builders);

    // Correlated through `tryon_results` on the snapshot, with the same predicates the
    // denominator uses — so numerator and denominator count the same population.
    for (const expression of [stars, enquiries]) {
      expect(expression).toMatch(/"tryon_results"/);
      expect(expression).toMatch(/"garmentCategorySnapshot"\s*=\s*r\."garmentCategorySnapshot"/);
      expect(expression).toMatch(/"isTestRender"\s*=\s*false/);
      // Once for the shortlist/enquiry row, once for the render it is correlated through.
      expect(expression.match(/"deletedAt"\s+IS\s+NULL/gi) ?? []).toHaveLength(2);
    }
  });

  it('counts each shortlist and enquiry row once', async () => {
    const builders = installQueryBuilderDouble(results, { rows: [] });

    await service.categoryPerformance(window, 25);

    const { stars, enquiries } = subqueries(builders);

    // `DISTINCT` plus `EXISTS` rather than a join: a garment with several renders in the
    // window must not multiply its own verdict.
    expect(stars).toMatch(/COUNT\(DISTINCT\s+s\."id"\)/i);
    expect(enquiries).toMatch(/COUNT\(DISTINCT\s+e\."id"\)/i);
  });

  it('reports a star rate that cannot exceed 100% for well-formed counts', async () => {
    installQueryBuilderDouble(results, {
      rows: [{ name: 'Bridal', tryOns: '10', stars: '4', enquiries: '2' }],
    });

    const dto = await service.categoryPerformance(window, 25);

    expect(dto.categories[0]).toMatchObject({
      name: 'Bridal',
      tryOns: 10,
      stars: 4,
      starRate: 40,
      enquiryRate: 20,
    });
  });

  it('reports a snapshot with no live category under its snapshot name (C-29)', async () => {
    installQueryBuilderDouble(results, {
      rows: [{ name: 'Discontinued', tryOns: '3', stars: '1', enquiries: '0' }],
    });

    const dto = await service.categoryPerformance(window, 25);

    // Reported, not dropped: the renders happened, and the snapshot is what survives the
    // category being deleted.
    expect(dto.categories[0]).toMatchObject({
      categoryId: '',
      name: 'Discontinued',
      publishedGarments: 0,
      tryOns: 3,
    });
  });
});
