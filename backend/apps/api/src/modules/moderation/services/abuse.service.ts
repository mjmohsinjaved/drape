import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { In, IsNull, MoreThan, Repository } from 'typeorm';

import {
  ConflictException,
  ErrorCode,
  MILLISECONDS_PER_HOUR,
  NotFoundException,
  RequestContext,
  UserStatus,
  type ICurrentUser,
} from '@library/common';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { AuthAttempt } from '@api/modules/auth/entities/auth-attempt.entity';
import { AuthOutcome } from '@api/modules/auth/enums/auth-outcome.enum';
import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';
import { JobStatus } from '@api/modules/tryon/enums/job-status.enum';
import { User } from '@api/modules/users/entities/user.entity';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import { ABUSE_MIN_FAILURES, ABUSE_PAGE_LIMIT } from '../constants/moderation.constants';
import {
  AbuseOverviewResponseDto,
  AbusiveAccountResponseDto,
  type AbuseQueryDto,
  type CreateIpBlockDto,
  IpBlockResponseDto,
} from '../dto/abuse.dto';
import { IpBlock } from '../entities/ip-block.entity';
import { toIpBlockResponse } from '../mappers/moderation.mapper';

/** One row of the grouped `auth_attempts` aggregate. Postgres returns counts as strings. */
interface AuthFailureRow {
  readonly userId: string | null;
  readonly failures: string;
  readonly distinctIps: string;
  readonly lastFailureAt: Date;
}

/** One row of the grouped `tryon_jobs` aggregate. */
interface GenerationFailureRow {
  readonly userId: string;
  readonly failures: string;
  readonly lastFailureAt: Date;
}

/** What the E-14 anomaly sweep measures, per authentication route. */
export interface AuthAnomalySignal {
  readonly route: string;
  readonly failures: number;
  readonly distinctIps: number;
  readonly distinctAccounts: number;
}

/**
 * **The A-35 abuse view — PRD A-35, S-6 · ARCHITECTURE §4.7, §4.8, §5.17.**
 *
 * > "Abuse view: accounts hitting rate limits or repeated failures, with manual
 * > suspension and device or IP blocking."
 *
 * ### The two sources, and why they are aggregates
 *
 * §5.17 names them: `auth_attempts` (§4.7) for authentication failures and
 * `tryon_jobs` (§4.17) for generation failures. Both are append-only or high-volume
 * tables that grow with traffic, so **every query here is a `GROUP BY` with a bounded
 * window and a `LIMIT`** and none of them ever loads a row it is not going to show. A
 * screen that reads a day of `auth_attempts` into memory is a screen that stops working
 * on the first day it is genuinely needed.
 *
 * ### What is not on this screen
 *
 * An email address. `auth_attempts` stores `emailHash` — a sha256 — and §4.7 says why:
 * "the address itself is never stored here (E-12)". So the view reports accounts by
 * `userId`, and the failures that never resolved to an account are reported as exactly
 * that: a `null` userId, which is a probe rather than a person.
 *
 * ### Suspension is `users`, and stays there
 *
 * A-19's suspension — required reason, sessions revoked — lives in
 * `AdminConsumersService`, and this module does not duplicate it. What this service
 * adds is the **block**: `ip_blocks` (§4.8), which is this module's table (§4.33), and
 * which the guard chain consults before a session exists at all. Suspending an account
 * stops one person; blocking a range stops the script that is trying four hundred of
 * them.
 */
@Injectable()
export class AbuseService {
  constructor(
    @InjectRepository(AuthAttempt)
    private readonly attempts: Repository<AuthAttempt>,
    @InjectRepository(TryOnJob)
    private readonly jobs: Repository<TryOnJob>,
    @InjectRepository(IpBlock)
    private readonly blocks: Repository<IpBlock>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly events: EventEmitter2,
  ) {}

  /* -----------------------------------------------------------------------------------------
   * The view
   * -------------------------------------------------------------------------------------- */

  /** `GET /admin/abuse` (A-35, §5.17). */
  async overview(query: AbuseQueryDto, now: Date = new Date()): Promise<AbuseOverviewResponseDto> {
    const since = new Date(now.getTime() - query.windowHours * MILLISECONDS_PER_HOUR);

    const [authRows, generationRows, totalAuthFailures, activeBlocks] = await Promise.all([
      this.authFailuresSince(since),
      this.generationFailuresSince(since),
      this.attempts.count({
        where: { outcome: In(FAILED_OUTCOMES), createdAt: MoreThan(since) },
      }),
      this.countActiveBlocks(now),
    ]);

    const merged = this.merge(authRows, generationRows);
    const suspended = await this.suspendedAmong(merged.map((row) => row.userId));

    const dto = new AbuseOverviewResponseDto();
    dto.windowHours = query.windowHours;
    dto.windowStartedAt = since;
    dto.totalAuthFailures = totalAuthFailures;
    dto.activeBlocks = activeBlocks;
    dto.accounts = merged.map((row) => {
      const item = new AbusiveAccountResponseDto();
      item.userId = row.userId;
      item.authFailures = row.authFailures;
      item.generationFailures = row.generationFailures;
      item.distinctIps = row.distinctIps;
      item.lastFailureAt = row.lastFailureAt;
      item.suspended = row.userId !== null && suspended.has(row.userId);
      return item;
    });

    return dto;
  }

  /* -----------------------------------------------------------------------------------------
   * IP blocks (§4.8)
   * -------------------------------------------------------------------------------------- */

  /** `GET /admin/abuse/ip-blocks` — current blocks, expired ones included and marked. */
  async listBlocks(now: Date = new Date()): Promise<IpBlockResponseDto[]> {
    const rows = await this.blocks.find({
      order: { createdAt: 'DESC' },
      take: ABUSE_PAGE_LIMIT,
    });
    return rows.map((row) => toIpBlockResponse(row, now));
  }

  /**
   * `POST /admin/abuse/ip-blocks` (A-35).
   *
   * A `cidr` already blocked is a conflict rather than a silent no-op: two admins
   * blocking the same range for different reasons is a thing an operator needs to see,
   * and `UQ_ip_blocks_cidr` (§4.8) is what says so.
   */
  async createBlock(admin: ICurrentUser, dto: CreateIpBlockDto): Promise<IpBlockResponseDto> {
    const existing = await this.blocks.findOne({ where: { cidr: dto.cidr } });
    if (existing !== null) {
      throw new ConflictException(ErrorCode.RESOURCE_CONFLICT, {
        message: 'That address or range is already blocked.',
        details: { cidr: dto.cidr, blockId: existing.id },
      });
    }

    const saved = await this.blocks.save(
      this.blocks.create({
        cidr: dto.cidr,
        reason: dto.reason,
        createdBy: admin.id,
        expiresAt: dto.expiresAt === undefined ? null : new Date(dto.expiresAt),
      }),
    );

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.IP_BLOCK_CREATED,
        targetType: AUDIT_TARGET_TYPES.IP_BLOCK,
        actorId: admin.id,
        actorRole: admin.role,
        targetId: saved.id,
        targetLabel: saved.cidr,
        metadata: { cidr: saved.cidr, reason: saved.reason, expiresAt: saved.expiresAt },
        requestId: RequestContext.getTraceId() ?? null,
      }),
    );

    return toIpBlockResponse(saved);
  }

  /**
   * `DELETE /admin/abuse/ip-blocks/:blockId` — lift a block.
   *
   * A soft delete, so `UQ_ip_blocks_cidr` (which carries `WHERE "deletedAt" IS NULL`)
   * frees the range for a future block while the history of who blocked what, and why,
   * survives in the row and in the audit log.
   */
  async removeBlock(admin: ICurrentUser, blockId: string): Promise<void> {
    const block = await this.blocks.findOne({ where: { id: blockId } });
    if (block === null) {
      throw new NotFoundException(ErrorCode.RESOURCE_NOT_FOUND, { details: { blockId } });
    }

    await this.blocks.softDelete({ id: blockId });

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.IP_BLOCK_REMOVED,
        targetType: AUDIT_TARGET_TYPES.IP_BLOCK,
        actorId: admin.id,
        actorRole: admin.role,
        targetId: block.id,
        targetLabel: block.cidr,
        metadata: { cidr: block.cidr, originalReason: block.reason },
        requestId: RequestContext.getTraceId() ?? null,
      }),
    );
  }

  /** Blocks that are in force right now. Used by the A-35 header and by the sweep. */
  async countActiveBlocks(now: Date = new Date()): Promise<number> {
    const [indefinite, timed] = await Promise.all([
      this.blocks.count({ where: { expiresAt: IsNull() } }),
      this.blocks.count({ where: { expiresAt: MoreThan(now) } }),
    ]);
    return indefinite + timed;
  }

  /* -----------------------------------------------------------------------------------------
   * The E-14 anomaly signal
   * -------------------------------------------------------------------------------------- */

  /**
   * Failed authentication attempts grouped by route, over a window.
   *
   * This is the raw material for E-14's "authentication anomalies", and it lives here
   * rather than in `notifications` for the same reason the backlog count does: only the
   * module that can reach the table can see the condition. `IDX_auth_attempts_outcome_createdAt`
   * (§4.7) exists for exactly this shape of query.
   */
  async authAnomaliesSince(since: Date): Promise<AuthAnomalySignal[]> {
    const rows = await this.attempts
      .createQueryBuilder('attempt')
      .select('attempt.route', 'route')
      .addSelect('COUNT(*)', 'failures')
      .addSelect('COUNT(DISTINCT attempt.ip)', 'distinctIps')
      .addSelect('COUNT(DISTINCT attempt.emailHash)', 'distinctAccounts')
      .where('attempt.outcome IN (:...outcomes)', { outcomes: FAILED_OUTCOMES })
      .andWhere('attempt.createdAt >= :since', { since })
      .groupBy('attempt.route')
      .orderBy('COUNT(*)', 'DESC')
      .limit(ABUSE_PAGE_LIMIT)
      .getRawMany<{
        route: string;
        failures: string;
        distinctIps: string;
        distinctAccounts: string;
      }>();

    return rows.map((row) => ({
      route: row.route,
      failures: Number(row.failures),
      distinctIps: Number(row.distinctIps),
      distinctAccounts: Number(row.distinctAccounts),
    }));
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * `auth_attempts`, grouped by account, over the window.
   *
   * `HAVING COUNT(*) >= :min` keeps one mistyped password off an abuse screen, and the
   * `LIMIT` keeps the result set bounded whatever the traffic (§5.18's rule, applied
   * here too).
   */
  private async authFailuresSince(since: Date): Promise<AuthFailureRow[]> {
    return this.attempts
      .createQueryBuilder('attempt')
      .select('attempt.userId', 'userId')
      .addSelect('COUNT(*)', 'failures')
      .addSelect('COUNT(DISTINCT attempt.ip)', 'distinctIps')
      .addSelect('MAX(attempt.createdAt)', 'lastFailureAt')
      .where('attempt.outcome IN (:...outcomes)', { outcomes: FAILED_OUTCOMES })
      .andWhere('attempt.createdAt >= :since', { since })
      .groupBy('attempt.userId')
      .having('COUNT(*) >= :min', { min: ABUSE_MIN_FAILURES })
      .orderBy('COUNT(*)', 'DESC')
      .limit(ABUSE_PAGE_LIMIT)
      .getRawMany<AuthFailureRow>();
  }

  /** `tryon_jobs`, grouped by account, over the window. C-6's "repeated failures". */
  private async generationFailuresSince(since: Date): Promise<GenerationFailureRow[]> {
    return this.jobs
      .createQueryBuilder('job')
      .select('job.userId', 'userId')
      .addSelect('COUNT(*)', 'failures')
      .addSelect('MAX(job.createdAt)', 'lastFailureAt')
      .where('job.status = :status', { status: JobStatus.FAILED })
      .andWhere('job.createdAt >= :since', { since })
      .andWhere('job.deletedAt IS NULL')
      .groupBy('job.userId')
      .having('COUNT(*) >= :min', { min: ABUSE_MIN_FAILURES })
      .orderBy('COUNT(*)', 'DESC')
      .limit(ABUSE_PAGE_LIMIT)
      .getRawMany<GenerationFailureRow>();
  }

  /** Folds the two aggregates into one list, ordered by total failures. */
  private merge(
    authRows: readonly AuthFailureRow[],
    generationRows: readonly GenerationFailureRow[],
  ): {
    userId: string | null;
    authFailures: number;
    generationFailures: number;
    distinctIps: number;
    lastFailureAt: Date;
  }[] {
    const byUser = new Map<
      string,
      {
        userId: string | null;
        authFailures: number;
        generationFailures: number;
        distinctIps: number;
        lastFailureAt: Date;
      }
    >();

    // `null` is a real key here — the unresolved probes — so it is spelled explicitly
    // rather than dropped.
    const keyOf = (userId: string | null): string => userId ?? '__anonymous__';

    for (const row of authRows) {
      byUser.set(keyOf(row.userId), {
        userId: row.userId,
        authFailures: Number(row.failures),
        generationFailures: 0,
        distinctIps: Number(row.distinctIps),
        lastFailureAt: new Date(row.lastFailureAt),
      });
    }

    for (const row of generationRows) {
      const key = keyOf(row.userId);
      const existing = byUser.get(key);
      const lastFailureAt = new Date(row.lastFailureAt);

      if (existing === undefined) {
        byUser.set(key, {
          userId: row.userId,
          authFailures: 0,
          generationFailures: Number(row.failures),
          distinctIps: 0,
          lastFailureAt,
        });
        continue;
      }

      existing.generationFailures = Number(row.failures);
      if (lastFailureAt > existing.lastFailureAt) {
        existing.lastFailureAt = lastFailureAt;
      }
    }

    return [...byUser.values()]
      .sort(
        (a, b) => b.authFailures + b.generationFailures - (a.authFailures + a.generationFailures),
      )
      .slice(0, ABUSE_PAGE_LIMIT);
  }

  /** Which of these accounts an admin has already suspended (A-19). One query, ids only. */
  private async suspendedAmong(userIds: readonly (string | null)[]): Promise<Set<string>> {
    const ids = userIds.filter((id): id is string => id !== null);
    if (ids.length === 0) {
      return new Set();
    }

    const rows = await this.users.find({
      where: { id: In(ids), status: UserStatus.SUSPENDED },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }
}

/**
 * The `auth_attempts.outcome` values that count as a failure (§4.7).
 *
 * Declared once so the abuse view, the anomaly sweep and the platform total can never
 * disagree about what "failure" means — a screen that counts differently from the alert
 * that pages an operator is worse than no screen.
 */
export const FAILED_OUTCOMES: readonly AuthOutcome[] = [
  AuthOutcome.INVALID_CREDENTIALS,
  AuthOutcome.LOCKED,
  AuthOutcome.TWOFA_FAILED,
  AuthOutcome.RATE_LIMITED,
  AuthOutcome.SUSPENDED,
];
