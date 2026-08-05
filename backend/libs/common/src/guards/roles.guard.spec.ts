import { Logger, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { ErrorCode } from '../constants/error-codes.constant';
import { METRICS } from '../constants/metrics.constant';
import { Locale, Role, UserStatus } from '../constants/roles.constant';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AppException } from '../exceptions/app.exception';
import { ForbiddenException } from '../exceptions/forbidden.exception';
import { MetricsService } from '../metrics/metrics.service';

import { RolesGuard } from './roles.guard';

import type { ICurrentUser } from '../interfaces/current-user.interface';

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

interface HarnessOptions {
  roles?: Role[];
  isPublic?: boolean;
  user?: ICurrentUser;
  contextType?: string;
}

function createContext(options: HarnessOptions = {}): ExecutionContext {
  return {
    getType: <T>(): T => (options.contextType ?? 'http') as unknown as T,
    getHandler: () => function findOne(): void {},
    getClass: () => class GarmentController {},
    switchToHttp: () => ({
      getRequest: <T>(): T =>
        ({
          user: options.user,
          method: 'GET',
          route: { path: '/api/v1/garments/:id' },
        }) as unknown as T,
    }),
  } as unknown as ExecutionContext;
}

function createGuard(options: HarnessOptions, metrics?: MetricsService): RolesGuard {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === ROLES_KEY) {
        return options.roles;
      }
      if (key === IS_PUBLIC_KEY) {
        return options.isPublic;
      }
      return undefined;
    }),
  } as unknown as Reflector;
  return new RolesGuard(reflector, metrics);
}

function activate(options: HarnessOptions, metrics?: MetricsService): boolean {
  return createGuard(options, metrics).canActivate(createContext(options));
}

function errorCodeOf(options: HarnessOptions): ErrorCode | undefined {
  try {
    activate(options);
    return undefined;
  } catch (error) {
    return error instanceof AppException ? error.errorCode : undefined;
  }
}

describe('RolesGuard — fail closed', () => {
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('DENIES a route with neither @Public() nor @Roles()', () => {
    expect(() => activate({})).toThrow(ForbiddenException);
    expect(errorCodeOf({})).toBe(ErrorCode.INSUFFICIENT_ROLE);
  });

  it('denies even when a fully authenticated admin calls it', () => {
    expect(() => activate({ user: currentUser(Role.ADMIN) })).toThrow(ForbiddenException);
  });

  it('treats an empty @Roles() list as no contract at all', () => {
    expect(() => activate({ roles: [] })).toThrow(ForbiddenException);
  });

  it('logs loudly, at error level, naming the handler', () => {
    expect(() => activate({})).toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = String(errorSpy.mock.calls[0]?.[0]);
    expect(message).toContain('DENIED');
    expect(message).toContain('GarmentController.findOne');
    expect(message).toContain('/api/v1/garments/:id');
    expect(message).toContain('Failing closed');
  });

  it('counts the unguarded route so B-5 drift is visible in metrics', () => {
    const metrics = new MetricsService();
    expect(() => activate({}, metrics)).toThrow();
    expect(
      metrics.snapshot()?.series.some((entry) => entry.name === METRICS.AUTH_ROUTE_UNGUARDED),
    ).toBe(true);
  });

  it('works without a MetricsService injected', () => {
    expect(() => activate({})).toThrow(ForbiddenException);
  });

  /**
   * `@Public()` bypasses `SessionAuthGuard`. It says nothing about *who* may call the route,
   * so it is not an authorisation contract and cannot stand in for one.
   *
   * This used to log a warning and return **true**, which paired badly with the B-5 script:
   * that reported the same case as a non-fatal warning. So a `@Public()` with no `@Roles()` —
   * including one inherited from a class-level `@Public()` on an admin controller — was open
   * to anonymous callers *and* green in CI, with nothing louder than a warning in a log
   * nobody reads. Both ends now refuse it.
   */
  it('DENIES @Public() with no @Roles() — @Public() is not a role contract', () => {
    expect(() => activate({ isPublic: true })).toThrow(ForbiddenException);
    expect(errorCodeOf({ isPublic: true })).toBe(ErrorCode.INSUFFICIENT_ROLE);
  });

  it('says why, at error level, rather than warning and carrying on', () => {
    expect(() => activate({ isPublic: true })).toThrow();

    expect(warnSpy).not.toHaveBeenCalled();
    const message = String(errorSpy.mock.calls[0]?.[0]);
    expect(message).toContain('DENIED');
    expect(message).toContain('@Public()');
    expect(message).toContain('Failing closed');
  });

  it('still lets an explicit @Roles(Role.PUBLIC) through — that IS the contract', () => {
    expect(activate({ isPublic: true, roles: [Role.PUBLIC] })).toBe(true);
  });
});

describe('RolesGuard — authorisation', () => {
  it('lets anyone through a @Roles(Role.PUBLIC) route, signed in or not', () => {
    expect(activate({ roles: [Role.PUBLIC] })).toBe(true);
    expect(activate({ roles: [Role.PUBLIC], user: currentUser(Role.CONSUMER) })).toBe(true);
    expect(activate({ roles: [Role.PUBLIC], user: currentUser(Role.ADMIN) })).toBe(true);
  });

  it('admits a caller whose role is listed', () => {
    expect(activate({ roles: [Role.ADMIN], user: currentUser(Role.ADMIN) })).toBe(true);
    expect(activate({ roles: [Role.CONSUMER], user: currentUser(Role.CONSUMER) })).toBe(true);
    expect(activate({ roles: [Role.ADMIN, Role.CONSUMER], user: currentUser(Role.CONSUMER) })).toBe(
      true,
    );
  });

  it('refuses a consumer on an admin route', () => {
    expect(errorCodeOf({ roles: [Role.ADMIN], user: currentUser(Role.CONSUMER) })).toBe(
      ErrorCode.INSUFFICIENT_ROLE,
    );
  });

  it('refuses an admin on a consumer route — membership is exact, not hierarchical', () => {
    expect(errorCodeOf({ roles: [Role.CONSUMER], user: currentUser(Role.ADMIN) })).toBe(
      ErrorCode.INSUFFICIENT_ROLE,
    );
  });

  it('refuses an anonymous caller on a role-guarded route', () => {
    expect(errorCodeOf({ roles: [Role.CONSUMER] })).toBe(ErrorCode.INSUFFICIENT_ROLE);
  });

  it('returns 403 with the S-9 copy the web app renders as a no-access screen', () => {
    try {
      activate({ roles: [Role.ADMIN], user: currentUser(Role.CONSUMER) });
      throw new Error('expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as AppException).getStatus()).toBe(403);
      expect((error as AppException).message).toBe("You don't have access to this.");
    }
  });

  it('counts the refusal', () => {
    const metrics = new MetricsService();
    expect(() =>
      activate({ roles: [Role.ADMIN], user: currentUser(Role.CONSUMER) }, metrics),
    ).toThrow();

    const series = metrics.snapshot()?.series.find((entry) => entry.name === METRICS.AUTH_DENIED);
    expect(series?.tags).toMatchObject({ role: Role.CONSUMER });
  });

  it('tags an anonymous refusal as ANONYMOUS rather than dropping the tag', () => {
    const metrics = new MetricsService();
    expect(() => activate({ roles: [Role.ADMIN] }, metrics)).toThrow();

    const series = metrics.snapshot()?.series.find((entry) => entry.name === METRICS.AUTH_DENIED);
    expect(series?.tags).toMatchObject({ role: 'ANONYMOUS' });
  });

  it('ignores a non-HTTP context', () => {
    expect(activate({ contextType: 'rpc' })).toBe(true);
  });
});
