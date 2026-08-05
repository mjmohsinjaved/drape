/**
 * The `quota` module's public surface.
 *
 * `TryOnModule` (W3) needs three calls and nothing else — the §8.4 contract, in order:
 *
 * ```typescript
 * await this.spend.assertCanGenerate(userId);                       // guard chain, reads only
 * // …cache lookup (C-22: a hit charges nothing), upstream, store the render…
 * await this.spend.chargeSuccess({ jobId, userId, origin: 'CONSUMER' });
 * // and, only for the narrow case where a step *after* the charge failed:
 * await this.spend.releaseOnFailure({ jobId, userId });
 * ```
 *
 * The ledger math is exported as pure functions because it is worth reusing and worth
 * testing on its own (E-5): `deriveQuotaBalance`, `deriveBudgetBalance`,
 * `budgetStateFor` and `crossedThreshold` decide nothing about the database and can be
 * exercised from an array literal.
 */
export { QuotaModule } from './quota.module';

export {
  QuotaService,
  type ConsumeQuotaInput,
  type QuotaRefundResult,
  type QuotaSnapshot,
  type RefundQuotaInput,
} from './services/quota.service';
export {
  BudgetService,
  type BudgetChargeResult,
  type BudgetRefundResult,
  type BudgetSnapshot,
  type ConsumeBudgetInput,
  type RefundBudgetInput,
  type UsageOverview,
} from './services/budget.service';
export {
  GenerationSpendService,
  type ChargeGenerationInput,
  type GenerationAllowance,
  type GenerationCharge,
  type GenerationOrigin,
  type GenerationRelease,
  type ReleaseGenerationInput,
} from './services/generation-spend.service';

export { QuotaLedgerEntry } from './entities/quota-ledger-entry.entity';
export { UsageLedgerEntry } from './entities/usage-ledger-entry.entity';
export { QuotaReason } from './enums/quota-reason.enum';
export { UsageReason } from './enums/usage-reason.enum';

export {
  QUOTA_EVENTS,
  type BudgetThresholdEvent,
  type ConsumerQuotaExhaustedEvent,
  type QuotaEventName,
  type QuotaOverrideGrantedEvent,
} from './events/quota.events';

export { QuotaLedgerEntryResponseDto, QuotaSnapshotResponseDto } from './dto/quota-response.dto';
export {
  AdminUsageResponseDto,
  BudgetSnapshotResponseDto,
  UsageLedgerEntryResponseDto,
} from './dto/usage-response.dto';
export {
  AdjustLedgerDto,
  MAX_ADJUSTMENT_NOTE_LENGTH,
  MAX_LEDGER_ADJUSTMENT,
  MIN_LEDGER_ADJUSTMENT,
} from './dto/adjust-ledger.dto';
export { ConsumerIdParamDto } from './dto/consumer-id-param.dto';
export { LEDGER_SORT_KEYS, LedgerQueryDto, type LedgerSortKey } from './dto/ledger-query.dto';

export {
  BUDGET_GRANT_REASONS,
  BUDGET_SPEND_REASONS,
  BUDGET_STATES,
  budgetStateFor,
  burnPercent,
  crossedThreshold,
  deriveBalance,
  deriveBudgetBalance,
  deriveQuotaBalance,
  projectBudgetExhaustion,
  QUOTA_GRANT_REASONS,
  QUOTA_SPEND_REASONS,
  sumDeltas,
  trailingDailyRate,
  TRAILING_WINDOW_DAYS,
  type BudgetProjection,
  type BudgetProjectionInput,
  type BudgetState,
  type BudgetThresholds,
  type LedgerBalance,
  type LedgerRow,
} from './utils/ledger-math';
