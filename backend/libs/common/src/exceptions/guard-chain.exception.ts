import { AppException } from './app.exception';

/**
 * Every PRD §8.1 step-3 rejection — ARCHITECTURE.md §2.5.
 *
 * Guard-chain rejections happen **before any spend**: the first failure
 * short-circuits, increments `tryon.guard_rejected` tagged with the code, and
 * returns. No `tryon_jobs` row is written.
 */
export class GuardChainException extends AppException {}

/** `QUOTA_EXHAUSTED`, `BUDGET_EXHAUSTED`. */
export class QuotaException extends GuardChainException {}

/** `CONSENT_REQUIRED`, `CONSENT_STALE`. */
export class ConsentException extends GuardChainException {}

/**
 * `*_NOT_OWNED` — always masked by `GlobalExceptionFilter` before it reaches a
 * client (§2.4 masking rule). Throw the true code; the filter logs it and returns
 * the `*_NOT_FOUND` equivalent.
 */
export class OwnershipException extends GuardChainException {}
