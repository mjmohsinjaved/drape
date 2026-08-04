import { AppException } from './app.exception';

/** `UPSTREAM_*`, `MODERATION_REJECTED` — ARCHITECTURE.md §2.5. */
export class UpstreamException extends AppException {}
