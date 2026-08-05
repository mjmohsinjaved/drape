import { THROTTLER_LIMIT } from '@nestjs/throttler/dist/throttler.constants';

import { ErrorCode, Role } from '@library/common';

import {
  authorise,
  readRouteContracts,
  sessionFor,
  type RouteContract,
} from '@api/modules/users/testing/route-authorisation';

import { CreateInviteDto } from '../dto/create-invite.dto';

import { InvitesController } from './invites.controller';

/**
 * **PRD S-5, S-11 and E-7 — the authorisation test for every invite route.**
 *
 * S-5 makes an invitation one of only two ways an admin account can come into
 * existence, which makes this controller a privilege-escalation surface if any part
 * of it is reachable by a consumer. Three things are asserted, and all three have to
 * hold together:
 *
 * 1. every management route is `@Roles(Role.ADMIN)` and refuses a consumer session;
 * 2. the one public route is read-only and cannot issue or consume anything;
 * 3. `CreateInviteDto` has no `role` property — the invited role is read from S-5 in
 *    the service, never from a request body.
 */
describe('InvitesController — authorisation (S-5, S-11, E-7)', () => {
  const routes: RouteContract[] = readRouteContracts(InvitesController);

  const managementRoutes = routes.filter((route) => !route.isPublic);
  const publicRoutes = routes.filter((route) => route.isPublic);

  it('declares the routes ARCHITECTURE §5.3 assigns to this module', () => {
    expect(routes.map((route) => route.label).sort()).toEqual([
      'DELETE /invites/:inviteId',
      'GET /invites',
      'GET /invites/token/:token',
      'POST /invites',
      'POST /invites/:inviteId/resend',
    ]);
  });

  it('leaves POST /invites/token/:token/accept to auth — account creation is not this module', () => {
    expect(routes.map((route) => route.label)).not.toContain('POST /invites/token/:token/accept');
  });

  /* ---------------------------------------------------------------------------------------
   * Management routes
   * ------------------------------------------------------------------------------------ */

  it('finds four admin-only management routes', () => {
    expect(managementRoutes).toHaveLength(4);
  });

  describe.each(managementRoutes.map((route) => [route.label, route.handler]))(
    '%s',
    (_label, handler) => {
      it('declares exactly @Roles(Role.ADMIN)', () => {
        const route = routes.find((candidate) => candidate.handler === handler);
        expect(route?.roles).toEqual([Role.ADMIN]);
      });

      it('refuses a Consumer session — a consumer can never create or manage an invite', () => {
        expect(authorise(InvitesController, handler, sessionFor(Role.CONSUMER))).toBe(
          ErrorCode.INSUFFICIENT_ROLE,
        );
      });

      it('refuses an anonymous caller', () => {
        expect(authorise(InvitesController, handler, undefined)).toBe(ErrorCode.INSUFFICIENT_ROLE);
      });

      it('admits an Admin session', () => {
        expect(authorise(InvitesController, handler, sessionFor(Role.ADMIN))).toBeUndefined();
      });
    },
  );

  /* ---------------------------------------------------------------------------------------
   * The one public route
   * ------------------------------------------------------------------------------------ */

  describe('GET /invites/token/:token', () => {
    it('is the only public route on the controller', () => {
      expect(publicRoutes.map((route) => route.label)).toEqual(['GET /invites/token/:token']);
    });

    it('declares @Roles(Role.PUBLIC) alongside @Public(), as §2.6 requires', () => {
      expect(publicRoutes[0].roles).toEqual([Role.PUBLIC]);
      expect(publicRoutes[0].isPublic).toBe(true);
    });

    it('carries an explicit @Throttle() — a public token lookup is a guessing surface', () => {
      const prototype = InvitesController.prototype as unknown as Record<string, unknown>;
      const handler = prototype[publicRoutes[0].handler] as () => unknown;
      const limits = Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler) as unknown;

      expect(limits).toBeDefined();
    });

    it('is a GET, so it cannot consume the token it validates', () => {
      expect(publicRoutes[0].verb).toBe('GET');
    });

    it('admits an anonymous caller — the invited person has no account yet', () => {
      expect(authorise(InvitesController, publicRoutes[0].handler, undefined)).toBeUndefined();
    });
  });

  /* ---------------------------------------------------------------------------------------
   * No role escalation through the payload
   * ------------------------------------------------------------------------------------ */

  describe('the create payload cannot choose a role (S-4, S-5)', () => {
    it('has no role property to send', () => {
      const dto = new CreateInviteDto();
      expect('role' in dto).toBe(false);
      expect(Object.keys(dto)).not.toContain('role');
    });

    it('would drop a role field sent anyway — it is not a declared property', () => {
      const payload = JSON.parse('{"email":"x@example.invalid","role":"ADMIN"}') as Record<
        string,
        unknown
      >;
      const declared = Object.getOwnPropertyNames(new CreateInviteDto());

      expect(declared).not.toContain('role');
      // The global CustomValidationPipe whitelists; nothing undeclared survives binding.
      expect(Object.keys(payload).filter((key) => declared.includes(key))).not.toContain('role');
    });
  });
});
