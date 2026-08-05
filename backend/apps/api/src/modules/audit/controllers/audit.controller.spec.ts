import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  ErrorCode,
  ForbiddenException,
  Locale,
  Role,
  RolesGuard,
  UserStatus,
} from '@library/common';
import type { ICurrentUser } from '@library/common';

import { AuditController } from './audit.controller';

/**
 * §5.19 / S-11 / E-7 — every ADMIN route carries an authorisation test.
 *
 * The audit log records who did what to whose data. A consumer being able to read it
 * would hand her the moderation history, the suspension reasons and the settings
 * changes of a studio she has no relationship with beyond her own account — so this
 * is exercised against the **real** `RolesGuard` and the **real** decorator metadata,
 * not against a hand-written list of expected roles.
 */

function currentUser(role: Role): ICurrentUser {
  return {
    id: 'aa11bb22-cc33-4d44-8e55-ff6677889900',
    role,
    email: 'ayesha@example.com',
    name: 'Ayesha',
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
    phoneVerifiedAt: null,
    sessionId: '11112222-3333-4444-8555-666677778888',
    locale: Locale.EN,
  };
}

/** Every route handler this controller declares, discovered rather than listed. */
const HANDLERS: readonly (keyof AuditController)[] = ['list', 'listActions'];

function contextFor(
  handler: keyof AuditController,
  user: ICurrentUser | undefined,
): ExecutionContext {
  return {
    getType: <T>(): T => 'http' as unknown as T,
    getHandler: () => AuditController.prototype[handler],
    getClass: () => AuditController,
    switchToHttp: () => ({
      getRequest: <T>(): T =>
        ({ user, method: 'GET', route: { path: '/api/v1/admin/audit' } }) as unknown as T,
    }),
  } as unknown as ExecutionContext;
}

describe('AuditController — authorisation (A-3, S-11)', () => {
  const guard = new RolesGuard(new Reflector());

  it.each(HANDLERS)('denies a Consumer on %s()', (handler) => {
    expect(() => guard.canActivate(contextFor(handler, currentUser(Role.CONSUMER)))).toThrow(
      ForbiddenException,
    );

    try {
      guard.canActivate(contextFor(handler, currentUser(Role.CONSUMER)));
      throw new Error('RolesGuard let a Consumer through to the audit log.');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).errorCode).toBe(ErrorCode.INSUFFICIENT_ROLE);
    }
  });

  it.each(HANDLERS)('denies an anonymous caller on %s()', (handler) => {
    expect(() => guard.canActivate(contextFor(handler, undefined))).toThrow(ForbiddenException);
  });

  it.each(HANDLERS)('admits an Admin on %s()', (handler) => {
    expect(guard.canActivate(contextFor(handler, currentUser(Role.ADMIN)))).toBe(true);
  });

  it('declares @Roles(Role.ADMIN) — and nothing wider — on every handler', () => {
    const reflector = new Reflector();

    for (const handler of HANDLERS) {
      const roles = reflector.getAllAndOverride<Role[] | undefined>('roles', [
        AuditController.prototype[handler],
        AuditController,
      ]);
      expect(roles).toEqual([Role.ADMIN]);
    }
  });

  it('exposes no write route — audit rows never arrive over HTTP', () => {
    const methods = Object.getOwnPropertyNames(AuditController.prototype).filter(
      (name) => name !== 'constructor',
    );

    expect(methods.sort()).toEqual([...HANDLERS].sort());
  });
});
