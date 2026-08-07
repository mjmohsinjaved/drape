import { AppException } from './app.exception';

/**
 * `AUTH_*`, `SESSION_*`, `CSRF_*` — ARCHITECTURE.md §2.5.
 *
 * Subclasses exist to make intent readable at the throw site and to let tests
 * assert on class. They fix the code family; they never change the status, which
 * always comes from `ERROR_CODE_SPECS`.
 */
export class AuthException extends AppException {}
