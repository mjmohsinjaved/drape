import { ErrorCode, Role } from '@library/common';

import {
  authorise,
  readRouteContracts,
  sessionFor,
  type RouteContract,
} from '../testing/route-authorisation';

import { AdminConsumersController } from './admin-consumers.controller';

describe('AdminConsumersController — authorisation (S-11, E-7)', () => {
  const routes: RouteContract[] = readRouteContracts(AdminConsumersController);

  it('declares exactly the routes §5.2 specifies, plus the A-19 approval', () => {
    expect(routes.map((route) => route.label).sort()).toEqual([
      'DELETE /admin/consumers/:userId',
      'GET /admin/consumers',
      'GET /admin/consumers/:userId',
      'GET /admin/consumers/:userId/renders',
      'GET /admin/consumers/:userId/shortlist',
      'PATCH /admin/consumers/:userId/quota',
      'POST /admin/consumers/:userId/approve',
      'POST /admin/consumers/:userId/suspend',
      'POST /admin/consumers/:userId/unsuspend',
    ]);
  });

  it('exposes exactly one route that can reach a render, and it is the enquiry-scoped one', () => {
    const renderRoutes = routes.filter((route) => route.path.includes('render'));
    expect(renderRoutes.map((route) => route.label)).toEqual([
      'GET /admin/consumers/:userId/renders',
    ]);
  });

  it('exposes no route that could reach a person photo (S-10)', () => {
    const photoRoutes = routes.filter((route) => /photo/i.test(route.path));
    expect(photoRoutes).toEqual([]);
  });

  describe.each(routes.map((route) => [route.label, route.handler]))('%s', (_label, handler) => {
    it('declares exactly @Roles(Role.ADMIN) and is not public', () => {
      const route = routes.find((candidate) => candidate.handler === handler);
      expect(route?.roles).toEqual([Role.ADMIN]);
      expect(route?.isPublic).toBe(false);
    });

    it('refuses a Consumer session with INSUFFICIENT_ROLE', () => {
      expect(authorise(AdminConsumersController, handler, sessionFor(Role.CONSUMER))).toBe(
        ErrorCode.INSUFFICIENT_ROLE,
      );
    });

    it('refuses an anonymous caller', () => {
      expect(authorise(AdminConsumersController, handler, undefined)).toBe(
        ErrorCode.INSUFFICIENT_ROLE,
      );
    });

    it('admits an Admin session', () => {
      expect(authorise(AdminConsumersController, handler, sessionFor(Role.ADMIN))).toBeUndefined();
    });
  });
});
