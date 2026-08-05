import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { DataSource, In, Repository, type EntityManager } from 'typeorm';

import {
  currentPeriod,
  DEFAULT_BILLING_TIME_ZONE,
  ErrorCode,
  METRICS,
  MetricsService,
  MILLISECONDS_PER_DAY,
  paginate,
  paginationSkip,
  periodResetsAt,
  QuotaException,
  ValidationException,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';
import { runInTransaction } from '@library/database';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { SettingsService } from '@api/modules/settings';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import { MAX_LEDGER_ADJUSTMENT } from '../dto/adjust-ledger.dto';
import { UsageLedgerEntry } from '../entities/usage-ledger-entry.entity';
import { UsageReason } from '../enums/usage-reason.enum';
import { QUOTA_EVENTS, type BudgetThresholdEvent } from '../events/quota.events';
import { toAdminUsage, toBudgetSnapshot, toUsageLedgerEntry } from '../mappers/quota.mapper';
import {
  BUDGET_GRANT_REASONS,
  BUDGET_SPEND_REASONS,
  BUDGET_STATES,
  TRAILING_WINDOW_DAYS,
  budgetStateFor,
  burnPercent,
  crossedThreshold,
  projectBudgetExhaustion,
  sumDeltas as sumLedgerDeltas,
  trailingDailyRate as trailingDailyRateOf,
  type BudgetState,
  type BudgetThresholds,
  type LedgerRow,
} from '../utils/ledger-math';
import { isSerializationFailure } from '../utils/postgres-errors';

import type { AdjustLedgerDto } from '../dto/adjust-ledger.dto';
import type { LedgerQueryDto } from '../dto/ledger-query.dto';
import type {
  AdminUsageResponseDto,
  BudgetSnapshotResponseDto,
  UsageLedgerEntryResponseDto,
} from '../dto/usage-response.dto';

const GENERATION_COST = 1;

/**
 * One period's `usage_ledger`, folded to one row per reason — **the result of a single scan.**
 *
 * Every derived number this service reports (`remaining`, `limit`, `used`, the A-33 splits, the
 * trailing burn) is a sum over a subset of the same rows, so asking the database for them
 * separately meant three to four growing scans of an append-only table on a path the guard chain
 * walks for *every* generation (PRD §9.1: p95 cache hit under 400 ms). `GROUP BY reason` with a
 * conditional aggregate for the trailing window answers all of them in one pass, and the
 * arithmetic that turns the grouped rows into a snapshot is the same pure `ledger-math` used by
 * the unit tests — so collapsing the queries did not move the derivation anywhere new.
 *
 * The derived-balance rule (§4.0 rule 10) is untouched: `remaining` is still `SUM(delta)` over
 * every row of the period and there is still no stored balance column.
 */
interface PeriodTotals {
  /** One `{ delta, reason, period }` per distinct reason present — a `ledger-math` input. */
  readonly byReason: readonly LedgerRow<UsageReason>[];
  /** The same rows restricted to the trailing window, from the conditional aggregate. */
  readonly trailingByReason: readonly LedgerRow<UsageReason>[];
}

interface RawPeriodTotalsRow {
  reason: UsageReason;
  delta: string | number | null;
  trailingDelta: string | number | null;
}

function toNumber(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}

/** The derived platform position for a period (A-29, §4.27). */
export interface BudgetSnapshot {
  readonly period: string;
  readonly limit: number;
  readonly used: number;
  readonly remaining: number;
  readonly percentUsed: number;
  readonly warnAt: number;
  readonly hardStopAt: number;
  readonly state: BudgetState;
  readonly resetsAt: Date;
}

/** `GET /admin/usage` (A-33). */
export interface UsageOverview {
  readonly budget: BudgetSnapshot;
  readonly consumerGenerations: number;
  readonly testRenders: number;
  readonly trailingDailyRate: number;
  readonly projectedExhaustionAt: Date | null;
}

export interface ConsumeBudgetInput {
  readonly jobId: string;
  readonly period: string;
  /** `CONSUMER_GENERATION` or `TEST_RENDER` — the A-33 split (§4.27). */
  readonly reason: UsageReason;
  /** Who caused it. `null` for a system render with no owning consumer. */
  readonly userId: string | null;
  readonly actorId?: string | null;
  readonly note?: string | null;
}

export interface RefundBudgetInput {
  readonly jobId: string;
  readonly reason?: string;
}

export interface BudgetChargeResult {
  readonly before: BudgetSnapshot;
  readonly after: BudgetSnapshot;
}

export interface BudgetRefundResult {
  readonly refunded: boolean;
  readonly snapshot: BudgetSnapshot;
}

/**
 * PRD A-29, A-33 · ARCHITECTURE §4.27, §5.16 — the system-wide monthly budget.
 *
 * ### Same rule as the quota, one table over
 *
 * `usage_ledger` is append-only and **the remaining budget is derived by summing**
 * (§4.0 rule 10). `balanceAfter` sits on every row because PRD §12 lists it, and
 * §4.27 is explicit about what it is for: "an advisory snapshot for the A-33 burn-rate
 * chart … any code that reads `balanceAfter` to make a decision is a bug". Nothing in
 * this class decides on it. It is written on insert and never read back.
 *
 * ### The two thresholds, and where they are allowed to act
 *
 * A-29: "a soft warning at 80% and a hard stop at 100%. **On hard stop the catalog
 * stays browsable** and consumers see a clear message." That sentence is an
 * architectural constraint, not a copy note. It is why `assertBudgetAvailable()` lives
 * here rather than in a global guard, why `modules/catalog` has no dependency on this
 * module, and why `BUDGET_EXHAUSTED` is thrown from the generation path only. A budget
 * check bolted onto the request pipeline would take the whole shop offline the moment
 * the month ran hot, which is the opposite of what A-29 asks for: she can still browse,
 * still shortlist, still send an enquiry — she just cannot start a new generation.
 *
 * ### Why the budget grant reconciles to the setting, in both directions
 *
 * The quota's override only ever *raises* mid-period — taking allowance back from a
 * consumer who was told she had it is a promise broken. A budget is the opposite kind
 * of number: it is a cost ceiling, and an admin who lowers it at 3pm because the month
 * is running hot means it to bind at 3pm. So {@link reconcileMonthlyGrant} appends the
 * difference in whichever direction the setting moved, and a lowered ceiling can put
 * the platform straight into `EXHAUSTED`. That asymmetry between the two ledgers is
 * deliberate.
 *
 * ### Thresholds fire on the crossing, not on the state
 *
 * E-14 alerts on "budget at 80% and 100%". Both events are emitted only by the
 * consumption that moved `used` *across* the line — see `crossedThreshold()`. An alert
 * keyed on the state would fire on all four hundred generations after the threshold,
 * and an admin paged four hundred times has been given no information at all.
 */
@Injectable()
export class BudgetService {
  private readonly logger = new Logger(BudgetService.name);

  constructor(
    @InjectRepository(UsageLedgerEntry)
    private readonly ledger: Repository<UsageLedgerEntry>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly events: EventEmitter2,
  ) {}

  /* -----------------------------------------------------------------------------------------
   * Reads
   * -------------------------------------------------------------------------------------- */

  periodFor(now: Date = new Date()): string {
    return currentPeriod(this.timeZone(), now);
  }

  /** The A-29 position for a period, deriving the lazy grant if it has not run yet. */
  async getSnapshot(now: Date = new Date()): Promise<BudgetSnapshot> {
    return (await this.reconciledPosition(now)).snapshot;
  }

  /** The A-29 position, as the DTO. */
  async getSnapshotDto(now: Date = new Date()): Promise<BudgetSnapshotResponseDto> {
    return toBudgetSnapshot(await this.getSnapshot(now));
  }

  /**
   * §8.1 step 3 — is there budget left to generate? **Reads only.**
   *
   * Called from the try-on guard chain and nowhere else. Browsing, shortlisting,
   * sharing and enquiring never reach this method, which is how A-29's "the catalog
   * stays browsable" survives a hard stop.
   *
   * @throws `BUDGET_EXHAUSTED` — the §8.3 message, verbatim, from `ERROR_CODE_SPECS`
   */
  async assertBudgetAvailable(now: Date = new Date()): Promise<BudgetSnapshot> {
    const snapshot = await this.getSnapshot(now);

    if (snapshot.state === BUDGET_STATES.EXHAUSTED) {
      this.metrics.increment(METRICS.BUDGET_EXHAUSTED, { period: snapshot.period });
      throw new QuotaException(ErrorCode.BUDGET_EXHAUSTED, {
        details: { period: snapshot.period, resetsAt: snapshot.resetsAt },
      });
    }

    return snapshot;
  }

  /**
   * `GET /admin/usage` — the A-33 dashboard.
   *
   * The three splits, the trailing burn and the snapshot itself all come out of the one
   * {@link readTotals} scan the reconciliation already paid for; none of them is a second query.
   */
  async overview(now: Date = new Date()): Promise<AdminUsageResponseDto> {
    const { snapshot: budget, totals } = await this.reconciledPosition(now);

    const trailingSpend = -sumLedgerDeltas(
      totals.trailingByReason,
      budget.period,
      BUDGET_SPEND_REASONS,
    );
    const rate = trailingDailyRateOf(trailingSpend, TRAILING_WINDOW_DAYS);

    const overview: UsageOverview = {
      budget,
      consumerGenerations: this.spendOf(totals, budget.period, [UsageReason.CONSUMER_GENERATION]),
      testRenders: this.spendOf(totals, budget.period, [UsageReason.TEST_RENDER]),
      trailingDailyRate: rate,
      projectedExhaustionAt: projectBudgetExhaustion(
        { remaining: budget.remaining, trailingDailyRate: rate, resetsAt: budget.resetsAt },
        now,
      ).projectedExhaustionAt,
    };

    return toAdminUsage(overview);
  }

  /** `GET /admin/usage/ledger` — reconciliation (§5.16). */
  async listLedger(query: LedgerQueryDto): Promise<IPaginated<UsageLedgerEntryResponseDto>> {
    const period = query.period ?? this.periodFor();

    const [rows, total] = await this.ledger.findAndCount({
      where: { period },
      order: { [query.sortBy]: query.sortOrder },
      skip: paginationSkip(query),
      take: query.limit,
    });

    return paginate(rows.map(toUsageLedgerEntry), query, total);
  }

  /* -----------------------------------------------------------------------------------------
   * Writes the try-on module drives (§8.4)
   * -------------------------------------------------------------------------------------- */

  /**
   * Charges one generation against the platform budget, **inside the caller's
   * transaction** — the same transaction that charges the consumer's quota.
   *
   * Returns both the before and after positions, because the caller needs the pair to
   * decide whether this particular charge crossed a threshold and therefore whether
   * E-14 should hear about it.
   *
   * @throws `BUDGET_EXHAUSTED` when the re-derived position no longer allows a generation
   */
  async consumeWithin(
    manager: EntityManager,
    input: ConsumeBudgetInput,
  ): Promise<BudgetChargeResult> {
    const repository = manager.getRepository(UsageLedgerEntry);
    const now = new Date();

    const [initial, policy] = await Promise.all([
      this.readTotals(repository, input.period, now),
      this.settings.getBudgetPolicy(),
    ]);
    const totals = (await this.grantWithin(
      repository,
      input.period,
      initial,
      policy.monthlyGenerations,
    ))
      ? await this.readTotals(repository, input.period, now)
      : initial;

    const before = this.deriveSnapshot(totals, input.period, policy);

    if (before.state === BUDGET_STATES.EXHAUSTED) {
      this.metrics.increment(METRICS.BUDGET_EXHAUSTED, { period: before.period });
      throw new QuotaException(ErrorCode.BUDGET_EXHAUSTED, {
        details: { period: before.period, resetsAt: before.resetsAt },
      });
    }

    const used = before.used + GENERATION_COST;
    const remaining = before.remaining - GENERATION_COST;

    await repository.insert({
      delta: -GENERATION_COST,
      reason: input.reason,
      period: input.period,
      jobId: input.jobId,
      userId: input.userId,
      // Advisory only (§4.27). Written because PRD §12 lists it; never read back.
      balanceAfter: remaining,
      actorId: input.actorId ?? null,
      note: input.note ?? null,
    });

    this.metrics.increment(
      METRICS.BUDGET_CONSUMED,
      { period: input.period, reason: input.reason },
      GENERATION_COST,
    );

    const after: BudgetSnapshot = {
      ...before,
      used,
      remaining,
      percentUsed: burnPercent(used, before.hardStopAt),
      state: budgetStateFor(used, { warnAt: before.warnAt, hardStopAt: before.hardStopAt }),
    };

    return { before, after };
  }

  /**
   * Reverses a budget charge, **inside the caller's transaction**. No-op when there is
   * nothing to reverse — see {@link QuotaService.refundWithin} for why that is the
   * common case and why the compensating row carries no `jobId`
   * (`UQ_usage_ledger_job`, §4.27).
   */
  async refundWithin(
    manager: EntityManager,
    input: RefundBudgetInput,
  ): Promise<BudgetRefundResult> {
    const repository = manager.getRepository(UsageLedgerEntry);

    const charge = await repository.findOne({
      where: { jobId: input.jobId, reason: In(BUDGET_SPEND_REASONS) },
    });

    if (charge === null || charge.delta >= 0) {
      const snapshot = await this.readSnapshot(repository, this.periodFor());
      return { refunded: false, snapshot };
    }

    const totals = await this.readTotals(repository, charge.period, new Date());
    const remaining = sumLedgerDeltas(totals.byReason, charge.period) - charge.delta;

    await repository.insert({
      delta: -charge.delta,
      reason: charge.reason,
      period: charge.period,
      jobId: null,
      userId: charge.userId,
      balanceAfter: remaining,
      actorId: null,
      note: (input.reason ?? 'Refund').slice(0, 200) + ` — job ${input.jobId}`,
    });

    const snapshot = await this.readSnapshot(repository, charge.period);
    return { refunded: true, snapshot };
  }

  /**
   * E-14 — emit the A-29 thresholds, once, on the charge that crossed them.
   *
   * Called by `GenerationSpendService` **after** `commitTransaction()`: a warning
   * emitted inside a transaction that then rolled back would have alerted an admin
   * about spending that never happened (§2.9 rule 3).
   */
  emitThresholdEvents(charge: BudgetChargeResult): void {
    const { before, after } = charge;

    if (crossedThreshold(before.used, after.used, after.warnAt)) {
      this.metrics.increment(METRICS.BUDGET_WARNING_FIRED, { period: after.period });
      this.events.emit(QUOTA_EVENTS.BUDGET_WARNING_REACHED, this.thresholdEvent(after));
    }

    if (crossedThreshold(before.used, after.used, after.hardStopAt)) {
      this.metrics.increment(METRICS.BUDGET_EXHAUSTED, { period: after.period });
      this.events.emit(QUOTA_EVENTS.BUDGET_EXHAUSTED, this.thresholdEvent(after));
    }
  }

  /* -----------------------------------------------------------------------------------------
   * Admin writes (A-29)
   * -------------------------------------------------------------------------------------- */

  /**
   * `POST /admin/usage/adjust` (§5.16) — append an `ADMIN_ADJUSTMENT` row with a note.
   *
   * An adjustment that would take the derived remaining budget below zero is refused.
   * A negative platform balance is not a state any A-33 chart or A-29 threshold has a
   * meaning for, and the honest response to "that does not fit" is to say so.
   */
  async adjust(actor: ICurrentUser, dto: AdjustLedgerDto): Promise<BudgetSnapshotResponseDto> {
    const period = this.periodFor();
    await this.reconciledPosition(new Date());

    const snapshot = await this.runSerializable(
      'budget.adjust',
      async (manager: EntityManager): Promise<BudgetSnapshot> => {
        const repository = manager.getRepository(UsageLedgerEntry);
        const before = await this.readSnapshot(repository, period);

        if (before.remaining + dto.delta < 0) {
          throw new ValidationException(ErrorCode.QUOTA_ADJUSTMENT_INVALID, {
            message: `That would take the budget below zero. ${before.remaining} generations remain this month.`,
            details: {
              min: -before.remaining,
              max: MAX_LEDGER_ADJUSTMENT,
              remaining: before.remaining,
            },
          });
        }

        const remaining = before.remaining + dto.delta;
        await repository.insert({
          delta: dto.delta,
          reason: UsageReason.ADMIN_ADJUSTMENT,
          period,
          jobId: null,
          userId: null,
          balanceAfter: remaining,
          actorId: actor.id,
          note: dto.note ?? null,
        });

        const limit = before.limit + dto.delta;
        return {
          ...before,
          limit,
          remaining,
          percentUsed: burnPercent(before.used, before.hardStopAt),
        };
      },
    );

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.BUDGET_LIMIT_CHANGED,
        targetType: AUDIT_TARGET_TYPES.USAGE_LEDGER,
        actorId: actor.id,
        actorRole: actor.role,
        metadata: { period, delta: dto.delta, remaining: snapshot.remaining },
      }),
    );

    return toBudgetSnapshot(snapshot);
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  private timeZone(): string {
    return this.config.get<string>('TIMEZONE') ?? DEFAULT_BILLING_TIME_ZONE;
  }

  /**
   * **One scan of `usage_ledger` per period, and everything derived from it.**
   *
   * `SUM(delta) … GROUP BY reason`, plus a conditional aggregate for the trailing window.
   * One pass over the period's rows answers `remaining`, `limit`, the monthly grant total, the
   * A-33 splits and the seven-day burn — the numbers that used to cost three separate scans on
   * the guard-chain path and four on the dashboard. The grouped result is at most one row per
   * `UsageReason`, and the arithmetic that folds those rows is `ledger-math`'s, unchanged: the
   * queries were collapsed, the derivation was not moved.
   *
   * The soft-delete predicate is the query builder's own — `usage_ledger` is append-only, but
   * the condition is not dropped just because nothing exercises it.
   */
  private async readTotals(
    repository: Repository<UsageLedgerEntry>,
    period: string,
    now: Date,
  ): Promise<PeriodTotals> {
    const since = new Date(now.getTime() - TRAILING_WINDOW_DAYS * MILLISECONDS_PER_DAY);

    const rows = await repository
      .createQueryBuilder('usage')
      .select('usage.reason', 'reason')
      .addSelect('SUM(usage.delta)', 'delta')
      .addSelect('SUM(usage.delta) FILTER (WHERE usage.createdAt >= :since)', 'trailingDelta')
      .where('usage.period = :period', { period, since })
      .groupBy('usage.reason')
      .getRawMany<RawPeriodTotalsRow>();

    return {
      byReason: rows.map((row) => ({ period, reason: row.reason, delta: toNumber(row.delta) })),
      trailingByReason: rows.map((row) => ({
        period,
        reason: row.reason,
        delta: toNumber(row.trailingDelta),
      })),
    };
  }

  /**
   * The A-29 position **plus the totals it was derived from**, so a caller that needs both
   * (`overview`) does not pay for a second scan to get the second half.
   *
   * The lazy grant is reconciled first. The cheap common case — the grant already matches the
   * setting — reuses the totals just read and writes nothing; only a genuine difference opens a
   * `SERIALIZABLE` transaction and costs a re-read.
   */
  private async reconciledPosition(
    now: Date,
  ): Promise<{ snapshot: BudgetSnapshot; totals: PeriodTotals }> {
    const period = this.periodFor(now);

    const [initial, policy] = await Promise.all([
      this.readTotals(this.ledger, period, now),
      this.settings.getBudgetPolicy(),
    ]);

    const totals = (await this.reconcileMonthlyGrant(period, initial, policy.monthlyGenerations))
      ? await this.readTotals(this.ledger, period, now)
      : initial;

    const snapshot = this.deriveSnapshot(totals, period, policy);

    this.metrics.gauge(METRICS.BUDGET_REMAINING, snapshot.remaining, { period });
    this.metrics.gauge(METRICS.BUDGET_BURN_PERCENT, snapshot.percentUsed, { period });

    return { snapshot, totals };
  }

  /**
   * Brings the period's granted budget in line with `budget.monthlyGenerations`.
   *
   * The grant total comes from the scan the caller already paid for — the common case is that it
   * already matches and nothing is written. Only a genuine difference opens a `SERIALIZABLE`
   * transaction, and a concurrent writer that beat us there aborts this one with `40001`, which
   * means the reconciliation happened and is swallowed.
   *
   * @returns `true` when a row was (or may have been) written, so the caller must re-read.
   */
  private async reconcileMonthlyGrant(
    period: string,
    totals: PeriodTotals,
    monthlyGenerations: number,
  ): Promise<boolean> {
    if (this.monthlyGrantOf(totals, period) === monthlyGenerations) {
      return false;
    }

    try {
      await this.runSerializable('budget.monthly-grant', (manager) =>
        this.reconcileMonthlyGrantWithin(manager, period),
      );
    } catch (error) {
      if (!isSerializationFailure(error)) {
        throw error;
      }
      this.logger.debug(`Concurrent budget grant for period ${period}; the other writer won.`);
    }

    return true;
  }

  private async reconcileMonthlyGrantWithin(manager: EntityManager, period: string): Promise<void> {
    const repository = manager.getRepository(UsageLedgerEntry);

    const [totals, policy] = await Promise.all([
      this.readTotals(repository, period, new Date()),
      this.settings.getBudgetPolicy(),
    ]);

    await this.grantWithin(repository, period, totals, policy.monthlyGenerations);
  }

  /**
   * Appends the difference between the granted total and the setting, inside whatever
   * transaction the repository belongs to.
   *
   * @returns `true` when a row was written, so the caller's totals are stale.
   */
  private async grantWithin(
    repository: Repository<UsageLedgerEntry>,
    period: string,
    totals: PeriodTotals,
    monthlyGenerations: number,
  ): Promise<boolean> {
    const difference = monthlyGenerations - this.monthlyGrantOf(totals, period);

    if (difference === 0) {
      return false;
    }

    const remaining = sumLedgerDeltas(totals.byReason, period) + difference;
    await repository.insert({
      delta: difference,
      reason: UsageReason.MONTHLY_BUDGET_GRANT,
      period,
      jobId: null,
      userId: null,
      balanceAfter: remaining,
      actorId: null,
      note: null,
    });

    return true;
  }

  /** {@link readTotals} plus the policy, folded straight into a snapshot. One scan. */
  private async readSnapshot(
    repository: Repository<UsageLedgerEntry>,
    period: string,
    now: Date = new Date(),
  ): Promise<BudgetSnapshot> {
    const [totals, policy] = await Promise.all([
      this.readTotals(repository, period, now),
      this.settings.getBudgetPolicy(),
    ]);

    return this.deriveSnapshot(totals, period, policy);
  }

  /**
   * The derivation. `remaining` is `SUM(delta)` over every row of the period — the
   * authoritative number §4.27 names — and `used` is computed back from the granted
   * total rather than summed independently, so the two can never disagree.
   *
   * Pure, and over the grouped rows rather than the repository: the sums are `ledger-math`'s,
   * which is what keeps the E-5 arithmetic tests testing the arithmetic this method uses.
   */
  private deriveSnapshot(
    totals: PeriodTotals,
    period: string,
    policy: BudgetThresholds,
  ): BudgetSnapshot {
    const remaining = sumLedgerDeltas(totals.byReason, period);
    const limit = sumLedgerDeltas(totals.byReason, period, BUDGET_GRANT_REASONS);
    const used = limit - remaining;

    return {
      period,
      limit,
      used,
      remaining,
      percentUsed: burnPercent(used, policy.hardStopAt),
      warnAt: policy.warnAt,
      hardStopAt: policy.hardStopAt,
      state: budgetStateFor(used, { warnAt: policy.warnAt, hardStopAt: policy.hardStopAt }),
      resetsAt: periodResetsAt(period, this.timeZone()),
    };
  }

  /** Spend as a positive number, for the A-33 splits. */
  private spendOf(totals: PeriodTotals, period: string, reasons: readonly UsageReason[]): number {
    const spent = sumLedgerDeltas(totals.byReason, period, reasons);
    return spent === 0 ? 0 : -spent;
  }

  private monthlyGrantOf(totals: PeriodTotals, period: string): number {
    return sumLedgerDeltas(totals.byReason, period, [UsageReason.MONTHLY_BUDGET_GRANT]);
  }

  private thresholdEvent(snapshot: BudgetSnapshot): BudgetThresholdEvent {
    return {
      period: snapshot.period,
      used: snapshot.used,
      limit: snapshot.limit,
      remaining: snapshot.remaining,
      percentUsed: snapshot.percentUsed,
      state: snapshot.state,
      resetsAt: snapshot.resetsAt,
      occurredAt: new Date(),
    };
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
