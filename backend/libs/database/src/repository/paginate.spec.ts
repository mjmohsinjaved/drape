import type { PaginationQueryDto } from '@library/common';

import { paginate } from './paginate';

import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

interface Row extends ObjectLiteral {
  id: string;
}

interface MockQueryBuilder {
  alias: string;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getManyAndCount: jest.Mock;
}

function mockQueryBuilder(items: Row[], total: number): MockQueryBuilder {
  const qb: MockQueryBuilder = {
    alias: 'garment',
    orderBy: jest.fn(() => qb),
    addOrderBy: jest.fn(() => qb),
    skip: jest.fn(() => qb),
    take: jest.fn(() => qb),
    getManyAndCount: jest.fn().mockResolvedValue([items, total]),
  };
  return qb;
}

function asQueryBuilder(qb: MockQueryBuilder): SelectQueryBuilder<Row> {
  return qb as unknown as SelectQueryBuilder<Row>;
}

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_unused, index) => ({ id: `row-${index}` }));
}

function query(overrides: Partial<PaginationQueryDto> = {}): PaginationQueryDto {
  return {
    page: 1,
    limit: 20,
    sortBy: 'createdAt',
    sortOrder: 'DESC',
    ...overrides,
  };
}

describe('paginate', () => {
  describe('meta arithmetic', () => {
    it('computes totalPages by rounding up a partial last page', async () => {
      const qb = mockQueryBuilder(rows(20), 95);

      const result = await paginate(asQueryBuilder(qb), query({ page: 1, limit: 20 }));

      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 95,
        totalPages: 5,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      });
    });

    it('computes totalPages exactly when total divides by limit', async () => {
      const qb = mockQueryBuilder(rows(20), 40);

      const result = await paginate(asQueryBuilder(qb), query({ page: 1, limit: 20 }));

      expect(result.meta.totalPages).toBe(2);
    });

    it('reports zero pages and no items for an empty result set', async () => {
      const qb = mockQueryBuilder([], 0);

      const result = await paginate(asQueryBuilder(qb), query({ page: 1, limit: 20 }));

      expect(result.items).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
      expect(result.meta.page).toBe(1);
    });

    it('handles the last page, which carries fewer items than the limit', async () => {
      const qb = mockQueryBuilder(rows(15), 95);

      const result = await paginate(asQueryBuilder(qb), query({ page: 5, limit: 20 }));

      expect(result.items).toHaveLength(15);
      expect(result.meta.page).toBe(5);
      expect(result.meta.totalPages).toBe(5);
      expect(qb.skip).toHaveBeenCalledWith(80);
      expect(qb.take).toHaveBeenCalledWith(20);
    });

    it('reports a page past the end honestly rather than clamping it', async () => {
      const qb = mockQueryBuilder([], 95);

      const result = await paginate(asQueryBuilder(qb), query({ page: 9, limit: 20 }));

      expect(result.items).toEqual([]);
      expect(result.meta.page).toBe(9);
      expect(result.meta.totalPages).toBe(5);
      expect(qb.skip).toHaveBeenCalledWith(160);
    });

    it('yields one page when total is smaller than the limit', async () => {
      const qb = mockQueryBuilder(rows(3), 3);

      const result = await paginate(asQueryBuilder(qb), query({ page: 1, limit: 20 }));

      expect(result.meta.totalPages).toBe(1);
    });

    it('echoes sortBy and sortOrder back in meta', async () => {
      const qb = mockQueryBuilder(rows(1), 1);

      const result = await paginate(
        asQueryBuilder(qb),
        query({ sortBy: 'title', sortOrder: 'ASC' }),
      );

      expect(result.meta.sortBy).toBe('title');
      expect(result.meta.sortOrder).toBe('ASC');
    });
  });

  describe('input normalisation', () => {
    it.each([0, -1, 1.5, undefined])('falls back to page 1 for %p', async (page) => {
      const qb = mockQueryBuilder(rows(1), 1);

      const result = await paginate(asQueryBuilder(qb), query({ page: page }));

      expect(result.meta.page).toBe(1);
      expect(qb.skip).toHaveBeenCalledWith(0);
    });

    it('caps limit at 100 so a client cannot ask for the whole table', async () => {
      const qb = mockQueryBuilder(rows(100), 5_000);

      const result = await paginate(asQueryBuilder(qb), query({ limit: 5_000 }));

      expect(result.meta.limit).toBe(100);
      expect(qb.take).toHaveBeenCalledWith(100);
      expect(result.meta.totalPages).toBe(50);
    });

    it('falls back to limit 20 when limit is absent', async () => {
      const qb = mockQueryBuilder(rows(20), 100);

      const result = await paginate(
        asQueryBuilder(qb),
        query({ limit: undefined as unknown as number }),
      );

      expect(result.meta.limit).toBe(20);
      expect(result.meta.totalPages).toBe(5);
    });

    it('treats an unknown sortOrder as DESC', async () => {
      const qb = mockQueryBuilder(rows(1), 1);

      const result = await paginate(
        asQueryBuilder(qb),
        query({ sortOrder: 'sideways' as unknown as 'ASC' }),
      );

      expect(result.meta.sortOrder).toBe('DESC');
    });
  });

  describe('ordering', () => {
    it('applies no ordering when no allow-list is supplied', async () => {
      const qb = mockQueryBuilder(rows(1), 1);

      await paginate(asQueryBuilder(qb), query());

      expect(qb.orderBy).not.toHaveBeenCalled();
      expect(qb.addOrderBy).not.toHaveBeenCalled();
    });

    it('orders by an allow-listed column and adds a stable tie-breaker', async () => {
      const qb = mockQueryBuilder(rows(1), 1);

      await paginate(asQueryBuilder(qb), query({ sortBy: 'title', sortOrder: 'ASC' }), {
        sortableColumns: ['createdAt', 'title'],
      });

      expect(qb.orderBy).toHaveBeenCalledWith('garment.title', 'ASC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('garment.id', 'ASC');
    });

    it('does not duplicate the tie-breaker when it is the sort column', async () => {
      const qb = mockQueryBuilder(rows(1), 1);

      await paginate(asQueryBuilder(qb), query({ sortBy: 'id' }), {
        sortableColumns: ['id'],
      });

      expect(qb.orderBy).toHaveBeenCalledWith('garment.id', 'DESC');
      expect(qb.addOrderBy).not.toHaveBeenCalled();
    });

    it('honours an explicit alias', async () => {
      const qb = mockQueryBuilder(rows(1), 1);

      await paginate(asQueryBuilder(qb), query(), {
        sortableColumns: ['createdAt'],
        alias: 'job',
        tieBreakerColumn: null,
      });

      expect(qb.orderBy).toHaveBeenCalledWith('job.createdAt', 'DESC');
      expect(qb.addOrderBy).not.toHaveBeenCalled();
    });

    it('refuses a sortBy outside the allow-list instead of interpolating it', async () => {
      const qb = mockQueryBuilder(rows(1), 1);

      await expect(
        paginate(asQueryBuilder(qb), query({ sortBy: 'password; DROP TABLE users' }), {
          sortableColumns: ['createdAt', 'title'],
        }),
      ).rejects.toThrow(/allow-list/);

      expect(qb.orderBy).not.toHaveBeenCalled();
      expect(qb.getManyAndCount).not.toHaveBeenCalled();
    });
  });
});
