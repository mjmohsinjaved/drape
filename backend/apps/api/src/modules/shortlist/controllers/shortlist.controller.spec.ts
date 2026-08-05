import { ErrorCode, Role } from '@library/common';

import {
  authorise,
  readRouteContracts,
  sessionFor,
} from '@api/modules/users/testing/route-authorisation';

import { ShortlistController } from './shortlist.controller';

/**
 * **S-11 / E-7 — the shortlist has one audience, and it is her.**
 *
 * S-10 allows an admin to see a consumer's pieces only where she has sent an enquiry,
 * so an admin route into this controller would be a hole in that rule rather than a
 * convenience. The absence is asserted here rather than assumed.
 */
describe('Shortlist route authorisation (S-10, S-11)', () => {
  const routes = readRouteContracts(ShortlistController);

  it('finds every route', () => {
    expect(routes.length).toBe(5);
  });

  it.each(routes.map((route) => [route.label, route.handler]))(
    '%s declares @Roles(CONSUMER)',
    (_label, handler) => {
      const route = routes.find((candidate) => candidate.handler === handler);

      expect(route?.roles).toEqual([Role.CONSUMER]);
      expect(route?.isPublic).toBe(false);
    },
  );

  it.each(routes.map((route) => [route.label, route.handler]))(
    '%s refuses an admin',
    (_label, handler) => {
      expect(authorise(ShortlistController, handler, sessionFor(Role.ADMIN))).toBe(
        ErrorCode.INSUFFICIENT_ROLE,
      );
    },
  );

  it.each(routes.map((route) => [route.label, route.handler]))(
    '%s refuses a caller with no session',
    (_label, handler) => {
      expect(authorise(ShortlistController, handler, undefined)).toBe(ErrorCode.INSUFFICIENT_ROLE);
    },
  );

  it.each(routes.map((route) => [route.label, route.handler]))(
    '%s admits her',
    (_label, handler) => {
      expect(authorise(ShortlistController, handler, sessionFor(Role.CONSUMER))).toBeUndefined();
    },
  );

  it('is not browsable while signed out — a shortlist is not public (C-1)', () => {
    for (const route of routes) {
      expect(route.isPublic).toBe(false);
      expect(route.roles).not.toContain(Role.PUBLIC);
    }
  });
});
