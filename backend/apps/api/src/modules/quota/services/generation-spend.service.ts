import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, type EntityManager } from 'typeorm';

import { runInTransaction } from '@library/database';

import { UsageReason } from '../enums/usage-reason.enum';
import { isSerializationFailure } from '../utils/postgres-errors';

import { BudgetService, type BudgetChargeResult, type BudgetSnapshot } from './budget.service';
import { QuotaService, type QuotaSnapshot } from './quota.service';

/** Who is generating, and therefore which ledgers move (A-33, §8.4). */
export type GenerationOrigin = 'CONSUMER' | 'TEST_RENDER';

/** The result of the §8.1 step-3 spend checks. Reading it changes nothing. */
export interface GenerationAllowance {
  readonly period: string;
  /** `null` for an admin test render — it is not charged to anybody's quota. */
  readonly quota: QuotaSnapshot | null;
  readonly budget: BudgetSnapshot;
}

export interface ChargeGenerationInput {
  /** The `tryon_jobs` row. Unique in both ledgers, which is what stops a double charge. */
  readonly jobId: string;
  readonly origin: GenerationOrigin;
  /** The consumer. Required for `CONSUMER`; the owning account, or `null`, for a test render. */
  readonly userId: string | null;
  /** The admin who ran a test render (A-33). */
  readonly actorId?: string | null;
  /** `YYYY-MM`. Defaults to the current period — pass the job's own for a boundary-straddling job. */
  readonly period?: string;
  readonly note?: string | null;
}

export interface GenerationCharge {
  readonly period: string;
  readonly quota: QuotaSnapshot | null;
  readonly budget: BudgetSnapshot;
}

export interface ReleaseGenerationInput {
  readonly jobId: string;
  readonly userId: string | null;
  readonly reason?: string;
}

export interface GenerationRelease {
  /** true only when a charge actually existed and was reversed. */
  readonly quotaRefunded: boolean;
  readonly budgetRefunded: boolean;
}

/**
 * PRD §8.4 · ARCHITECTURE §5.16 — the three calls `modules/tryon` makes about money.
 *
 * ### Why this class exists rather than two injected services
 *
 * "Quota and budget decrement only on success" (§8.4) is a promise about *both*
 * ledgers, and a successful generation charges each of them exactly once. Two separate
 * calls from the try-on service could not make that atomic: a process that died
 * between them would leave a consumer charged and the platform not, or the reverse,
 * with no way to tell afterwards which had happened. One method, one transaction,
 * both inserts — or neither.
 *
 * It also gives the try-on module exactly three verbs to remember, in an order it
 * cannot get wrong:
 *
 * ```typescript
 * await this.spend.assertCanGenerate(userId);          // guard chain — reads only
 * // …cache lookup, then upstream, then store the render…
 * await this.spend.chargeSuccess({ jobId, userId, origin: 'CONSUMER' });
 * ```
 *
 * ### The failure path charges nothing, by construction
 *
 * There is no "charge, then refund if it fails" anywhere in this design. The charge
 * happens *after* a render exists, so a job that fails at any point before that — no
 * garment detected, moderation rejection, timeout, upstream 5xx, a cache hit (C-22) —
 * never reaches {@link chargeSuccess} and there is nothing to undo. §8.3 puts it
 * plainly: "Failed jobs never consume quota or budget."
 *
 * {@link releaseOnFailure} therefore exists for one narrow case: the charge committed
 * and something *after* it failed. On every ordinary failure it finds no charge and
 * does nothing, and the spec beside this file asserts exactly that — a failed
 * generation that calls it leaves both ledgers with the same number of rows they
 * started with.
 *
 * ### Guard order
 *
 * Quota before budget, matching the §8.1 step-3 order in `ERROR_CODE_SPECS`. It is the
 * kinder order as well as the specified one: "you've used your try-ons this month" is
 * about her and is actionable, while "our fitting room is at capacity" is about us and
 * is not — and a consumer who is out of quota anyway should not be told the platform's
 * problems instead of her own.
 */
@Injectable()
export class GenerationSpendService {
  private readonly logger = new Logger(GenerationSpendService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly quota: QuotaService,
    private readonly budget: BudgetService,
  ) {}

  /**
   * §8.1 step 3 — the quota and budget gates. **Reads only; spends nothing.**
   *
   * Safe to call twice, safe to call and then abandon the request. The answer is a
   * snapshot of a moment and is deliberately not carried forward into the charge:
   * {@link chargeSuccess} re-derives both balances inside its own transaction, because
   * seconds pass between the guard and the render and a balance is not a reservation.
   */
  async assertCanGenerate(
    userId: string | null,
    origin: GenerationOrigin = 'CONSUMER',
    now: Date = new Date(),
  ): Promise<GenerationAllowance> {
    const quota =
      origin === 'CONSUMER' && userId !== null
        ? await this.quota.assertQuotaAvailable(userId, now)
        : null;

    const budget = await this.budget.assertBudgetAvailable(now);

    return { period: budget.period, quota, budget };
  }

  /**
   * Charges one generation to the consumer's quota **and** the platform budget, in a
   * single `SERIALIZABLE` transaction (§8.4, §2.9 rule 3).
   *
   * Both balances are re-derived inside the transaction. Two requests racing at
   * `remaining = 1` cannot both commit: PostgreSQL aborts one with `40001` and the
   * retry sees the winner's row and is refused with `QUOTA_EXHAUSTED`. The unique
   * `jobId` indexes on both ledgers are the second line — a job that somehow reached
   * this method twice fails on the constraint rather than being billed twice.
   *
   * Events are emitted after the commit, never inside the work callback.
   *
   * @throws `QUOTA_EXHAUSTED` / `BUDGET_EXHAUSTED` — nothing is written in either case
   */
  async chargeSuccess(input: ChargeGenerationInput): Promise<GenerationCharge> {
    const period = input.period ?? this.quota.periodFor();
    const chargesQuota = input.origin === 'CONSUMER' && input.userId !== null;

    const outcome = await this.runSerializable(
      'quota.charge-success',
      async (manager: EntityManager) => {
        const quota =
          chargesQuota && input.userId !== null
            ? await this.quota.consumeWithin(manager, {
                userId: input.userId,
                jobId: input.jobId,
                period,
                note: input.note ?? null,
              })
            : null;

        const budget = await this.budget.consumeWithin(manager, {
          jobId: input.jobId,
          period,
          reason:
            input.origin === 'CONSUMER' ? UsageReason.CONSUMER_GENERATION : UsageReason.TEST_RENDER,
          userId: input.userId,
          actorId: input.actorId ?? null,
          note: input.note ?? null,
        });

        return { quota, budget };
      },
    );

    this.emitAfterCommit(outcome.quota, outcome.budget);

    return { period, quota: outcome.quota, budget: outcome.budget.after };
  }

  /**
   * Reverses a charge that should not stand. **A no-op on the ordinary failure path.**
   *
   * Safe to call unconditionally from a `catch` or a `finally`: when no charge exists
   * — which is every failure that happened before {@link chargeSuccess} — it writes
   * nothing and reports `{ quotaRefunded: false, budgetRefunded: false }`.
   *
   * Never throws. It is called while something has already gone wrong, and a refund
   * that fails must not replace the real error with its own.
   */
  async releaseOnFailure(input: ReleaseGenerationInput): Promise<GenerationRelease> {
    try {
      return await this.runSerializable('quota.release-on-failure', async (manager) => {
        const quota =
          input.userId === null
            ? null
            : await this.quota.refundWithin(manager, {
                userId: input.userId,
                jobId: input.jobId,
                reason: input.reason,
              });

        const budget = await this.budget.refundWithin(manager, {
          jobId: input.jobId,
          reason: input.reason,
        });

        return {
          quotaRefunded: quota?.refunded ?? false,
          budgetRefunded: budget.refunded,
        };
      });
    } catch {
      this.logger.error(
        `Could not release the spend for job ${input.jobId}. The ledgers may hold a charge ` +
          'for a generation that failed; reconcile from /admin/usage/ledger.',
      );
      return { quotaRefunded: false, budgetRefunded: false };
    }
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /** §2.9 rule 3 — emitted after `commitTransaction()`, never from inside the work. */
  private emitAfterCommit(quota: QuotaSnapshot | null, budget: BudgetChargeResult): void {
    if (quota !== null) {
      this.quota.emitExhaustionIfSpent(quota);
    }
    this.budget.emitThresholdEvents(budget);
  }

  /** One `SERIALIZABLE` retry — see `QuotaService.runSerializable` for the reasoning. */
  private async runSerializable<T>(
    label: string,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    try {
      return await runInTransaction(this.dataSource, work, {
        isolationLevel: 'SERIALIZABLE',
        label,
      });
    } catch (error) {
      if (!isSerializationFailure(error)) {
        throw error;
      }
      this.logger.debug(`Serialization failure in "${label}"; retrying once.`);
      return runInTransaction(this.dataSource, work, {
        isolationLevel: 'SERIALIZABLE',
        label: `${label}.retry`,
      });
    }
  }
}
