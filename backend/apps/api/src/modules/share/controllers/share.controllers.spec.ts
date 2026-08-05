import type { Type } from '@nestjs/common';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';

import { ErrorCode, Role } from '@library/common';

import {
  authorise,
  readRouteContracts,
  sessionFor,
} from '@api/modules/users/testing/route-authorisation';

import { PublicShareController } from './public-share.controller';
import { ShareLinksController } from './share-links.controller';

/**
 * **B-5 / §2.6 — the two halves of sharing, and the decorators each half must carry.**
 *
 * The recipient routes are the only unauthenticated write surface in the product, so
 * this file checks more than the role: §2.6 requires a `@Public()` route to *also*
 * declare `@Roles(Role.PUBLIC)` and an **explicit** `@Throttle()`, and §5.22 fixes the
 * vote limit at 10 per minute. A public route that inherited the global default would
 * be one settings change away from a much looser limit than anybody intended.
 */
describe('Share route authorisation (B-5, §2.6, §5.22)', () => {
  const publicRoutes = readRouteContracts(PublicShareController);
  const ownerRoutes = readRouteContracts(ShareLinksController);

  /** The `@Throttle()` metadata a handler declares, if any. */
  function throttleOf(
    controller: Type,
    handler: string,
  ): { limit: unknown; ttl: unknown } | undefined {
    const prototype = controller.prototype as Record<string, unknown>;
    const method = prototype[handler];

    const limit: unknown = Reflect.getMetadata(`${THROTTLER_LIMIT}default`, method as object);
    const ttl: unknown = Reflect.getMetadata(`${THROTTLER_TTL}default`, method as object);

    return limit === undefined && ttl === undefined ? undefined : { limit, ttl };
  }

  it('finds every route on both controllers', () => {
    expect(publicRoutes.length).toBe(3);
    expect(ownerRoutes.length).toBe(4);
  });

  describe('the recipient routes require no account (C-33)', () => {
    it.each(publicRoutes.map((route) => [route.label, route.handler]))(
      '%s declares @Public() and @Roles(PUBLIC)',
      (_label, handler) => {
        const route = publicRoutes.find((candidate) => candidate.handler === handler);

        expect(route?.isPublic).toBe(true);
        expect(route?.roles).toEqual([Role.PUBLIC]);
      },
    );

    it.each(publicRoutes.map((route) => [route.label, route.handler]))(
      '%s admits a caller with no session at all',
      (_label, handler) => {
        expect(authorise(PublicShareController, handler, undefined)).toBeUndefined();
      },
    );

    it.each(publicRoutes.map((route) => [route.label, route.handler]))(
      '%s carries an explicit @Throttle() (§2.6)',
      (_label, handler) => {
        expect(throttleOf(PublicShareController, handler)).toBeDefined();
      },
    );

    it('throttles the vote route hard — 10 / 60 s (§5.22)', () => {
      const vote = publicRoutes.find((route) => route.verb === 'POST');
      const throttle = throttleOf(PublicShareController, vote?.handler ?? '');

      expect(throttle).toEqual({ limit: 10, ttl: 60_000 });
    });
  });

  describe('the owner routes are CONSUMER only (C-34)', () => {
    it.each(ownerRoutes.map((route) => [route.label, route.handler]))(
      '%s declares @Roles(CONSUMER)',
      (_label, handler) => {
        const route = ownerRoutes.find((candidate) => candidate.handler === handler);

        expect(route?.roles).toEqual([Role.CONSUMER]);
        expect(route?.isPublic).toBe(false);
      },
    );

    it.each(ownerRoutes.map((route) => [route.label, route.handler]))(
      '%s refuses a caller with no session',
      (_label, handler) => {
        expect(authorise(ShareLinksController, handler, undefined)).toBe(
          ErrorCode.INSUFFICIENT_ROLE,
        );
      },
    );

    it.each(ownerRoutes.map((route) => [route.label, route.handler]))(
      '%s refuses an admin — her links are hers',
      (_label, handler) => {
        expect(authorise(ShareLinksController, handler, sessionFor(Role.ADMIN))).toBe(
          ErrorCode.INSUFFICIENT_ROLE,
        );
      },
    );

    it.each(ownerRoutes.map((route) => [route.label, route.handler]))(
      '%s admits her',
      (_label, handler) => {
        expect(authorise(ShareLinksController, handler, sessionFor(Role.CONSUMER))).toBeUndefined();
      },
    );
  });

  it('there is no admin route into sharing at all', () => {
    for (const route of [...publicRoutes, ...ownerRoutes]) {
      expect(route.roles).not.toContain(Role.ADMIN);
      expect(route.path.startsWith('/admin')).toBe(false);
    }
  });
});
