import { ErrorCode, Role } from '@library/common';

import {
  authorise,
  readRouteContracts,
  sessionFor,
  type RouteContract,
} from '../testing/route-authorisation';

import { MeController } from './me.controller';

/**
 * `/me` role contracts (§5.2) and the §9.2 structural property that matters most on
 * self routes: **none of them takes a user id.**
 *
 * "Never infer ownership from an unguessable id" is easy to state and easy to
 * forget. On this controller it is not a rule anyone has to remember, because there
 * is no id in any path to infer from — the caller comes from `@CurrentUser()`, which
 * only `SessionAuthGuard` populates (S-3). The first test below is what keeps that
 * true.
 */
describe('MeController — authorisation (S-11, §9.2)', () => {
  const routes: RouteContract[] = readRouteContracts(MeController);

  it('declares the six routes ARCHITECTURE §5.2 specifies for this module', () => {
    expect(routes.map((route) => route.label).sort()).toEqual([
      'GET /me',
      'GET /me/notification-preferences',
      'GET /me/profile',
      'PATCH /me',
      'PATCH /me/notification-preferences',
      'PATCH /me/profile',
    ]);
  });

  it('takes no id in any path — ownership can only come from the session (§9.2)', () => {
    for (const route of routes) {
      expect(route.path).not.toMatch(/:/);
    }
  });

  it('leaves no route public: /me is meaningless without a session', () => {
    for (const route of routes) {
      expect(route.isPublic).toBe(false);
      expect(route.roles ?? []).not.toContain(Role.PUBLIC);
    }
  });

  describe.each(routes.map((route) => [route.label, route.handler]))('%s', (_label, handler) => {
    it('refuses an anonymous caller', () => {
      expect(authorise(MeController, handler, undefined)).toBe(ErrorCode.INSUFFICIENT_ROLE);
    });

    it('admits a Consumer session', () => {
      expect(authorise(MeController, handler, sessionFor(Role.CONSUMER))).toBeUndefined();
    });
  });

  describe('the C-2 profile routes are consumer-only', () => {
    const profileRoutes = readRouteContracts(MeController).filter((route) =>
      route.path.endsWith('/profile'),
    );

    it('finds both of them', () => {
      expect(profileRoutes).toHaveLength(2);
    });

    it.each(profileRoutes.map((route) => [route.label, route.handler]))(
      '%s refuses an Admin session — an admin has no consumer profile row',
      (_label, handler) => {
        expect(authorise(MeController, handler, sessionFor(Role.ADMIN))).toBe(
          ErrorCode.INSUFFICIENT_ROLE,
        );
      },
    );
  });

  describe('the account and notification routes are open to either role (§5.2 "ANY")', () => {
    const anyRoutes = readRouteContracts(MeController).filter(
      (route) => !route.path.endsWith('/profile'),
    );

    it.each(anyRoutes.map((route) => [route.label, route.handler]))(
      '%s admits an Admin session',
      (_label, handler) => {
        expect(authorise(MeController, handler, sessionFor(Role.ADMIN))).toBeUndefined();
      },
    );
  });
});
