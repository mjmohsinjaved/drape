import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/** Metadata key read by `SessionAuthGuard` and `RolesGuard`. */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Bypasses `SessionAuthGuard` — ARCHITECTURE.md §2.6.
 *
 * Does **not** bypass CSRF or throttling. A `@Public()` route must still declare
 * `@Roles(Role.PUBLIC)` so the B-5 route-guard check passes, and must carry an
 * explicit `@Throttle()`.
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
