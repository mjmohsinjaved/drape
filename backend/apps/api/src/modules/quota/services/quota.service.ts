import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import {
  DataSource,
  In,
  Like,
  Repository,
  type EntityManager,
  type FindOptionsWhere,
} from 'typeorm';

import {
  currentPeriod,
  DEFAULT_BILLING_TIME_ZONE,
  ErrorCode,
  METRICS,
  MetricsService,
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
import { ConsumerProfile } from '@api/modules/users/entities/consumer-profile.entity';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { MAX_LEDGER_ADJUSTMENT } from '../dto/adjust-ledger.dto';
import { QuotaLedgerEntry } from '../entities/quota-ledger-entry.entity';
import { QuotaReason } from '../enums/quota-reason.enum';
import { QUOTA_EVENTS, type ConsumerQuotaExhaustedEvent } from '../events/quota.events';
import { toQuotaLedgerEntry, toQuotaSnapshot } from '../mappers/quota.mapper';
import {
  QUOTA_GRANT_REASONS,
  refundNote,
  refundNotePattern,
  type LedgerBalance,
} from '../utils/ledger-math';
import { isSerializationFailure } from '../utils/postgres-errors';

import type { AdjustLedgerDto } from '../dto/adjust-ledger.dto';
import type { LedgerQueryDto } from '../dto/ledger-query.dto';
import type {
  QuotaLedgerEntryResponseDto,
  QuotaSnapshotResponseDto,
} from '../dto/quota-response.dto';

/** One generation. The unit is deliberately not configurable — a try-on costs one. */
const GENERATION_COST = 1;

/** A consumer's derived position this period. `resetsAt` is the C-5 counter's reset date. */
export interface QuotaSnapshot extends LedgerBalance {
  readonly userId: string;
  readonly resetsAt: Date;
}

export interface ConsumeQuotaInput {
  readonly userId: string;
  /** The `tryon_jobs` row this charge belongs to. `UQ_quota_ledger_job` makes it unique. */
  readonly jobId: string;
  /** `YYYY-MM`. Passed in so a charge lands in the period the job started in. */
  readonly period: string;
  readonly note?: string | null;
}

export interface RefundQuotaInput {
  readonly userId: string;
  readonly jobId: string;
  readonly reason?: string;
}

export interface QuotaRefundResult {
  /** `false` when there was nothing to refund — the ordinary failure path (§8.4). */
  readonly refunded: boolean;
  readonly snapshot: QuotaSnapshot;
}

/**
 * PRD C-5, A-18, A-28 · ARCHITECTURE §4.26, §5.16 — the per-consumer generation quota.
 *
 * ### The one rule this class exists to keep
 *
 * **There is no balance column, and there never will be one** (§4.0 rule 10,
 * CLAUDE.md). Remaining quota is `SELECT COALESCE(SUM(delta), 0) FROM quota_ledger
 * WHERE "userId" = $1 AND period = $2`, derived on every read. Every write is an
 * `INSERT`. Nothing in this file calls `save()` on a loaded ledger row, `update()`s
 * one, or holds a running total anywhere but a local variable inside a transaction.
 *
 * If a future change makes it tempting to cache the balance on `consumer_profiles`,
 * the thing to remember is what a stored balance actually buys and costs: it saves one
 * indexed aggregate over ~20 rows, and it introduces a second source of truth that
 * silently disagrees with the ledger the first time a write half-completes. The ledger
 * is the audit trail an admin reconciles against in `GET /admin/consumers/:id/quota-ledger`;
 * a balance that can disagree with it is worse than no balance at all.
 *
 * ### The lazy monthly grant
 *
 * §4.26: "The monthly grant is lazy: the first quota read in a new period inserts a
 * `MONTHLY_GRANT` row of `consumer_profiles.monthlyQuotaOverride ??
 * settings['quota.defaultMonthly']` inside a transaction guarded by the same period."
 * There is no monthly cron, so an account dormant for six months has six periods with
 * no rows at all and costs nothing to store — and the moment she comes back, her first
 * read materialises exactly one period's grant.
 *
 * ### Why consumption is `SERIALIZABLE`
 *
 * Deriving a balance and then appending a row is a read-then-write. Under `READ
 * COMMITTED`, two requests at `remaining = 1` both read `1`, both decide they may
 * spend, and both insert — the consumer gets two generations and the brand pays for
 * two. `SERIALIZABLE` makes that interleaving impossible: PostgreSQL aborts one
 * transaction with `40001` rather than committing a history no serial order could
 * produce. The loser retries once, sees `remaining = 0`, and is refused with
 * `QUOTA_EXHAUSTED`. `UQ_quota_ledger_job` is the belt to that pair of braces — the
 * same job can never be charged twice however many retries or double-clicks arrive.
 *
 * ### And why the charge happens only on success
 *
 * §8.4: "Quota and budget decrement only on success." The try-on module calls
 * {@link assertQuotaAvailable} in the guard chain — a pure read that changes nothing —
 * and calls the consume path only once a render exists. {@link refundWithin} is the
 * safety net for the narrow window where the charge committed and a later step failed;
 * on the ordinary failure path there is nothing to refund, and it correctly does
 * nothing.
 */
@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    @InjectRepository(QuotaLedgerEntry)
    private readonly ledger: Repository<QuotaLedgerEntry>,
    @InjectRepository(ConsumerProfile)
    private readonly profiles: Repository<ConsumerProfile>,
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

  /** The `YYYY-MM` period an instant falls in, in `TIMEZONE` (§4.26). */
  periodFor(now: Date = new Date()): string {
    return currentPeriod(this.timeZone(), now);
  }

  /**
   * `GET /quota/me` — the persistent counter (C-5, §5.16).
   *
   * A read that may write exactly once per account per period: the lazy grant. The
   * `exists` probe outside the transaction is what keeps the common case — every read
   * after the first — to a single indexed aggregate with no transaction at all.
   */
  async getSnapshot(userId: string, now: Date = new Date()): Promise<QuotaSnapshot> {
    const period = this.periodFor(now);
    await this.ensureMonthlyGrant(userId, period);

    const snapshot = await this.deriveSnapshot(this.ledger, userId, period);
    this.metrics.gauge(METRICS.QUOTA_REMAINING, snapshot.remaining, { period });
    return snapshot;
  }

  /** `GET /quota/me`, as the DTO (§5.16). */
  async getSnapshotDto(userId: string, now: Date = new Date()): Promise<QuotaSnapshotResponseDto> {
    return toQuotaSnapshot(await this.getSnapshot(userId, now));
  }

  /**
   * §8.1 step 3 — has she got a generation left? **Reads only.**
   *
   * The try-on module calls this in the guard chain, before a `tryon_jobs` row exists
   * and long before anything is charged. It cannot spend, and it cannot be made to
   * spend by calling it twice.
   *
   * @throws `QUOTA_EXHAUSTED` with the §2.3 `details` the C-5 screen renders from.
   */
  async assertQuotaAvailable(userId: string, now: Date = new Date()): Promise<QuotaSnapshot> {
    const snapshot = await this.getSnapshot(userId, now);

    if (snapshot.remaining < GENERATION_COST) {
      this.metrics.increment(METRICS.QUOTA_EXHAUSTED, { period: snapshot.period });
      throw new QuotaException(ErrorCode.QUOTA_EXHAUSTED, {
        details: {
          period: snapshot.period,
          limit: snapshot.limit,
          used: snapshot.used,
          resetsAt: snapshot.resetsAt,
        },
      });
    }

    return snapshot;
  }

  /** `GET /admin/consumers/:userId/quota-ledger` (§5.16) — the A-18 reconciliation view. */
  async listLedger(
    userId: string,
    query: LedgerQueryDto,
  ): Promise<IPaginated<QuotaLedgerEntryResponseDto>> {
    const period = query.period ?? this.periodFor();

    const [rows, total] = await this.ledger.findAndCount({
      where: { userId, period },
      order: { [query.sortBy]: query.sortOrder },
      skip: paginationSkip(query),
      take: query.limit,
    });

    return paginate(rows.map(toQuotaLedgerEntry), query, total);
  }

  /* -----------------------------------------------------------------------------------------
   * Writes the try-on module drives (§8.4)
   * -------------------------------------------------------------------------------------- */

  /**
   * Charges one generation, **inside the caller's transaction**.
   *
   * Takes an `EntityManager` rather than opening its own, because a successful
   * generation charges the consumer's quota *and* the platform budget and those two
   * inserts must commit or roll back together (§2.9 rule 3). `GenerationSpendService`
   * owns that transaction; this method owns the quota half of it.
   *
   * The balance is re-derived here, inside the transaction, and not taken from
   * whatever the guard chain read seconds earlier. The guard's answer was true when it
   * was given and may not be now — that gap is exactly where a double spend lives.
   *
   * @throws `QUOTA_EXHAUSTED` when the re-derived balance no longer covers a generation
   */
  async consumeWithin(manager: EntityManager, input: ConsumeQuotaInput): Promise<QuotaSnapshot> {
    const repository = manager.getRepository(QuotaLedgerEntry);

    await this.ensureMonthlyGrantWithin(manager, input.userId, input.period);
    const before = await this.deriveSnapshot(repository, input.userId, input.period);

    if (before.remaining < GENERATION_COST) {
      this.metrics.increment(METRICS.QUOTA_EXHAUSTED, { period: before.period });
      throw new QuotaException(ErrorCode.QUOTA_EXHAUSTED, {
        details: {
          period: before.period,
          limit: before.limit,
          used: before.used,
          resetsAt: before.resetsAt,
        },
      });
    }

    await repository.insert({
      userId: input.userId,
      delta: -GENERATION_COST,
      reason: QuotaReason.GENERATION_CONSUMED,
      period: input.period,
      jobId: input.jobId,
      actorId: null,
      note: input.note ?? null,
    });

    const after: QuotaSnapshot = {
      ...before,
      used: before.used + GENERATION_COST,
      remaining: before.remaining - GENERATION_COST,
    };

    this.metrics.increment(METRICS.QUOTA_CONSUMED, { period: after.period }, GENERATION_COST);
    return after;
  }

  /**
   * Returns a charge that should not have been made, **inside the caller's transaction**.
   *
   * ### When this does nothing, which is almost always
   *
   * §8.4 charges only on success, so a failed generation has no ledger row to reverse
   * and this method returns `{ refunded: false }` without writing. That is the design,
   * not a gap: a failure path that had to remember to refund would eventually forget,
   * whereas a failure path that never charged has nothing to forget. The narrow case
   * this exists for is a charge that committed and a *later* step that then failed —
   * writing the render, say — where the consumer would otherwise be billed for a
   * result she never received.
   *
   * ### Why the compensating row carries no `jobId`
   *
   * `UQ_quota_ledger_job UNIQUE ("jobId") WHERE "jobId" IS NOT NULL` (§4.26) allows
   * exactly one row per job, and that index "is what makes a double consumption
   * physically impossible" — so the reversal cannot reuse the id without destroying
   * the guarantee. The job is named in `note` instead, which keeps the trail readable
   * in the A-18 ledger view while leaving the index doing its job.
   *
   * The reversal is booked into the **original** period, not today's: a job that
   * started on 31 August and failed on 1 September was charged against August, and
   * refunding it into September would quietly hand out a free generation.
   *
   * ### And why it is idempotent
   *
   * Because the compensating row carries no `jobId`, "find the charge" is not a test of
   * whether a refund already happened — the charge is still there, the table is
   * append-only, and asking that question twice used to credit her twice. The reversal is
   * therefore looked for by its own {@link refundMarker}, not inferred from the charge. A
   * second call finds the first reversal and writes nothing, which is what lets the
   * failure path call this unconditionally without counting how many times it has. See
   * `ledger-math`'s `refundMarker()` for the marker's shape and why it leads the note.
   */
  async refundWithin(manager: EntityManager, input: RefundQuotaInput): Promise<QuotaRefundResult> {
    const repository = manager.getRepository(QuotaLedgerEntry);

    const charge = await repository.findOne({
      where: {
        jobId: input.jobId,
        userId: input.userId,
        reason: QuotaReason.GENERATION_CONSUMED,
      },
    });

    if (charge === null || charge.delta >= 0) {
      const snapshot = await this.deriveSnapshot(repository, input.userId, this.periodFor());
      return { refunded: false, snapshot };
    }

    const alreadyReversed = await repository.findOne({
      where: {
        userId: input.userId,
        period: charge.period,
        reason: QuotaReason.GENERATION_CONSUMED,
        note: Like(refundNotePattern(input.jobId)),
      },
    });

    if (alreadyReversed !== null) {
      const snapshot = await this.deriveSnapshot(repository, input.userId, charge.period);
      return { refunded: false, snapshot };
    }

    await repository.insert({
      userId: input.userId,
      delta: -charge.delta,
      reason: QuotaReason.GENERATION_CONSUMED,
      period: charge.period,
      jobId: null,
      actorId: null,
      note: refundNote(input.jobId, input.reason),
    });

    const snapshot = await this.deriveSnapshot(repository, input.userId, charge.period);
    return { refunded: true, snapshot };
  }

  /**
   * Emits the C-5 "last generation spent" event when a charge took her to zero.
   *
   * Called by `GenerationSpendService` **after** the commit — a listener told about a
   * transaction that later rolled back has been told a lie (§2.9 rule 3).
   */
  emitExhaustionIfSpent(snapshot: QuotaSnapshot): void {
    if (snapshot.remaining > 0) {
      return;
    }

    const event: ConsumerQuotaExhaustedEvent = {
      userId: snapshot.userId,
      period: snapshot.period,
      limit: snapshot.limit,
      used: snapshot.used,
      resetsAt: snapshot.resetsAt,
      occurredAt: new Date(),
    };
    this.events.emit(QUOTA_EVENTS.QUOTA_EXHAUSTED, event);
  }

  /* -----------------------------------------------------------------------------------------
   * Admin writes (A-18)
   * -------------------------------------------------------------------------------------- */

  /**
   * `POST /admin/consumers/:userId/quota-adjust` (A-18, §5.16).
   *
   * Appends an `ADMIN_ADJUSTMENT` row. A negative adjustment that would drive her
   * remaining balance below zero is refused rather than clamped: a ledger whose sum
   * can go negative makes "remaining" meaningless, and silently applying part of what
   * an admin asked for is worse than telling them it does not fit.
   */
  async adjust(
    actor: ICurrentUser,
    userId: string,
    dto: AdjustLedgerDto,
  ): Promise<QuotaSnapshotResponseDto> {
    const period = this.periodFor();
    await this.ensureMonthlyGrant(userId, period);

    const snapshot = await this.runSerializable(
      'quota.adjust',
      async (manager: EntityManager): Promise<QuotaSnapshot> => {
        const repository = manager.getRepository(QuotaLedgerEntry);
        const before = await this.deriveSnapshot(repository, userId, period);

        if (before.remaining + dto.delta < 0) {
          throw new ValidationException(ErrorCode.QUOTA_ADJUSTMENT_INVALID, {
            message: `That would take her below zero. She has ${before.remaining} left this month.`,
            details: {
              min: -before.remaining,
              max: MAX_LEDGER_ADJUSTMENT,
              remaining: before.remaining,
            },
          });
        }

        await repository.insert({
          userId,
          delta: dto.delta,
          reason: QuotaReason.ADMIN_ADJUSTMENT,
          period,
          jobId: null,
          actorId: actor.id,
          note: dto.note ?? null,
        });

        return {
          ...before,
          limit: before.limit + dto.delta,
          remaining: before.remaining + dto.delta,
        };
      },
    );

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.QUOTA_ADJUSTED,
        targetType: AUDIT_TARGET_TYPES.QUOTA_LEDGER,
        actorId: actor.id,
        actorRole: actor.role,
        targetId: userId,
        metadata: { period, delta: dto.delta, remaining: snapshot.remaining },
      }),
    );

    this.metrics.increment(
      METRICS.QUOTA_GRANTED,
      { period, reason: QuotaReason.ADMIN_ADJUSTMENT },
      Math.max(0, dto.delta),
    );

    return toQuotaSnapshot(snapshot);
  }

  /**
   * A-18 — bring this period's entitlement up to `target`, immediately.
   *
   * Called by the `user.quota_override_changed` listener. The difference is appended
   * as an `OVERRIDE_GRANT`; the earlier `MONTHLY_GRANT` row is never rewritten,
   * because rewriting history is the one thing an append-only ledger must not do
   * (§4.26).
   *
   * Written as "raise the entitlement to `target`" rather than "add `to - from`"
   * deliberately. It reads the rows that already exist and appends only the shortfall,
   * so it converges on the right answer even when the event's `from` disagrees with
   * what was actually granted — a replayed event, a default that moved mid-period, or
   * an override set before this period's grant was ever materialised.
   *
   * @returns the amount appended; `0` when the entitlement already covers `target`
   */
  async raiseEntitlementTo(
    userId: string,
    period: string,
    target: number,
    actorId: string | null,
    note: string | null,
  ): Promise<number> {
    return this.runSerializable('quota.raise-entitlement', async (manager: EntityManager) => {
      const repository = manager.getRepository(QuotaLedgerEntry);

      const hasMonthly = await repository.exists({
        where: { userId, period, reason: QuotaReason.MONTHLY_GRANT },
      });

      if (!hasMonthly) {
        // No grant materialised yet, so the lazy grant has not run for this period.
        // Insert it at the new value and stop — appending a difference on top would
        // grant the raise twice.
        await repository.insert({
          userId,
          delta: target,
          reason: QuotaReason.MONTHLY_GRANT,
          period,
          jobId: null,
          actorId,
          note,
        });
        return target;
      }

      const entitlement = await this.sumDeltas(repository, {
        userId,
        period,
        reason: In(QUOTA_GRANT_REASONS),
      });

      const shortfall = target - entitlement;
      if (shortfall <= 0) {
        return 0;
      }

      await repository.insert({
        userId,
        delta: shortfall,
        reason: QuotaReason.OVERRIDE_GRANT,
        period,
        jobId: null,
        actorId,
        note,
      });
      return shortfall;
    });
  }

  /**
   * `consumer_profiles.monthlyQuotaOverride ?? settings['quota.defaultMonthly']`
   * (§4.26, A-18, A-28 — default 15).
   */
  async resolveLimit(userId: string): Promise<number> {
    const profile = await this.profiles.findOne({ where: { userId } });
    if (profile?.monthlyQuotaOverride !== null && profile?.monthlyQuotaOverride !== undefined) {
      return profile.monthlyQuotaOverride;
    }
    return this.settings.getNumber(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY);
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  private timeZone(): string {
    return this.config.get<string>('TIMEZONE') ?? DEFAULT_BILLING_TIME_ZONE;
  }

  /**
   * The lazy grant, guarded outside a transaction by a cheap existence check.
   *
   * The check can race — two first-reads in the same millisecond both see nothing —
   * so the transaction repeats it under `SERIALIZABLE` and the loser is aborted with
   * `40001`. That abort means "somebody else granted it", which is the outcome we
   * wanted, so it is swallowed. Any other error is a real one and propagates.
   */
  private async ensureMonthlyGrant(userId: string, period: string): Promise<void> {
    const granted = await this.ledger.exists({
      where: { userId, period, reason: QuotaReason.MONTHLY_GRANT },
    });
    if (granted) {
      return;
    }

    try {
      await this.runSerializable('quota.monthly-grant', (manager) =>
        this.ensureMonthlyGrantWithin(manager, userId, period),
      );
    } catch (error) {
      if (!isSerializationFailure(error)) {
        throw error;
      }
      this.logger.debug(`Concurrent monthly grant for period ${period}; the other writer won.`);
    }
  }

  private async ensureMonthlyGrantWithin(
    manager: EntityManager,
    userId: string,
    period: string,
  ): Promise<void> {
    const repository = manager.getRepository(QuotaLedgerEntry);

    const granted = await repository.exists({
      where: { userId, period, reason: QuotaReason.MONTHLY_GRANT },
    });
    if (granted) {
      return;
    }

    const limit = await this.resolveLimit(userId);
    await repository.insert({
      userId,
      delta: limit,
      reason: QuotaReason.MONTHLY_GRANT,
      period,
      jobId: null,
      actorId: null,
      note: null,
    });

    this.metrics.increment(
      METRICS.QUOTA_GRANTED,
      { period, reason: QuotaReason.MONTHLY_GRANT },
      limit,
    );
  }

  /**
   * The derivation, in two aggregates.
   *
   * `remaining` is a genuine `SUM(delta)` over every row — the authoritative number
   * §4.26 names — and `used` is computed back from it rather than summed separately.
   * That ordering matters: a reason this file has not been taught about yet still
   * lands in `remaining` correctly, where a `used` summed independently and a
   * `remaining` derived as `limit - used` could quietly disagree with the ledger.
   */
  private async deriveSnapshot(
    repository: Repository<QuotaLedgerEntry>,
    userId: string,
    period: string,
  ): Promise<QuotaSnapshot> {
    const [remaining, limit] = await Promise.all([
      this.sumDeltas(repository, { userId, period }),
      this.sumDeltas(repository, { userId, period, reason: In(QUOTA_GRANT_REASONS) }),
    ]);

    return {
      userId,
      period,
      limit,
      used: limit - remaining,
      remaining,
      resetsAt: periodResetsAt(period, this.timeZone()),
    };
  }

  /** `COALESCE(SUM(delta), 0)`. `null` means "no rows", which is a balance of zero. */
  private async sumDeltas(
    repository: Repository<QuotaLedgerEntry>,
    where: FindOptionsWhere<QuotaLedgerEntry>,
  ): Promise<number> {
    return (await repository.sum('delta', where)) ?? 0;
  }

  /**
   * A `SERIALIZABLE` transaction with exactly one retry.
   *
   * One, not "until it works": a serialization failure means somebody else committed
   * the write we were about to make, so the second attempt sees their row and reaches
   * the correct decision — which for a consumption at `remaining = 1` is
   * `QUOTA_EXHAUSTED`. A third attempt could only ever repeat the second, and an
   * unbounded loop under contention is how a pool of ten connections dies.
   */
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
