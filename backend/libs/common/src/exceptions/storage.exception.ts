import { AppException } from './app.exception';

/** `FILE_*`, `UPLOAD_*`, `STORAGE_*` — ARCHITECTURE.md §2.5. */
export class StorageException extends AppException {}
