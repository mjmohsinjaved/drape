import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/** Metadata key read by `CsrfGuard`. */
export const SKIP_CSRF_KEY = 'skipCsrf';

/**
 * Bypasses `CsrfGuard` — ARCHITECTURE.md §2.6.
 *
 * Permitted on exactly two routes — `POST /api/v1/auth/login` and
 * `POST /api/v1/auth/signup` — because no session-bound CSRF secret exists yet.
 * **Every use carries a comment naming the reason.** A third use is a review failure.
 */
export const SkipCsrf = (): CustomDecorator<string> => SetMetadata(SKIP_CSRF_KEY, true);
