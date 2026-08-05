import { Role } from '@library/common';

import {
  authorise,
  readRouteContracts,
  sessionFor,
  type RouteContract,
} from '@api/modules/users/testing/route-authorisation';

import { CatalogController } from './catalog.controller';

/** `@Throttle({ default: … })` writes these keys onto the handler (@nestjs/throttler). */
const THROTTLER_LIMIT_KEY = 'THROTTLER:LIMITdefault';
const THROTTLER_TTL_KEY = 'THROTTLER:TTLdefault';

function handlerOf(name: string): object {
  const prototype = CatalogController.prototype as unknown as Record<string, object>;
  return prototype[name];
}

/**
 * **PRD C-1 and ARCHITECTURE §2.6 — the public browse contract.**
 *
 * > C-1: "Browsing is public. Catalog, categories, search, filters and garment detail
 * > are reachable while signed out."
 *
 * Three assertions per route, all read from the decorators the controller actually
 * emitted: `@Public()`, `@Roles(Role.PUBLIC)`, and an explicit `@Throttle()`.
 * `@Public()` bypasses `SessionAuthGuard` and *nothing else* — an unauthenticated
 * route with no rate limit is the one that gets scraped, so the throttle is checked
 * rather than assumed.
 */
describe('CatalogController — public browse (C-1, §2.6)', () => {
  const routes: RouteContract[] = readRouteContracts(CatalogController);

  it('declares the four routes ARCHITECTURE §5.8 specifies', () => {
    expect(routes.map((route) => route.label).sort()).toEqual([
      'GET /catalog/filters',
      'GET /catalog/garments',
      'GET /catalog/garments/:slugOrId',
      'GET /catalog/new-arrivals',
    ]);
  });

  it('exposes no mutation and no admin route', () => {
    // The module is a read-only projection (§4.33). A POST here would be a write path
    // into somebody else's table with no role contract worth the name.
    expect(routes.every((route) => route.verb === 'GET')).toBe(true);
    expect(routes.some((route) => route.roles?.includes(Role.ADMIN) === true)).toBe(false);
  });

  describe.each(routes.map((route) => [route.label, route.handler]))('%s', (_label, handler) => {
    it('declares @Public() and @Roles(Role.PUBLIC)', () => {
      const route = routes.find((candidate) => candidate.handler === handler);
      expect(route?.isPublic).toBe(true);
      expect(route?.roles).toEqual([Role.PUBLIC]);
    });

    it('carries an explicit @Throttle()', () => {
      const target = handlerOf(handler);
      expect(Reflect.getMetadata(THROTTLER_LIMIT_KEY, target)).toEqual(expect.any(Number));
      expect(Reflect.getMetadata(THROTTLER_TTL_KEY, target)).toEqual(expect.any(Number));
    });

    it('is reachable signed out, and by a consumer and an admin alike (C-1)', () => {
      expect(authorise(CatalogController, handler, undefined)).toBeUndefined();
      expect(authorise(CatalogController, handler, sessionFor(Role.CONSUMER))).toBeUndefined();
      expect(authorise(CatalogController, handler, sessionFor(Role.ADMIN))).toBeUndefined();
    });
  });
});
