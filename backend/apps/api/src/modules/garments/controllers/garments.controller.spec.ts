import { ErrorCode, Role } from '@library/common';

import {
  authorise,
  readRouteContracts,
  sessionFor,
  type RouteContract,
} from '@api/modules/users/testing/route-authorisation';

import { GarmentsController } from './garments.controller';

/**
 * **PRD S-11 / E-7 — the authorisation test for every admin garment route.**
 *
 * Read from the controller's own decorator metadata, so a route added later is
 * covered the moment it exists — and an uncovered one fails the suite rather than
 * slipping through. The guard under test is the real `RolesGuard`.
 *
 * The point worth naming: **a Consumer cannot reach any of these.** The public
 * surface for a garment is `GET /catalog/garments/:slugOrId`, which returns a
 * different DTO from a query that cannot see a draft (E-10).
 */
describe('GarmentsController — authorisation (S-11, E-7)', () => {
  const routes: RouteContract[] = readRouteContracts(GarmentsController);

  it('declares the record routes ARCHITECTURE §5.6 specifies', () => {
    expect(routes.map((route) => route.label).sort()).toEqual([
      'DELETE /admin/garments/:garmentId',
      'GET /admin/garments',
      'GET /admin/garments/:garmentId',
      'PATCH /admin/garments/:garmentId',
      'POST /admin/garments',
      'POST /admin/garments/:garmentId/archive',
      'POST /admin/garments/:garmentId/publish',
      'POST /admin/garments/:garmentId/quality-override',
      'POST /admin/garments/:garmentId/unpublish',
      'POST /admin/garments/bulk',
    ]);
  });

  it('has routes to test at all', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  describe.each(routes.map((route) => [route.label, route.handler]))('%s', (_label, handler) => {
    it('declares exactly @Roles(Role.ADMIN) and is not public', () => {
      const route = routes.find((candidate) => candidate.handler === handler);
      expect(route?.roles).toEqual([Role.ADMIN]);
      expect(route?.isPublic).toBe(false);
    });

    it('refuses a Consumer session with INSUFFICIENT_ROLE', () => {
      expect(authorise(GarmentsController, handler, sessionFor(Role.CONSUMER))).toBe(
        ErrorCode.INSUFFICIENT_ROLE,
      );
    });

    it('refuses an anonymous caller', () => {
      expect(authorise(GarmentsController, handler, undefined)).toBe(ErrorCode.INSUFFICIENT_ROLE);
    });

    it('admits an Admin session', () => {
      expect(authorise(GarmentsController, handler, sessionFor(Role.ADMIN))).toBeUndefined();
    });
  });
});
