/**
 * Typed throw sites for `@library/storage`.
 *
 * ARCHITECTURE.md §2.5 fixes the exception hierarchy in `@library/common`; the HTTP status and the
 * default user-facing message always come from `ERROR_CODE_SPECS` (§2.4). This file therefore adds
 * no second source of truth — it only names the storage-owned error paths so a throw site reads as
 * intent and a test can assert on `errorCode`.
 *
 * Nothing here ever puts a raw storage key, an absolute path or a token into `details`: §3.4 says a
 * storage key must never cross the network boundary, and §8.1 forbids it in logs too. The raw key is
 * logged at `warn` by the driver and nowhere else.
 */
import { ErrorCode, StorageException, ValidationException } from '@library/common';

/**
 * Boot-time misconfiguration of the storage library.
 *
 * Thrown before Nest is created and therefore before `GlobalExceptionFilter` exists, so it is a
 * plain `Error` rather than an `AppException`: the process must fail to start, not answer a request.
 */
export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigError';
  }
}

/** §3.2 requirement 2/3 — the key escaped the root, or failed key validation. */
export const storagePathRejected = (): StorageException =>
  new StorageException(ErrorCode.STORAGE_PATH_REJECTED);

/** §3.2 — a write could not be completed, or would have overwritten with `failIfExists`. */
export const storageWriteFailed = (cause?: unknown): StorageException =>
  new StorageException(ErrorCode.STORAGE_WRITE_FAILED, { cause });

export const fileNotFound = (): StorageException => new StorageException(ErrorCode.FILE_NOT_FOUND);

/** §3.4 step 1/2 — malformed token or HMAC mismatch. Deliberately indistinguishable to the client. */
export const fileTokenInvalid = (cause?: unknown): StorageException =>
  new StorageException(ErrorCode.FILE_TOKEN_INVALID, { cause });

/** §3.4 step 3 — `exp` is in the past. */
export const fileTokenExpired = (): StorageException =>
  new StorageException(ErrorCode.FILE_TOKEN_EXPIRED);

/** §3.4 step 4 / PRD §9.2 — the token was issued for another account. */
export const fileTokenSubjectMismatch = (): StorageException =>
  new StorageException(ErrorCode.FILE_TOKEN_SUBJECT_MISMATCH);

/** §3.5 — upload ticket malformed, wrong domain separator, or HMAC mismatch. */
export const uploadTicketInvalid = (cause?: unknown): StorageException =>
  new StorageException(ErrorCode.UPLOAD_TICKET_INVALID, { cause });

export const uploadTicketExpired = (): StorageException =>
  new StorageException(ErrorCode.UPLOAD_TICKET_EXPIRED);

/** §3.2 requirement 9 — magic bytes did not match the declared content type, or are not accepted. */
export const imageFormatUnsupported = (details?: Record<string, unknown>): ValidationException =>
  new ValidationException(ErrorCode.IMAGE_FORMAT_UNSUPPORTED, { details });

/** §3.5 — the redeemed stream exceeded `maxBytes`. */
export const imageTooLarge = (maxMb: number): ValidationException =>
  new ValidationException(ErrorCode.IMAGE_TOO_LARGE, { details: { maxMb } });

/** `sharp` could not decode the bytes. */
export const imageCorrupt = (cause?: unknown): ValidationException =>
  new ValidationException(ErrorCode.IMAGE_CORRUPT, { cause });
