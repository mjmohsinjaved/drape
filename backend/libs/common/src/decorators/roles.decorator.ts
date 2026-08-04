import { SetMetadata, type CustomDecorator } from '@nestjs/common';

import { type Role } from '../constants/roles.constant';

/** Metadata key read by `RolesGuard`. */
export const ROLES_KEY = 'roles';

/**
 * The route's authorisation contract — ARCHITECTURE.md §2.6.
 *
 * **Every route handler carries exactly one.** `scripts/check-route-guards.ts` walks
 * the route table and fails CI on any handler without it (B-5), and `RolesGuard`
 * fails closed at runtime on a handler that has neither this nor `@Public()`.
 *
 * `Role.PUBLIC` opens the route to everyone; any other list is exact membership,
 * with no hierarchy widening.
 */
export const Roles = (...roles: Role[]): CustomDecorator<string> => SetMetadata(ROLES_KEY, roles);
