import {
  Injectable,
  Logger,
  Optional,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ErrorCode } from '../constants/error-codes.constant';
import { METRICS } from '../constants/metrics.constant';
import { Role, satisfiesRoles } from '../constants/roles.constant';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ForbiddenException } from '../exceptions/forbidden.exception';
import { MetricsService } from '../metrics/metrics.service';

import type { ICurrentUser } from '../interfaces/current-user.interface';

interface RoleCheckedRequest {
  user?: ICurrentUser;
  method?: string;
  route?: { path?: string };
  path?: string;
}

/**
 * Role authorisation — ARCHITECTURE.md §2.7, guard **4** of 4.
 *
 * Reads `@Roles()`. `Role.PUBLIC` always passes; otherwise the session role must
 * appear in the list. Membership is exact — an `ADMIN` does not implicitly satisfy
 * a `@Roles(Role.CONSUMER)` handler, because a consumer-scoped route is scoped by
 * `userId` and an admin has no row there (S-10).
 *
 * ### Fail closed
 *
 * A handler that declares **neither** `@Public()` **nor** `@Roles()` is denied and
 * logged at `error`. B-5's `scripts/check-route-guards.ts` is supposed to catch this
 * in CI; this is the runtime backstop, and it must be loud, because a silent pass
 * would be an unauthenticated hole in the API.
 *
 * Object-level ownership is **not** checked here. The guard chain authorises the
 * route; the service authorises the row (§9.2).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType<string>() !== 'http') {
      return true;
    }

    const allowedRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isPublic =
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;

    const request = context.switchToHttp().getRequest<RoleCheckedRequest>();
    const route = describeRoute(context, request);

    if (allowedRoles === undefined || allowedRoles.length === 0) {
      if (isPublic) {
        // Tolerated but wrong: §2.6 requires @Public() routes to also declare
        // @Roles(Role.PUBLIC) so the B-5 check can see the contract.
        this.logger.warn(
          `Route ${route} is @Public() but declares no @Roles(). ` +
            'Add @Roles(Role.PUBLIC) — B-5 requires an explicit contract on every handler.',
        );
        return true;
      }

      this.logger.error(
        `DENIED: route ${route} declares neither @Public() nor @Roles(). ` +
          'Every route handler must carry exactly one @Roles() (ARCHITECTURE.md §2.6, B-5). ' +
          'Failing closed.',
      );
      this.metrics?.increment(METRICS.AUTH_ROUTE_UNGUARDED, { route });
      throw new ForbiddenException(ErrorCode.INSUFFICIENT_ROLE);
    }

    const user = request.user;

    if (satisfiesRoles(user?.role, allowedRoles)) {
      return true;
    }

    this.metrics?.increment(METRICS.AUTH_DENIED, { route, role: user?.role ?? 'ANONYMOUS' });
    throw new ForbiddenException(ErrorCode.INSUFFICIENT_ROLE);
  }
}

function describeRoute(context: ExecutionContext, request: RoleCheckedRequest): string {
  const method = (request.method ?? 'UNKNOWN').toUpperCase();
  const path = request.route?.path ?? request.path ?? '';
  const handler = `${context.getClass().name}.${context.getHandler().name}`;
  return path === '' ? `${method} (${handler})` : `${method} ${path} (${handler})`;
}
