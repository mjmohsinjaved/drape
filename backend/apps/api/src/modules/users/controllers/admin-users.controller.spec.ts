import { ErrorCode, Role } from '@library/common';

import {
  authorise,
  readRouteContracts,
  sessionFor,
  type RouteContract,
} from '../testing/route-authorisation';

import { AdminUsersController } from './admin-users.controller';

/**
 * **PRD S-11 / E-7 — the authorisation test for every admin-only route on
 * `/admin/users`.**
 *
 * The route table is read from the controller's own decorator metadata rather than
 * listed here, so a handler added later is covered automatically. If somebody adds
 * `POST /admin/users/:userId/promote` without a `@Roles()`, the first block fails —
 * and so does `npm run check:guards`, which is the belt to this file's braces.
 */
describe('AdminUsersController — authorisation (S-11, E-7)', () => {
  const routes: RouteContract[] = readRouteContracts(AdminUsersController);

  it('declares the five routes ARCHITECTURE §5.2 specifies', () => {
    expect(routes.map((route) => route.label).sort()).toEqual([
      'GET /admin/users',
      'GET /admin/users/:userId',
      'PATCH /admin/users/:userId/role',
      'POST /admin/users/:userId/deactivate',
      'POST /admin/users/:userId/reactivate',
    ]);
  });

  it('has routes to test at all', () => {
    // Guards against the failure mode where metadata reading silently returns [] and
    // every it.each below vacuously passes.
    expect(routes.length).toBeGreaterThan(0);
  });

  describe.each(routes.map((route) => [route.label, route.handler]))('%s', (_label, handler) => {
    it('declares exactly @Roles(Role.ADMIN) and is not public', () => {
      const route = routes.find((candidate) => candidate.handler === handler);
      expect(route?.roles).toEqual([Role.ADMIN]);
      expect(route?.isPublic).toBe(false);
    });

    it('refuses a Consumer session with INSUFFICIENT_ROLE', () => {
      expect(authorise(AdminUsersController, handler, sessionFor(Role.CONSUMER))).toBe(
        ErrorCode.INSUFFICIENT_ROLE,
      );
    });

    it('refuses an anonymous caller', () => {
      expect(authorise(AdminUsersController, handler, undefined)).toBe(ErrorCode.INSUFFICIENT_ROLE);
    });

    it('admits an Admin session', () => {
      expect(authorise(AdminUsersController, handler, sessionFor(Role.ADMIN))).toBeUndefined();
    });
  });
});
