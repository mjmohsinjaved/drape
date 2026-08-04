import { AppException } from './app.exception';

/** `VALIDATION_ERROR`, `*_INVALID`, `IMAGE_*` — ARCHITECTURE.md §2.5. */
export class ValidationException extends AppException {}
