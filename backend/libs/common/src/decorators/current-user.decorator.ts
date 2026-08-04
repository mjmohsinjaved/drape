import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { ICurrentUser, RequestWithUser } from '../interfaces/current-user.interface';

/**
 * The authenticated caller, or one property of it — ARCHITECTURE.md §2.6.
 *
 * ```typescript
 * findMine(@CurrentUser() user: ICurrentUser) { … }
 * findMine(@CurrentUser('id') userId: string) { … }
 * ```
 *
 * Returns `undefined` on `@Public()` routes with no session. The value comes from
 * `request.user`, which **only** `SessionAuthGuard` writes — never a header, query
 * parameter, body field or any other client-supplied claim (S-3).
 */
export const CurrentUser = createParamDecorator(
  (
    property: keyof ICurrentUser | undefined,
    context: ExecutionContext,
  ): ICurrentUser | ICurrentUser[keyof ICurrentUser] | undefined => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (user === undefined) {
      return undefined;
    }
    return property === undefined ? user : user[property];
  },
);
