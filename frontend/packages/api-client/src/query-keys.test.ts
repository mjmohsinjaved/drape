import { describe, expect, it } from 'vitest';

import { queryKeys } from './query-keys';

/** Every domain named in §5 must have a root, or a feature will invent its own key by hand. */
const EXPECTED_ROOTS = [
  'auth',
  'me',
  'notifications',
  'users',
  'consumers',
  'invites',
  'settings',
  'categories',
  'garments',
  'catalog',
  'photos',
  'consent',
  'tryon',
  'results',
  'shortlist',
  'share',
  'enquiries',
  'quota',
  'moderation',
  'analytics',
  'audit',
  'health',
] as const;

describe('queryKeys — §6.4 factory shape', () => {
  it('covers every domain in §5', () => {
    expect(Object.keys(queryKeys).sort()).toEqual([...EXPECTED_ROOTS].sort());
  });

  it('gives every domain a unique array root', () => {
    const domains: Array<{ all: readonly string[] }> = Object.values(queryKeys);

    const roots = domains.map((domain) => {
      expect(Array.isArray(domain.all)).toBe(true);
      expect(domain.all).toHaveLength(1);
      return domain.all[0];
    });

    expect(new Set(roots).size).toBe(roots.length);
  });

  it('nests every key under its own root, so prefix invalidation works', () => {
    expect(queryKeys.auth.me()).toEqual(['auth', 'me']);
    expect(queryKeys.auth.sessions()).toEqual(['auth', 'sessions']);
    expect(queryKeys.settings.brand()).toEqual(['settings', 'brand']);
    expect(queryKeys.shortlist.list()).toEqual(['shortlist', 'list']);
    expect(queryKeys.quota.me()).toEqual(['quota', 'me']);
  });

  it('threads filters into the list key so two filter sets never share a cache entry', () => {
    const a = queryKeys.catalog.list({ categoryId: 'cat-1', sortBy: 'newest' });
    const b = queryKeys.catalog.list({ categoryId: 'cat-2', sortBy: 'newest' });

    expect(a).toEqual(['catalog', 'list', { categoryId: 'cat-1', sortBy: 'newest' }]);
    expect(a).not.toEqual(b);
  });

  it('defaults an omitted filter object so the key is stable', () => {
    expect(queryKeys.catalog.list()).toEqual(['catalog', 'list', {}]);
    expect(queryKeys.results.list()).toEqual(['results', 'list', {}]);
  });

  it('puts detail keys under the shared `details()` prefix', () => {
    expect(queryKeys.catalog.detail('zarrin-lehenga')).toEqual([
      'catalog',
      'detail',
      'zarrin-lehenga',
    ]);
    expect(queryKeys.catalog.detail('x').slice(0, 2)).toEqual(queryKeys.catalog.details());
    expect(queryKeys.results.detail('r1').slice(0, 2)).toEqual(queryKeys.results.details());
    expect(queryKeys.garments.detail('g1').slice(0, 2)).toEqual(queryKeys.garments.details());
  });

  it('nests a sub-resource under its parent detail key', () => {
    expect(queryKeys.garments.images('g1')).toEqual(['garments', 'detail', 'g1', 'images']);
    expect(queryKeys.enquiries.notes('e1')).toEqual(['enquiries', 'detail', 'e1', 'notes']);
    expect(queryKeys.consumers.renders('u1')).toEqual(['consumers', 'detail', 'u1', 'renders']);
    expect(queryKeys.share.votes('s1')).toEqual(['share', 'links', 's1', 'votes']);
  });

  it('separates the public catalog tree from the admin one', () => {
    expect(queryKeys.categories.tree('public')).not.toEqual(queryKeys.categories.tree('admin'));
  });

  it('keeps the narrow invalidation targets of the C-20 verdict flow distinct', () => {
    // §6.4: a verdict invalidates results.detail(id), results.lists() and shortlist.list() —
    // never queryKeys.results.all.
    const detail = queryKeys.results.detail('r1');
    const lists = queryKeys.results.lists();

    expect(lists).toEqual(['results', 'list']);
    expect(detail.slice(0, 2)).toEqual(['results', 'detail']);
    expect(lists).not.toEqual(queryKeys.results.all);
    expect(queryKeys.shortlist.list()).not.toEqual(queryKeys.shortlist.all);
  });

  it('keys the try-on job and its batch separately', () => {
    expect(queryKeys.tryon.job('j1')).toEqual(['tryon', 'job', 'j1']);
    expect(queryKeys.tryon.batch('b1')).toEqual(['tryon', 'batch', 'b1']);
    expect(queryKeys.tryon.jobs()).toEqual(['tryon', 'jobs', {}]);
  });

  it('keys a public share view by token, never by id', () => {
    expect(queryKeys.share.publicView('tok')).toEqual(['share', 'public', 'tok']);
    expect(queryKeys.share.publicVotes('tok')).toEqual(['share', 'public', 'tok', 'votes']);
  });
});
