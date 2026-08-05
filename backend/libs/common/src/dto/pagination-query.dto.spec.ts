import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  DEFAULT_LIMIT,
  DEFAULT_SORT_BY,
  MAX_LIMIT,
  PaginationQueryDto,
  SORT_KEY_PATTERN,
} from './pagination-query.dto';

/**
 * `PaginationQueryDto` — ARCHITECTURE.md §2.8.
 *
 * The interesting property is `sortBy`. It is the one query field that ends up inside an
 * `ORDER BY` clause by **string interpolation**, because SQL has no parameter form for a
 * column name. Every module narrows it with `@IsIn([...])` and every interpolation site
 * re-checks its allow-list — but this class is what those two are stacked on top of, so
 * the shape check here is the floor: the day a module ships a list endpoint and forgets
 * the `@IsIn`, the base class still refuses a value carrying a space, a quote, a comma,
 * a parenthesis, a semicolon or a comment marker.
 */
describe('PaginationQueryDto', () => {
  function violations(query: Record<string, unknown>): string[] {
    const dto = plainToInstance(PaginationQueryDto, query);
    return validateSync(dto).flatMap((error) => Object.keys(error.constraints ?? {}));
  }

  it('accepts the defaults', () => {
    expect(violations({})).toEqual([]);
    expect(plainToInstance(PaginationQueryDto, {})).toMatchObject({
      page: 1,
      limit: DEFAULT_LIMIT,
      sortBy: DEFAULT_SORT_BY,
      sortOrder: 'DESC',
    });
  });

  it.each(['createdAt', 'updatedAt', 'starRate', 'tryOnCount', 'price', 'newest', 'rank', 'id'])(
    'accepts %p — every sort key the codebase actually uses is a plain identifier',
    (sortBy) => {
      expect(violations({ sortBy })).toEqual([]);
      expect(SORT_KEY_PATTERN.test(sortBy)).toBe(true);
    },
  );

  it.each([
    ['a statement terminator', 'createdAt; DROP TABLE users'],
    ['a second expression', 'createdAt, (SELECT password FROM users LIMIT 1)'],
    ['a closing parenthesis', 'id) --'],
    ['a comment marker', 'createdAt--'],
    ['a quote', "createdAt' "],
    ['a double quote', 'createdAt"'],
    ['whitespace', 'created At'],
    ['a leading digit', '1createdAt'],
    ['a dotted path', 'garment.createdAt'],
    ['a subquery', '(SELECT 1)'],
    ['nothing at all', ''],
  ])('refuses %s: %p', (_case, sortBy) => {
    expect(violations({ sortBy })).toContain('matches');
  });

  it('still refuses an over-long identifier', () => {
    expect(violations({ sortBy: 'a'.repeat(65) })).toContain('maxLength');
  });

  it('rejects a page size above the ceiling rather than clamping it', () => {
    expect(violations({ limit: MAX_LIMIT + 1 })).toContain('max');
  });

  it('rejects a sort direction outside ASC/DESC', () => {
    expect(violations({ sortOrder: 'RANDOM()' })).toContain('isIn');
  });
});
