import { ErrorCode, Role } from '@library/common';

import {
  authorise,
  readRouteContracts,
  sessionFor,
  type RouteContract,
} from '@api/modules/users/testing/route-authorisation';

import { AdminCategoriesController } from './admin-categories.controller';

/**
 * **PRD S-11 / E-7 — the authorisation test for every admin taxonomy route.**
 *
 * > "Authorisation is enforced server-side on every route and mutation. Every
 * > Admin-only route carries an authorisation test."
 *
 * The route table is read from the controller's own decorator metadata rather than
 * listed by hand, so a handler added later is covered the moment it exists. The guard
 * under test is the real `RolesGuard` with a real `Reflector`.
 */
describe('AdminCategoriesController — authorisation (S-11, E-7)', () => {
  const routes: RouteContract[] = readRouteContracts(AdminCategoriesController);

  it('declares the routes ARCHITECTURE §5.5 specifies', () => {
    expect(routes.map((route) => route.label).sort()).toEqual([
      'DELETE /admin/categories/:categoryId',
      'GET /admin/categories',
      'PATCH /admin/categories/:categoryId',
      'POST /admin/categories',
      'POST /admin/categories/:categoryId/archive',
      'POST /admin/categories/:categoryId/restore',
      'POST /admin/categories/reorder',
    ]);
  });

  it('has routes to test at all', () => {
    // Guards against metadata reading silently returning [] and every case below
    // passing vacuously.
    expect(routes.length).toBeGreaterThan(0);
  });

  describe.each(routes.map((route) => [route.label, route.handler]))('%s', (_label, handler) => {
    it('declares exactly @Roles(Role.ADMIN) and is not public', () => {
      const route = routes.find((candidate) => candidate.handler === handler);
      expect(route?.roles).toEqual([Role.ADMIN]);
      expect(route?.isPublic).toBe(false);
    });

    it('refuses a Consumer session with INSUFFICIENT_ROLE', () => {
      expect(authorise(AdminCategoriesController, handler, sessionFor(Role.CONSUMER))).toBe(
        ErrorCode.INSUFFICIENT_ROLE,
      );
    });

    it('refuses an anonymous caller', () => {
      expect(authorise(AdminCategoriesController, handler, undefined)).toBe(
        ErrorCode.INSUFFICIENT_ROLE,
      );
    });

    it('admits an Admin session', () => {
      expect(authorise(AdminCategoriesController, handler, sessionFor(Role.ADMIN))).toBeUndefined();
    });
  });
});
