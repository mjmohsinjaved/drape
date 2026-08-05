import { QuotaSnapshotResponseDto, QuotaLedgerEntryResponseDto } from '../dto/quota-response.dto';
import {
  AdminUsageResponseDto,
  BudgetSnapshotResponseDto,
  UsageLedgerEntryResponseDto,
} from '../dto/usage-response.dto';

import type { QuotaLedgerEntry } from '../entities/quota-ledger-entry.entity';
import type { UsageLedgerEntry } from '../entities/usage-ledger-entry.entity';
import type { BudgetSnapshot, UsageOverview } from '../services/budget.service';
import type { QuotaSnapshot } from '../services/quota.service';

/**
 * Derived balances and ledger rows → response DTOs. The only place those shapes are
 * decided (§2.9).
 *
 * Every number that crosses this boundary was summed from an append-only ledger a
 * moment ago. Nothing here reads `usage_ledger.balanceAfter` to build a response
 * field, even though the column is right there and would save an aggregate: §4.27
 * calls it "an advisory snapshot … never the authority", and a DTO field fed from it
 * would be a decision made on a stale number the moment two requests overlapped.
 */

/** `GET /quota/me` (C-5). */
export function toQuotaSnapshot(snapshot: QuotaSnapshot): QuotaSnapshotResponseDto {
  const dto = new QuotaSnapshotResponseDto();
  dto.period = snapshot.period;
  dto.limit = snapshot.limit;
  dto.used = snapshot.used;
  dto.remaining = snapshot.remaining;
  dto.resetsAt = snapshot.resetsAt;
  return dto;
}

/** One `quota_ledger` row for the A-18 view. No stored balance to report — there is none. */
export function toQuotaLedgerEntry(row: QuotaLedgerEntry): QuotaLedgerEntryResponseDto {
  const dto = new QuotaLedgerEntryResponseDto();
  dto.id = row.id;
  dto.delta = row.delta;
  dto.reason = row.reason;
  dto.period = row.period;
  dto.jobId = row.jobId;
  dto.actorId = row.actorId;
  dto.note = row.note;
  dto.createdAt = row.createdAt;
  return dto;
}

/** The A-29 budget position. */
export function toBudgetSnapshot(snapshot: BudgetSnapshot): BudgetSnapshotResponseDto {
  const dto = new BudgetSnapshotResponseDto();
  dto.period = snapshot.period;
  dto.limit = snapshot.limit;
  dto.used = snapshot.used;
  dto.remaining = snapshot.remaining;
  dto.percentUsed = snapshot.percentUsed;
  dto.warnAt = snapshot.warnAt;
  dto.hardStopAt = snapshot.hardStopAt;
  dto.state = snapshot.state;
  dto.resetsAt = snapshot.resetsAt;
  return dto;
}

/** `GET /admin/usage` — the A-33 dashboard. */
export function toAdminUsage(overview: UsageOverview): AdminUsageResponseDto {
  const dto = new AdminUsageResponseDto();
  dto.budget = toBudgetSnapshot(overview.budget);
  dto.consumerGenerations = overview.consumerGenerations;
  dto.testRenders = overview.testRenders;
  dto.trailingDailyRate = overview.trailingDailyRate;
  dto.projectedExhaustionAt = overview.projectedExhaustionAt;
  return dto;
}

/**
 * One `usage_ledger` row for the reconciliation view.
 *
 * `balanceAfter` is carried through because §4.27 says the column exists and the A-33
 * burn-rate chart plots it. It is labelled advisory on the DTO for the same reason it
 * is labelled advisory on the entity: so nobody downstream mistakes a snapshot for the
 * authority.
 */
export function toUsageLedgerEntry(row: UsageLedgerEntry): UsageLedgerEntryResponseDto {
  const dto = new UsageLedgerEntryResponseDto();
  dto.id = row.id;
  dto.delta = row.delta;
  dto.reason = row.reason;
  dto.period = row.period;
  dto.jobId = row.jobId;
  dto.userId = row.userId;
  dto.actorId = row.actorId;
  dto.balanceAfter = row.balanceAfter;
  dto.note = row.note;
  dto.createdAt = row.createdAt;
  return dto;
}
