import { RequestMethod, type ExecutionContext, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import {
  AppException,
  IS_PUBLIC_KEY,
  Locale,
  Role,
  ROLES_KEY,
  RolesGuard,
  UserStatus,
  type ErrorCode,
  type ICurrentUser,
} from '@library/common';

/**
 * Route-level authorisation testing — PRD S-11 and E-7.
 *
 * > "Authorisation is enforced server-side on every route and mutation. **Every
 * > Admin-only route carries an authorisation test.**"
 *
 * A test that names each handler by hand satisfies that sentence only until somebody
 * adds a handler and forgets to add a test. {@link readRouteContracts} walks the
 * controller's own route table instead, so a new route is covered the moment it
 * exists — and an uncovered one fails the suite rather than slipping through.
 *
 * The guard under test is the **real** `RolesGuard` with a **real** `Reflector`,
 * reading the metadata the decorators actually emitted. Nothing here re-implements
 * the authorisation rule; it exercises it.
 */

/** One route handler and the contract its decorators declare. */
export interface RouteContract {
  readonly handler: string;
  readonly verb: string;
  /** Controller prefix joined to the handler path, e.g. `admin/users/:userId/role`. */
  readonly path: string;
  readonly roles: readonly Role[] | undefined;
  readonly isPublic: boolean;
  /** Human-readable label for a test name. */
  readonly label: string;
}

const VERB_BY_METHOD: Readonly<Record<number, string>> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
};

/** Every route handler a controller declares, with its `@Roles()` / `@Public()` contract. */
export function readRouteContracts(controller: Type): RouteContract[] {
  const prefix = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
  const prototype = controller.prototype as Record<string, unknown>;

  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => prototype[name])
    .filter((value): value is (...args: unknown[]) => unknown => typeof value === 'function')
    .filter((handler) => Reflect.hasMetadata(METHOD_METADATA, handler))
    .map((handler) => {
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as number;
      const routePath = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
      const verb = VERB_BY_METHOD[method] ?? 'UNKNOWN';
      const path = `/${[prefix, routePath].filter((part) => part !== '' && part !== '/').join('/')}`;

      const roles = Reflect.getMetadata(ROLES_KEY, handler) as readonly Role[] | undefined;
      const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true;

      return {
        handler: handler.name,
        verb,
        path,
        roles,
        isPublic,
        label: `${verb} ${path}`,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

/** A believable signed-in caller. Only `role` and `status` matter to `RolesGuard`. */
export function sessionFor(role: Role, overrides: Partial<ICurrentUser> = {}): ICurrentUser {
  return {
    id:
      role === Role.ADMIN
        ? 'a0000000-0000-4000-8000-00000000000a'
        : 'c0000000-0000-4000-8000-00000000000c',
    role,
    email: role === Role.ADMIN ? 'admin@example.invalid' : 'consumer@example.invalid',
    name: role === Role.ADMIN ? 'Test Admin' : 'Test Consumer',
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
    phoneVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
    sessionId: '11112222-3333-4444-8555-666677778888',
    locale: Locale.EN,
    ...overrides,
  };
}

function executionContext(
  controller: Type,
  handlerName: string,
  user: ICurrentUser | undefined,
): ExecutionContext {
  const prototype = controller.prototype as Record<string, unknown>;
  const handler = prototype[handlerName];

  return {
    getType: <T>(): T => 'http' as unknown as T,
    getHandler: () => handler as () => unknown,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: <T>(): T => ({ user, method: 'GET', route: { path: '/test' } }) as unknown as T,
    }),
  } as unknown as ExecutionContext;
}

/**
 * Runs the real `RolesGuard` against a real handler.
 *
 * @returns `undefined` when the route is allowed, or the `ErrorCode` it was refused
 * with. A test asserting `INSUFFICIENT_ROLE` is asserting the same rejection a
 * consumer's browser would receive.
 */
export function authorise(
  controller: Type,
  handlerName: string,
  user: ICurrentUser | undefined,
): ErrorCode | undefined {
  const guard = new RolesGuard(new Reflector());

  try {
    guard.canActivate(executionContext(controller, handlerName, user));
    return undefined;
  } catch (error) {
    if (error instanceof AppException) {
      return error.errorCode;
    }
    throw error;
  }
}
