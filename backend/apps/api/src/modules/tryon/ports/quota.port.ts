/**
 * DI token for {@link QuotaPort}.
 *
 * Bound in `TryOnModule` to an adapter over `QuotaService`, `BudgetService` and
 * `GenerationSpendService`. The token exists rather than injecting those three
 * directly so the generation path sees four verbs instead of a ledger API — and so the
 * one method that spends money is a single, greppable name.
 */
export const QUOTA_PORT = Symbol('QUOTA_PORT');

/** A consumer's monthly position, as the guard chain needs to see it. */
export interface QuotaView {
  /** `YYYY-MM` in `Asia/Karachi` (§4.26). */
  readonly period: string;
  /** Derived — `SUM(delta)`. **Never** read from a stored balance column (§4.0/10). */
  readonly remaining: number;
  /** Sum of the granting rows. */
  readonly limit: number;
  /** Absolute sum of the spending rows. */
  readonly used: number;
  readonly resetsAt: Date;
}

/** The platform's monthly position (§4.27, A-29). */
export interface BudgetView {
  readonly period: string;
  /** `settings['budget.monthlyGenerations']`. */
  readonly limit: number;
  readonly used: number;
  readonly remaining: number;
  /** `settings['budget.warnThresholdPercent']` of the limit (A-29). */
  readonly warnAt: number;
  /** The hard stop. Consumption at or above it refuses (§8.3). */
  readonly hardStopAt: number;
  readonly resetsAt: Date;
}

/** One successful generation's charge. Called from the `SUCCEEDED` branch and nowhere else. */
export interface ChargeGenerationInput {
  /** `tryon_jobs.id`. Unique in both ledgers, which is what stops a double charge. */
  readonly jobId: string;
  /** The consumer. `null` for a test render that is charged to nobody's quota. */
  readonly userId: string | null;
  /**
   * §8.4: admin test renders are tracked **separately** from consumer demand. A
   * `TEST_RENDER` burns platform budget under its own reason and consumes **no**
   * consumer quota, which is what lets A-33 split the burn-rate chart honestly.
   */
  readonly origin: 'CONSUMER' | 'TEST_RENDER';
  /** The admin who ran a test render (A-33). */
  readonly actorId?: string | null;
}

/** A charge that must not stand, because the generation it paid for did not survive. */
export interface ReleaseGenerationInput {
  readonly jobId: string;
  /** The consumer whose quota was charged. `null` for a test render. */
  readonly userId: string | null;
  /** Written into the compensating rows' note, so the A-18 ledger view reads. */
  readonly reason?: string;
}

/**
 * The seam between `tryon` and `quota` — guard-chain steps 6 and 8, and the one spend.
 *
 * ### The rule this interface exists to make hard to break
 *
 * **Failed jobs never consume quota or budget** (PRD §8.3). {@link chargeSuccess} is
 * called from exactly one place — the `SUCCEEDED` branch of `TryOnRunnerService` — and
 * no other method here writes a ledger row. A cache hit does not call it either
 * (C-22, §8.4): the render is copied, the cache row's `hitCount` is incremented, and
 * nothing is spent.
 *
 * ### Why quota and budget are checked separately
 *
 * `GenerationSpendService.assertCanGenerate()` checks both back to back, which is the
 * right shape for a caller that has no other guards. This one does: §2.4 fixes the
 * order as quota (6) → **rate limits (7)** → budget (8), and which of two simultaneous
 * failures a consumer sees decides which screen she lands on. So the port exposes the
 * two assertions separately and `TryOnGuardService` interleaves the C-6 ceilings where
 * the specification puts them.
 *
 * ### `budgetSnapshot` reads without refusing
 *
 * The A-12 cost estimate has to show remaining budget *including* when it is exhausted
 * — an admin planning a batch needs the number, not an exception.
 */
export interface QuotaPort {
  /**
   * Guard-chain step 6. Lazily grants the month's allowance on first read (§4.26).
   *
   * @throws `QUOTA_EXHAUSTED`
   */
  assertQuotaAvailable(userId: string): Promise<QuotaView>;

  /**
   * Guard-chain step 8. Platform-wide, not per user.
   *
   * @throws `BUDGET_EXHAUSTED`
   */
  assertBudgetAvailable(): Promise<BudgetView>;

  /** The same numbers without the refusal — the A-12 estimate and the E-13 gauges. */
  budgetSnapshot(): Promise<BudgetView>;

  /**
   * Appends the consuming rows for one **successful** generation, both ledgers, one
   * transaction.
   *
   * Idempotent by construction: `UQ_quota_ledger_job` and `UQ_usage_ledger_job` mean a
   * second call for the same `jobId` cannot double-charge, whatever races to get here.
   */
  chargeSuccess(input: ChargeGenerationInput): Promise<void>;

  /**
   * Reverses a charge whose generation did not survive to be delivered.
   *
   * **A no-op on every ordinary failure**, because §8.4 charges only after the bytes
   * exist and nothing before that point has written a ledger row. It exists for the one
   * window that is genuinely reachable: the charge committed and a *later* step — writing
   * the `tryon_results` row, remembering the cache entry — then failed. Without it the
   * consumer keeps a decrement for a render that no longer exists, which is the mirror
   * image of the bug §8.3 is written against.
   *
   * Idempotent: calling it twice for the same job reverses once. Never throws — it runs
   * while something has already gone wrong, and a failing refund must not replace the real
   * error with its own.
   */
  releaseOnFailure(input: ReleaseGenerationInput): Promise<void>;
}
