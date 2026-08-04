import { AppException } from './app.exception';

/** `INSUFFICIENT_ROLE`, `*_DISABLED`, `IP_BLOCKED` — ARCHITECTURE.md §2.5. */
export class ForbiddenException extends AppException {}
