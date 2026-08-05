import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';

import { buildPaginationMeta, redactObject, type IPaginated } from '@library/common';

import { AUDIT_ACTION_VALUES } from '@api/shared/constants/audit-actions.constant';

import { AuditActionsResponseDto, AuditLogResponseDto } from '../dto/audit-log-response.dto';
import { AUDIT_TARGET_TYPE_VALUES, AuditQueryDto } from '../dto/audit-query.dto';
import { AuditLogEntry } from '../entities/audit-log-entry.entity';
import { toAuditLogResponse } from '../mappers/audit.mapper';

import type { AuditRecordInput } from '../events/audit.event';
import type { FindOptionsWhere } from 'typeorm';

/** `audit_log.userAgent` is `varchar(512)` (§4.30). */
const MAX_USER_AGENT_LENGTH = 512;

/** `audit_log.targetLabel` is `varchar(160)` (§4.30). */
const MAX_TARGET_LABEL_LENGTH = 160;

/**
 * A-3 — the append-only action log.
 *
 * Two entry points on purpose:
 *
 *  - **`record()`** for the synchronous case, where the caller must know the row
 *    landed before it answers (a moderation-queue view, which A-34 audits as part of
 *    the read itself).
 *  - **the `@OnEvent` listener**, for everything else. §2.9 rule 4: audit rows are
 *    written by a listener in this module, not inline in each feature service, so a
 *    module never has to import `AuditService` to be audited.
 *
 * Rows are `INSERT`ed and read. There is no update path and no delete path here, and
 * the migration adds the §2.1 `DO INSTEAD NOTHING` rules underneath so the database
 * refuses one too.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLogEntry)
    private readonly entries: Repository<AuditLogEntry>,
  ) {}

  /**
   * Appends one row.
   *
   * `metadata` passes through `@library/common`'s `redact()` first (E-12, §4.30): a
   * caller that hands over a before/after diff containing a storage key, an email, a
   * phone number or a token gets the redacted form stored, not the raw one.
   *
   * Returns nothing. An audit row is a record of fact, not a resource the caller
   * reads back — and returning the entity would put a raw entity in a service result.
   */
  async record(input: AuditRecordInput): Promise<void> {
    if (!AUDIT_ACTION_VALUES.includes(input.action)) {
      // Closed registry (§4.30). A typo'd action would make the A-3 filter lie about
      // what is in the log, which is worse than a loud failure at the call site.
      throw new Error(
        `"${String(input.action)}" is not in the AUDIT_ACTIONS registry. Add it to ` +
          'shared/constants/audit-actions.constant.ts in the same pull request.',
      );
    }

    const entry = this.entries.create({
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      targetLabel: truncate(input.targetLabel, MAX_TARGET_LABEL_LENGTH),
      metadata: redactObject(input.metadata) ?? {},
      ip: input.ip ?? null,
      userAgent: truncate(input.userAgent, MAX_USER_AGENT_LENGTH),
      requestId: input.requestId ?? null,
    });

    // `save()` on a *new* instance is an INSERT. §2.1's prohibition is on calling it
    // against a **loaded** append-only row, which would issue an UPDATE; nothing here
    // has ever been read back. `insert()` cannot be used: its
    // `QueryDeepPartialEntity` parameter type rejects a `jsonb` column declared as
    // `Record<string, unknown>`.
    await this.entries.save(entry);
  }

  /**
   * `record()` for the event listener: an audit write must never take down the
   * request that triggered it. The failure is logged at `error` with the action, so
   * a gap in the log is visible in the log.
   */
  async recordSafely(input: AuditRecordInput): Promise<void> {
    try {
      await this.record(input);
    } catch (error) {
      this.logger.error(
        `Failed to write audit row for ${String(input.action)}.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** `GET /admin/audit` — filter by actor, action and date range, paginated (§2.8). */
  async query(query: AuditQueryDto): Promise<IPaginated<AuditLogResponseDto>> {
    const where: FindOptionsWhere<AuditLogEntry> = {};

    if (query.actorId !== undefined) {
      where.actorId = query.actorId;
    }
    if (query.action !== undefined) {
      where.action = query.action;
    }
    if (query.targetType !== undefined) {
      where.targetType = query.targetType;
    }
    if (query.targetId !== undefined) {
      where.targetId = query.targetId;
    }

    const createdAt = dateRange(query.from, query.to);
    if (createdAt !== undefined) {
      where.createdAt = createdAt;
    }

    const [rows, total] = await this.entries.findAndCount({
      where,
      // `sortBy` came through `@IsIn(AUDIT_SORTABLE_COLUMNS)` on the DTO, so this
      // index is over an allow-listed key and never over client-supplied text.
      order: { [query.sortBy]: query.sortOrder, id: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return { items: rows.map(toAuditLogResponse), meta: buildPaginationMeta(query, total) };
  }

  /** `GET /admin/audit/actions` — the closed registries, for the filter dropdowns. */
  listActions(): AuditActionsResponseDto {
    const dto = new AuditActionsResponseDto();
    dto.actions = [...AUDIT_ACTION_VALUES];
    dto.targetTypes = [...AUDIT_TARGET_TYPE_VALUES];
    return dto;
  }
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return value.length > max ? value.slice(0, max) : value;
}

/** `createdAt` bound for whichever of `from` / `to` the caller supplied. */
function dateRange(
  from: string | undefined,
  to: string | undefined,
): FindOptionsWhere<AuditLogEntry>['createdAt'] {
  const start = from === undefined ? undefined : new Date(from);
  const end = to === undefined ? undefined : new Date(to);

  if (start !== undefined && end !== undefined) {
    return Between(start, end);
  }
  if (start !== undefined) {
    return MoreThanOrEqual(start);
  }
  if (end !== undefined) {
    return LessThanOrEqual(end);
  }
  return undefined;
}
