/** `auth_outcome_enum` (ARCHITECTURE §4.1). */
export enum AuthOutcome {
  SUCCESS = 'SUCCESS',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  LOCKED = 'LOCKED',
  /**
   * **Historical only — nothing writes this any more.**
   *
   * Two-factor sign-in was removed, but `auth_attempts` is append-only and rows
   * already recorded still carry this value. Dropping it from the PostgreSQL enum
   * would mean rewriting those rows to something they never were, so the value stays
   * and the ledger stays honest.
   */
  TWOFA_FAILED = 'TWOFA_FAILED',
  RATE_LIMITED = 'RATE_LIMITED',
  SUSPENDED = 'SUSPENDED',
}
