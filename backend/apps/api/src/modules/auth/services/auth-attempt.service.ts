import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { MoreThanOrEqual, Repository } from 'typeorm';

import { AuthException, ErrorCode, sha256EmailHex } from '@library/common';

import { LOCKOUT_WINDOW_MINUTES, type AuthRoute } from '../auth.constants';
import { AuthAttempt } from '../entities/auth-attempt.entity';
import { AuthOutcome } from '../enums/auth-outcome.enum';

/**
 * Outcomes that count towards the S-6 lockout. A rate-limit rejection is not a guess.
 *
 * `TWOFA_FAILED` is still listed although nothing writes it any more: the ledger is
 * append-only, so rows recorded before two-factor sign-in was removed are still inside
 * the fifteen-minute window on the day of the deploy, and they were failures then.
 */
const FAILURE_OUTCOMES: ReadonlySet<AuthOutcome> = new Set([
  AuthOutcome.INVALID_CREDENTIALS,
  AuthOutcome.TWOFA_FAILED,
]);

const MINUTE_MS = 60_000;

export interface RecordAttemptInput {
  /** The raw address. Only its sha256 is stored — §4.7 keeps the address out (E-12). */
  readonly email: string;
  readonly userId: string | null;
  readonly ip: string;
  readonly userAgent: string | null;
  readonly outcome: AuthOutcome;
  readonly route: AuthRoute;
}

export interface LockoutState {
  readonly locked: boolean;
  readonly failureCount: number;
  readonly retryAfterSeconds: number;
  readonly lockedUntil: Date | null;
}

/**
 * Exponential backoff — PRD S-6, ARCHITECTURE §4.7.
 *
 * "Lockout after 5 failures inside 15 minutes, `lockedUntil = now + 2^(n-5)`
 * minutes capped at 60."
 *
 * So the fifth failure costs one minute, the sixth two, the seventh four, and by the
 * eleventh the cap has been reached. Below the threshold there is no lockout at all.
 *
 * Pure and exported so the arithmetic can be asserted directly, which is where the
 * off-by-one in a backoff formula always hides.
 */
export function lockoutBackoffMinutes(
  failureCount: number,
  threshold: number,
  maxMinutes: number,
): number {
  if (!Number.isFinite(failureCount) || failureCount < threshold) {
    return 0;
  }
  const doublings = failureCount - threshold;
  // 2 ** a large number is Infinity, which `Math.min` clamps to the ceiling anyway.
  return Math.min(2 ** doublings, maxMinutes);
}

/**
 * Counts consecutive failures, newest first, stopping at the first success.
 *
 * `auth_attempts` is append-only (§2.1), so a successful sign-in cannot delete the
 * failures before it — it ends the run instead. Without this, one wrong password
 * would keep counting against an account for the next fifteen minutes even after the
 * owner signed in correctly.
 */
export function countConsecutiveFailures(
  attempts: readonly Pick<AuthAttempt, 'outcome'>[],
): number {
  let failures = 0;
  for (const attempt of attempts) {
    if (attempt.outcome === AuthOutcome.SUCCESS) {
      break;
    }
    if (FAILURE_OUTCOMES.has(attempt.outcome)) {
      failures += 1;
    }
  }
  return failures;
}

/**
 * The append-only record of every authentication attempt — ARCHITECTURE §4.7.
 *
 * Two independent counters, exactly as S-6 requires: one keyed by `emailHash`, one
 * keyed by `ip`. An attacker spraying one password across many accounts is caught by
 * the IP counter; an attacker rotating addresses against one account is caught by
 * the email counter. Whichever is further along decides the wait.
 *
 * Rows are INSERTed and read. Nothing here updates or deletes (§2.1).
 */
@Injectable()
export class AuthAttemptService {
  constructor(
    @InjectRepository(AuthAttempt)
    private readonly attempts: Repository<AuthAttempt>,
  ) {}

  /** Appends one attempt. Never throws into the caller's path — see `AuthService`. */
  async record(input: RecordAttemptInput): Promise<void> {
    const row = this.attempts.create({
      emailHash: sha256EmailHex(input.email),
      userId: input.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      outcome: input.outcome,
      route: input.route,
    });
    await this.attempts.save(row);
  }

  /**
   * The current lockout state for an (email, ip) pair.
   *
   * Both counters are evaluated over the same 15-minute window and the harsher of
   * the two wins.
   */
  async getLockoutState(
    email: string,
    ip: string,
    now: Date,
    threshold: number,
    maxMinutes: number,
  ): Promise<LockoutState> {
    const windowStart = new Date(now.getTime() - LOCKOUT_WINDOW_MINUTES * MINUTE_MS);

    const [byEmail, byIp] = await Promise.all([
      this.attempts.find({
        where: { emailHash: sha256EmailHex(email), createdAt: MoreThanOrEqual(windowStart) },
        order: { createdAt: 'DESC' },
      }),
      this.attempts.find({
        where: { ip, createdAt: MoreThanOrEqual(windowStart) },
        order: { createdAt: 'DESC' },
      }),
    ]);

    const emailState = evaluate(byEmail, now, threshold, maxMinutes);
    const ipState = evaluate(byIp, now, threshold, maxMinutes);

    return emailState.retryAfterSeconds >= ipState.retryAfterSeconds ? emailState : ipState;
  }

  /**
   * Throws when the caller is locked out.
   *
   * @throws {AuthException} `ACCOUNT_LOCKED` (423) with `details.retryAfterSeconds`.
   * The copy is identical whether the account exists or not (S-6).
   */
  async assertNotLockedOut(
    email: string,
    ip: string,
    now: Date,
    threshold: number,
    maxMinutes: number,
  ): Promise<void> {
    const state = await this.getLockoutState(email, ip, now, threshold, maxMinutes);
    if (state.locked) {
      throw new AuthException(ErrorCode.ACCOUNT_LOCKED, {
        details: { retryAfterSeconds: state.retryAfterSeconds },
      });
    }
  }
}

function evaluate(
  rows: readonly AuthAttempt[],
  now: Date,
  threshold: number,
  maxMinutes: number,
): LockoutState {
  const failureCount = countConsecutiveFailures(rows);
  const minutes = lockoutBackoffMinutes(failureCount, threshold, maxMinutes);

  if (minutes === 0 || rows.length === 0) {
    return { locked: false, failureCount, retryAfterSeconds: 0, lockedUntil: null };
  }

  // The clock starts at the most recent failure, not at the first one in the window.
  const lockedUntil = new Date(rows[0].createdAt.getTime() + minutes * MINUTE_MS);
  const remainingMs = lockedUntil.getTime() - now.getTime();

  if (remainingMs <= 0) {
    return { locked: false, failureCount, retryAfterSeconds: 0, lockedUntil };
  }

  return {
    locked: true,
    failureCount,
    retryAfterSeconds: Math.ceil(remainingMs / 1000),
    lockedUntil,
  };
}
