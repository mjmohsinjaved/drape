import { ErrorCode, Role } from '@library/common';

import {
  authorise,
  readRouteContracts,
  sessionFor,
} from '@api/modules/users/testing/route-authorisation';

import { AdminEnquiriesController } from './admin-enquiries.controller';
import { EnquiriesController } from './enquiries.controller';

/**
 * **S-11 / E-7 — "every Admin-only route carries an authorisation test."**
 *
 * The contracts are read from each controller's **own route table**, so a route added
 * tomorrow is covered the moment it exists rather than the moment somebody remembers to
 * write a test for it. The guard under test is the real `RolesGuard` with a real
 * `Reflector`, reading the metadata the decorators actually emitted.
 *
 * These two controllers are the S-10 boundary in miniature: everything under
 * `/admin/enquiries` reads every enquiry in the system and is `ADMIN`; everything under
 * `/enquiries` reads exactly one consumer's and is `CONSUMER`. Neither set contains a
 * route the other role can reach.
 */
describe('Enquiry route authorisation (S-11, E-7)', () => {
  const adminRoutes = readRouteContracts(AdminEnquiriesController);
  const consumerRoutes = readRouteContracts(EnquiriesController);

  it('finds every route on both controllers', () => {
    // A guard against the walker silently finding nothing and the suite passing empty.
    expect(adminRoutes.length).toBe(8);
    expect(consumerRoutes.length).toBe(3);
  });

  describe('every /admin/enquiries route is ADMIN only', () => {
    it.each(adminRoutes.map((route) => [route.label, route.handler]))(
      '%s declares @Roles(ADMIN)',
      (_label, handler) => {
        const route = adminRoutes.find((candidate) => candidate.handler === handler);

        expect(route?.roles).toEqual([Role.ADMIN]);
        expect(route?.isPublic).toBe(false);
      },
    );

    it.each(adminRoutes.map((route) => [route.label, route.handler]))(
      '%s refuses a consumer',
      (_label, handler) => {
        expect(authorise(AdminEnquiriesController, handler, sessionFor(Role.CONSUMER))).toBe(
          ErrorCode.INSUFFICIENT_ROLE,
        );
      },
    );

    it.each(adminRoutes.map((route) => [route.label, route.handler]))(
      '%s refuses a caller with no session',
      (_label, handler) => {
        expect(authorise(AdminEnquiriesController, handler, undefined)).toBe(
          ErrorCode.INSUFFICIENT_ROLE,
        );
      },
    );

    it.each(adminRoutes.map((route) => [route.label, route.handler]))(
      '%s admits an admin',
      (_label, handler) => {
        expect(
          authorise(AdminEnquiriesController, handler, sessionFor(Role.ADMIN)),
        ).toBeUndefined();
      },
    );
  });

  describe('every /enquiries route is CONSUMER only', () => {
    it.each(consumerRoutes.map((route) => [route.label, route.handler]))(
      '%s declares @Roles(CONSUMER)',
      (_label, handler) => {
        const route = consumerRoutes.find((candidate) => candidate.handler === handler);

        expect(route?.roles).toEqual([Role.CONSUMER]);
        expect(route?.isPublic).toBe(false);
      },
    );

    it.each(consumerRoutes.map((route) => [route.label, route.handler]))(
      '%s refuses an admin — a consumer enquiry route is not an admin surface',
      (_label, handler) => {
        expect(authorise(EnquiriesController, handler, sessionFor(Role.ADMIN))).toBe(
          ErrorCode.INSUFFICIENT_ROLE,
        );
      },
    );

    it.each(consumerRoutes.map((route) => [route.label, route.handler]))(
      '%s refuses a caller with no session',
      (_label, handler) => {
        expect(authorise(EnquiriesController, handler, undefined)).toBe(
          ErrorCode.INSUFFICIENT_ROLE,
        );
      },
    );
  });

  it('no enquiry route is public — none of this is browsable while signed out', () => {
    for (const route of [...adminRoutes, ...consumerRoutes]) {
      expect(route.isPublic).toBe(false);
      expect(route.roles).not.toContain(Role.PUBLIC);
    }
  });

  it('the internal-notes routes are on the admin controller and nowhere else (A-24)', () => {
    expect(adminRoutes.some((route) => route.path.endsWith('/notes'))).toBe(true);
    expect(consumerRoutes.some((route) => route.path.includes('notes'))).toBe(false);
  });
});
