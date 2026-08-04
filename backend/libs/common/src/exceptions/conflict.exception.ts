import { AppException } from './app.exception';

/** `*_EXISTS`, `INVALID_*_TRANSITION`, `IDEMPOTENCY_IN_FLIGHT` — ARCHITECTURE.md §2.5. */
export class ConflictException extends AppException {}
