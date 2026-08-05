import { Role } from '@library/common';

import {
  authorise,
  readRouteContracts,
  sessionFor,
  type RouteContract,
} from '@api/modules/users/testing/route-authorisation';

import { CategoriesController } from './categories.controller';

/** `@Throttle({ default: … })` writes these keys onto the handler (@nestjs/throttler). */
const THROTTLER_LIMIT_KEY = 'THROTTLER:LIMITdefault';
const THROTTLER_TTL_KEY = 'THROTTLER:TTLdefault';

function handlerOf(name: string): object {
  const prototype = CategoriesController.prototype as unknown as Record<string, object>;
  return prototype[name];
}

/**
 * `GET /categories` is public because PRD C-1 says browsing is (§5.5).
 *
 * ARCHITECTURE §2.6 attaches two conditions to that: a `@Public()` route must still
 * declare `@Roles(Role.PUBLIC)` so the B-5 check passes, and it must carry an
 * explicit `@Throttle()` — `@Public()` bypasses `SessionAuthGuard` and nothing else.
 * Both are asserted here rather than trusted, because an unauthenticated route with
 * no rate limit is the one that gets scraped.
 */
describe('CategoriesController — the public taxonomy route (C-1, §2.6)', () => {
  const routes: RouteContract[] = readRouteContracts(CategoriesController);

  it('exposes exactly one public route', () => {
    expect(routes.map((route) => route.label)).toEqual(['GET /categories']);
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

    it('admits an anonymous caller, a consumer and an admin alike', () => {
      expect(authorise(CategoriesController, handler, undefined)).toBeUndefined();
      expect(authorise(CategoriesController, handler, sessionFor(Role.CONSUMER))).toBeUndefined();
      expect(authorise(CategoriesController, handler, sessionFor(Role.ADMIN))).toBeUndefined();
    });
  });
});
