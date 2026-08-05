import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ErrorCode, Role } from '@library/common';

import {
  authorise,
  readRouteContracts,
  sessionFor,
  type RouteContract,
} from '@api/modules/users/testing/route-authorisation';

import { PersonPhotosController } from './person-photos.controller';

/**
 * **PRD S-10 / E-7 — the authorisation test for the most sensitive table in the schema.**
 *
 * S-10: *"Admins can never read a consumer's photo. Enforce it in the query layer and
 * cover it with a test."* The strongest form of that enforcement is not a filtered
 * query — it is the absence of a route. §5.9 lists five endpoints and every one of them
 * belongs to the consumer whose photograph it is.
 *
 * Two things are asserted, because either alone would be too weak:
 *
 *  1. every declared route is `@Roles(Role.CONSUMER)` and refuses an admin session,
 *     read from the controller's own metadata so a route added later is covered the
 *     moment it exists;
 *  2. **no other controller exists in this module at all** — a check on the directory,
 *     not on this file, so an `admin-person-photos.controller.ts` added in a hurry
 *     fails the suite instead of shipping.
 */
describe('PersonPhotosController — authorisation (S-10, E-7)', () => {
  const routes: RouteContract[] = readRouteContracts(PersonPhotosController);

  it('declares exactly the five routes ARCHITECTURE §5.9 specifies', () => {
    expect(routes.map((route) => route.label).sort()).toEqual([
      'DELETE /person-photos/:photoId',
      'GET /person-photos',
      'PATCH /person-photos/:photoId',
      'POST /person-photos',
      'POST /person-photos/:photoId/activate',
    ]);
  });

  describe.each(routes.map((route) => [route.label, route.handler]))('%s', (_label, handler) => {
    it('declares exactly @Roles(Role.CONSUMER) and is not public', () => {
      const route = routes.find((candidate) => candidate.handler === handler);
      expect(route?.roles).toEqual([Role.CONSUMER]);
      expect(route?.isPublic).toBe(false);
    });

    it('refuses an Admin session with INSUFFICIENT_ROLE (S-10)', () => {
      expect(authorise(PersonPhotosController, handler, sessionFor(Role.ADMIN))).toBe(
        ErrorCode.INSUFFICIENT_ROLE,
      );
    });

    it('refuses an anonymous caller', () => {
      expect(authorise(PersonPhotosController, handler, undefined)).toBe(
        ErrorCode.INSUFFICIENT_ROLE,
      );
    });

    it('admits a Consumer session', () => {
      expect(authorise(PersonPhotosController, handler, sessionFor(Role.CONSUMER))).toBeUndefined();
    });
  });
});

describe('person-photos module — an admin has no route here at all (S-10)', () => {
  const controllersDirectory = __dirname;

  it('declares exactly one controller, and it is the consumer one', () => {
    const controllers = readdirSync(controllersDirectory).filter((name) =>
      name.endsWith('.controller.ts'),
    );

    expect(controllers).toEqual(['person-photos.controller.ts']);
  });

  it('mentions no admin path and no admin role anywhere in the module', () => {
    const moduleRoot = join(controllersDirectory, '..');

    for (const file of sourceFilesUnder(moduleRoot)) {
      const source = readFileSync(file, 'utf8');
      // Prose about S-10 legitimately says "admin"; a route contract does not.
      expect(source).not.toMatch(/@Controller\(\s*['"`]admin/);
      expect(source).not.toMatch(/Roles\(\s*Role\.ADMIN/);
    }
  });
});

/** Every `.ts` under `directory`, excluding this suite's own files. */
function sourceFilesUnder(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true, encoding: 'utf8' })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFilesUnder(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      found.push(full);
    }
  }

  return found;
}
