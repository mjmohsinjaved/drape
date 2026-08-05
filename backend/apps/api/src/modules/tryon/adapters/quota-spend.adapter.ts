import { Injectable } from '@nestjs/common';

import { BudgetService, GenerationSpendService, QuotaService } from '@api/modules/quota';
import type { BudgetSnapshot } from '@api/modules/quota';

import type {
  BudgetView,
  ChargeGenerationInput,
  QuotaPort,
  QuotaView,
  ReleaseGenerationInput,
} from '../ports/quota.port';

/**
 * The `QUOTA_PORT` binding — `quota` answers guard-chain steps 6 and 8, and takes the
 * one charge.
 *
 * Three services behind four verbs. The split matters: §2.4 puts the C-6 rate limits
 * *between* the quota check and the budget check, so the try-on guard chain calls the
 * two assertions separately rather than through `assertCanGenerate()`, which does both
 * back to back. Everything else — the lazy monthly grant, the `SERIALIZABLE` charge
 * across both ledgers, the A-29 threshold events — stays where it belongs, in `quota`.
 *
 * `chargeSuccess` discards its return value deliberately. The post-charge balances are
 * real and useful, but the generation path must not be able to *act* on them: the next
 * request derives its own from the ledger (§4.0 rule 10), and a balance carried
 * forward is a balance that can be stale.
 */
@Injectable()
export class QuotaSpendAdapter implements QuotaPort {
  constructor(
    private readonly quota: QuotaService,
    private readonly budget: BudgetService,
    private readonly spend: GenerationSpendService,
  ) {}

  async assertQuotaAvailable(userId: string): Promise<QuotaView> {
    const snapshot = await this.quota.assertQuotaAvailable(userId);
    return {
      period: snapshot.period,
      remaining: snapshot.remaining,
      limit: snapshot.limit,
      used: snapshot.used,
      resetsAt: snapshot.resetsAt,
    };
  }

  async assertBudgetAvailable(): Promise<BudgetView> {
    return toBudgetView(await this.budget.assertBudgetAvailable());
  }

  async budgetSnapshot(): Promise<BudgetView> {
    return toBudgetView(await this.budget.getSnapshot());
  }

  async chargeSuccess(input: ChargeGenerationInput): Promise<void> {
    await this.spend.chargeSuccess({
      jobId: input.jobId,
      userId: input.userId,
      origin: input.origin,
      actorId: input.actorId ?? null,
    });
  }

  /**
   * The compensating half of {@link chargeSuccess}.
   *
   * `GenerationSpendService.releaseOnFailure()` swallows its own errors and reports what it
   * reversed; the generation path has nothing useful to do with the report — it is already
   * unwinding a failure — so the return value is dropped here rather than given to a caller
   * that would be tempted to branch on it.
   */
  async releaseOnFailure(input: ReleaseGenerationInput): Promise<void> {
    await this.spend.releaseOnFailure({
      jobId: input.jobId,
      userId: input.userId,
      reason: input.reason,
    });
  }
}

function toBudgetView(snapshot: BudgetSnapshot): BudgetView {
  return {
    period: snapshot.period,
    limit: snapshot.limit,
    used: snapshot.used,
    remaining: snapshot.remaining,
    warnAt: snapshot.warnAt,
    hardStopAt: snapshot.hardStopAt,
    resetsAt: snapshot.resetsAt,
  };
}
