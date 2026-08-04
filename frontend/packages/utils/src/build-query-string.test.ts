import { describe, expect, it } from 'vitest';

import { appendQueryString, buildQueryString } from './build-query-string';

describe('buildQueryString', () => {
  it('builds a plain query string in insertion order', () => {
    expect(buildQueryString({ page: 1, limit: 24, sortBy: 'createdAt' })).toBe(
      'page=1&limit=24&sortBy=createdAt',
    );
  });

  it('skips null and undefined but keeps 0 and false', () => {
    expect(
      buildQueryString({ search: undefined, categoryId: null, page: 0, includeArchived: false }),
    ).toBe('page=0&includeArchived=false');
  });

  it('drops empty strings by default and keeps them on request', () => {
    expect(buildQueryString({ search: '', page: 1 })).toBe('page=1');
    expect(buildQueryString({ search: '', page: 1 }, { keepEmptyStrings: true })).toBe(
      'search=&page=1',
    );
  });

  it('skips NaN and Infinity rather than serialising them', () => {
    expect(buildQueryString({ page: Number.NaN, limit: Number.POSITIVE_INFINITY, ok: 1 })).toBe(
      'ok=1',
    );
  });

  it('encodes arrays as a repeated key', () => {
    expect(buildQueryString({ categoryId: ['a', 'b', 'c'] })).toBe(
      'categoryId=a&categoryId=b&categoryId=c',
    );
  });

  it('skips nullish members inside an array and omits empty arrays entirely', () => {
    expect(buildQueryString({ tag: ['a', null, undefined, 'b'] })).toBe('tag=a&tag=b');
    expect(buildQueryString({ tag: [], page: 1 })).toBe('page=1');
    expect(buildQueryString({ tag: [null, undefined] })).toBe('');
  });

  it('percent-encodes keys and values, including non-Latin text', () => {
    expect(buildQueryString({ search: 'bridal lehenga & zari' })).toBe(
      'search=bridal+lehenga+%26+zari',
    );
    expect(buildQueryString({ search: 'لہنگا' })).toBe(
      'search=%D9%84%DB%81%D9%86%DA%AF%D8%A7',
    );
  });

  it('is repeatable — the same input always yields the same string', () => {
    const params = { categoryId: ['b', 'a'], page: 1 };
    expect(buildQueryString(params)).toBe(buildQueryString(params));
    expect(buildQueryString(params)).toBe('categoryId=b&categoryId=a&page=1');
  });

  it('can sort keys for cache-key stability across differently-built objects', () => {
    expect(buildQueryString({ page: 1, limit: 24 }, { sort: true })).toBe('limit=24&page=1');
    expect(buildQueryString({ limit: 24, page: 1 }, { sort: true })).toBe('limit=24&page=1');
  });

  it('adds the ? prefix only when there is something to add', () => {
    expect(buildQueryString({ page: 1 }, { prefix: true })).toBe('?page=1');
    expect(buildQueryString({ page: undefined }, { prefix: true })).toBe('');
  });

  it('returns an empty string for empty and nullish params', () => {
    expect(buildQueryString({})).toBe('');
    expect(buildQueryString(null)).toBe('');
    expect(buildQueryString(undefined)).toBe('');
  });
});

describe('appendQueryString', () => {
  it('appends with ? when the path has none', () => {
    expect(appendQueryString('/catalog/garments', { page: 2 })).toBe('/catalog/garments?page=2');
  });

  it('appends with & when the path already has a query', () => {
    expect(appendQueryString('/catalog/garments?view=grid', { page: 2 })).toBe(
      '/catalog/garments?view=grid&page=2',
    );
  });

  it('leaves the path untouched when nothing survives filtering', () => {
    expect(appendQueryString('/catalog/garments', { page: undefined })).toBe('/catalog/garments');
    expect(appendQueryString('/catalog/garments', null)).toBe('/catalog/garments');
  });
});
