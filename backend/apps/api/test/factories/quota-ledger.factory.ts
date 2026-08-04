import { QuotaLedgerEntry } from '@api/modules/quota/entities/quota-ledger-entry.entity';
import { QuotaReason } from '@api/modules/quota/enums/quota-reason.enum';

import { FIXED_NOW } from '../setup/time';

import { buildEntity, periodOf, uuid } from './factory.support';

/**
 * `quota_ledger` (§4.26) — append-only.
 *
 * **There is no stored balance.** Remaining quota is
 * `SELECT COALESCE(SUM(delta), 0) FROM quota_ledger WHERE "userId" = $1 AND period = $2`,
 * derived at read time, every time (§4.0 rule 10). If a test needs a consumer with four
 * generations left, it builds a `+15` grant and eleven `-1` consumptions — it does not set a
 * number somewhere, because there is no number to set.
 *
 * Two structural facts worth remembering while writing those tests:
 *
 *  - The entity extends `AppendOnlyEntity`: `id` and `createdAt` only. No `updatedAt`, no
 *    `deletedAt`, and the migration adds `DO INSTEAD NOTHING` rules for UPDATE and DELETE.
 *  - `UQ_quota_ledger_job UNIQUE ("jobId") WHERE "jobId" IS NOT NULL` carries no `deletedAt`
 *    predicate, because there is no such column. That index is what makes a double
 *    consumption physically impossible — so `buildQuotaConsumption()` always takes a jobId.
 */
export function buildQuotaLedgerEntry(overrides: Partial<QuotaLedgerEntry> = {}): QuotaLedgerEntry {
  return buildEntity<QuotaLedgerEntry>(
    QuotaLedgerEntry,
    {
      id: uuid(),
      createdAt: FIXED_NOW,

      userId: uuid(),
      delta: 1,
      reason: QuotaReason.MONTHLY_GRANT,
      period: periodOf(FIXED_NOW),
      jobId: null,
      actorId: null,
      note: null,
    },
    overrides,
  );
}

/**
 * The lazy monthly grant (§4.26): inserted by the first quota read in a new period, for
 * `consumer_profiles.monthlyQuotaOverride ?? settings['quota.defaultMonthly']`.
 */
export function buildMonthlyGrant(
  userId: string,
  amount = 15,
  overrides: Partial<QuotaLedgerEntry> = {},
): QuotaLedgerEntry {
  return buildQuotaLedgerEntry({
    userId,
    delta: amount,
    reason: QuotaReason.MONTHLY_GRANT,
    ...overrides,
  });
}

/**
 * A raised override applied mid-period (A-18): appends the *difference* as a separate row.
 * It never rewrites the earlier grant — that is the whole point of an append-only ledger.
 */
export function buildOverrideGrant(
  userId: string,
  difference: number,
  overrides: Partial<QuotaLedgerEntry> = {},
): QuotaLedgerEntry {
  return buildQuotaLedgerEntry({
    userId,
    delta: difference,
    reason: QuotaReason.OVERRIDE_GRANT,
    actorId: uuid(),
    note: 'Raised for an upcoming event.',
    ...overrides,
  });
}

/** One generation consumed. Always -1, always tied to the job whose unique index guards it. */
export function buildQuotaConsumption(
  userId: string,
  jobId: string,
  overrides: Partial<QuotaLedgerEntry> = {},
): QuotaLedgerEntry {
  return buildQuotaLedgerEntry({
    userId,
    delta: -1,
    reason: QuotaReason.GENERATION_CONSUMED,
    jobId,
    ...overrides,
  });
}

/**
 * A full period for one consumer: the monthly grant plus `consumed` generations.
 *
 * Remaining quota is whatever `SUM(delta)` over the returned rows comes to — assert on that,
 * not on a count.
 */
export function buildQuotaPeriod(userId: string, granted = 15, consumed = 0): QuotaLedgerEntry[] {
  return [
    buildMonthlyGrant(userId, granted),
    ...Array.from({ length: consumed }, () => buildQuotaConsumption(userId, uuid())),
  ];
}
