import type { Type } from '@nestjs/common';

import { ErrorCode, Role } from '@library/common';

import {
  authorise,
  readRouteContracts,
  sessionFor,
  type RouteContract,
} from '@api/modules/users/testing/route-authorisation';

import { AdminConsumerQuotaController } from './admin-consumer-quota.controller';
import { AdminUsageController } from './admin-usage.controller';
import { QuotaController } from './quota.controller';

/**
 * **PRD S-11 / E-7 — an authorisation test for every route in the module.**
 *
 * The split matters here more than usual. `GET /quota/me` is hers and reads her own
 * derived counter; everything under `/admin/**` reads platform spend or writes a
 * ledger. A consumer reaching an admin route would see other accounts' usage; an admin
 * reaching a consumer route would be reading somebody's counter from a session id that
 * is not theirs. Both are refused by the same real `RolesGuard` this suite runs.
 */

const ADMIN_CONTROLLERS: readonly [string, Type][] = [
  ['AdminUsageController', AdminUsageController],
  ['AdminConsumerQuotaController', AdminConsumerQuotaController],
];

describe('QuotaController — the consumer counter (C-5)', () => {
  const routes: RouteContract[] = readRouteContracts(QuotaController);

  it('declares exactly `GET /quota/me`', () => {
    expect(routes.map((route) => route.label)).toEqual(['GET /quota/me']);
  });

  it('is @Roles(Role.CONSUMER) and refuses an admin session', () => {
    expect(routes[0].roles).toEqual([Role.CONSUMER]);
    expect(routes[0].isPublic).toBe(false);
    expect(authorise(QuotaController, routes[0].handler, sessionFor(Role.ADMIN))).toBe(
      ErrorCode.INSUFFICIENT_ROLE,
    );
    expect(
      authorise(QuotaController, routes[0].handler, sessionFor(Role.CONSUMER)),
    ).toBeUndefined();
  });

  it('takes no user id from the path — ownership is the session, not a URL segment (§9.2)', () => {
    expect(routes[0].path).not.toMatch(/:/);
  });
});

describe.each(ADMIN_CONTROLLERS)('%s — authorisation (S-11, E-7)', (_name, controller) => {
  const routes: RouteContract[] = readRouteContracts(controller);

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
      expect(authorise(controller, handler, sessionFor(Role.CONSUMER))).toBe(
        ErrorCode.INSUFFICIENT_ROLE,
      );
    });

    it('refuses an anonymous caller', () => {
      expect(authorise(controller, handler, undefined)).toBe(ErrorCode.INSUFFICIENT_ROLE);
    });

    it('admits an Admin session', () => {
      expect(authorise(controller, handler, sessionFor(Role.ADMIN))).toBeUndefined();
    });
  });
});

describe('quota module — the §5.16 route table', () => {
  it('declares every route ARCHITECTURE §5.16 specifies', () => {
    const labels = [
      ...readRouteContracts(QuotaController),
      ...readRouteContracts(AdminUsageController),
      ...readRouteContracts(AdminConsumerQuotaController),
    ]
      .map((route) => route.label)
      .sort();

    expect(labels).toEqual([
      'GET /admin/consumers/:userId/quota-ledger',
      'GET /admin/usage',
      'GET /admin/usage/ledger',
      'GET /quota/me',
      'POST /admin/consumers/:userId/quota-adjust',
      'POST /admin/usage/adjust',
    ]);
  });
});
