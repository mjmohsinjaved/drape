/**
 * PRD §8.4 — "Quota and budget decrement only on success", and §8.3 — "Failed jobs
 * never consume quota or budget."
 *
 * This is the contract `modules/tryon` codes against, so the tests are written as the
 * try-on module will actually call it: guard, then generate, then charge — or guard,
 * then fail, and charge nothing. The assertions are on **row counts in both ledgers**
 * rather than on return values, because a return value can be right while a row has
 * quietly been written.
 */
import { type ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { ErrorCode, MetricsService } from '@library/common';

import { type SettingsService } from '@api/modules/settings';
import { type ConsumerProfile } from '@api/modules/users/entities/consumer-profile.entity';

import { createMock } from '../../../../test/fixtures';
import { QuotaLedgerEntry } from '../entities/quota-ledger-entry.entity';
import { UsageLedgerEntry } from '../entities/usage-ledger-entry.entity';
import { QuotaReason } from '../enums/quota-reason.enum';
import { UsageReason } from '../enums/usage-reason.enum';
import {
  createFakeTransactionalDataSource,
  createLedgerRepository,
  type TransactionState,
} from '../testing/quota-fixtures';

import { BudgetService } from './budget.service';
import { GenerationSpendService } from './generation-spend.service';
import { QuotaService } from './quota.service';

import type { InMemoryRepository } from '../../../../test/fixtures';

const CONSUMER_ID = '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c';
const ADMIN_ID = 'cccccccc-1111-4222-8333-444455556666';
const AUGUST = '2026-08';
const NOW = new Date('2026-08-15T12:00:00.000Z');

let sequence = 0;

function quotaRow(overrides: Partial<QuotaLedgerEntry> = {}): QuotaLedgerEntry {
  sequence += 1;
  return Object.assign(new QuotaLedgerEntry(), {
    id: `20000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    createdAt: NOW,
    userId: CONSUMER_ID,
    delta: 0,
    reason: QuotaReason.MONTHLY_GRANT,
    period: AUGUST,
    jobId: null,
    actorId: null,
    note: null,
    ...overrides,
  });
}

function usageRow(overrides: Partial<UsageLedgerEntry> = {}): UsageLedgerEntry {
  sequence += 1;
  return Object.assign(new UsageLedgerEntry(), {
    id: `30000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    createdAt: NOW,
    delta: 0,
    reason: UsageReason.MONTHLY_BUDGET_GRANT,
    period: AUGUST,
    jobId: null,
    userId: null,
    balanceAfter: 0,
    actorId: null,
    note: null,
    ...overrides,
  });
}

interface Harness {
  spend: GenerationSpendService;
  quotaLedger: InMemoryRepository<QuotaLedgerEntry>;
  usageLedger: InMemoryRepository<UsageLedgerEntry>;
  transactions: TransactionState;
}

function build(
  options: {
    quotaRemaining?: number;
    budgetLimit?: number;
    budgetSpent?: number;
    serialise?: boolean;
  } = {},
): Harness {
  const quotaGrant = options.quotaRemaining ?? 15;
  const budgetLimit = options.budgetLimit ?? 1000;
  const budgetSpent = options.budgetSpent ?? 0;

  const quotaLedger = createLedgerRepository<QuotaLedgerEntry>([
    quotaRow({ delta: quotaGrant, reason: QuotaReason.MONTHLY_GRANT }),
  ]);
  const usageLedger = createLedgerRepository<UsageLedgerEntry>([
    usageRow({ delta: budgetLimit, reason: UsageReason.MONTHLY_BUDGET_GRANT }),
    ...Array.from({ length: budgetSpent }, () =>
      usageRow({ delta: -1, reason: UsageReason.CONSUMER_GENERATION, userId: CONSUMER_ID }),
    ),
  ]);
  const profiles = createLedgerRepository<ConsumerProfile>([]);

  const { dataSource, transactions } = createFakeTransactionalDataSource({
    repositories: new Map<unknown, unknown>([
      [QuotaLedgerEntry, quotaLedger],
      [UsageLedgerEntry, usageLedger],
    ]),
    ...(options.serialise === undefined ? {} : { serialise: options.serialise }),
  });

  const settings = createMock<SettingsService>(['getNumber', 'getBudgetPolicy']);
  settings.getNumber.mockResolvedValue(15);
  settings.getBudgetPolicy.mockResolvedValue({
    monthlyGenerations: budgetLimit,
    warnThresholdPercent: 80,
    warnAt: Math.floor(budgetLimit * 0.8),
    hardStopAt: budgetLimit,
  });

  const config = createMock<ConfigService>(['get']);
  config.get.mockReturnValue('Asia/Karachi');

  const metrics = new MetricsService();
  const events = new EventEmitter2();

  const quota = new QuotaService(
    quotaLedger,
    profiles,
    dataSource,
    settings,
    config,
    metrics,
    events,
  );
  const budget = new BudgetService(usageLedger, dataSource, settings, config, metrics, events);

  return {
    spend: new GenerationSpendService(dataSource, quota, budget),
    quotaLedger,
    usageLedger,
    transactions,
  };
}

/** Rows that represent spend, ignoring the grants the harness seeded. */
function spendRows<T extends { delta: number }>(repository: InMemoryRepository<T>): T[] {
  return repository.$rows.filter((row) => row.delta < 0);
}

describe('GenerationSpendService — the guard chain reads only (§8.1 step 3)', () => {
  it('passes and writes to neither ledger', async () => {
    const { spend, quotaLedger, usageLedger } = build();
    const before = [quotaLedger.$rows.length, usageLedger.$rows.length];

    const allowance = await spend.assertCanGenerate(CONSUMER_ID, 'CONSUMER', NOW);

    expect(allowance.quota?.remaining).toBe(15);
    expect(allowance.budget.remaining).toBe(1000);
    expect([quotaLedger.$rows.length, usageLedger.$rows.length]).toEqual(before);
  });

  it('reports the consumer’s own quota before the platform budget (§8.1 order)', async () => {
    // Both are exhausted. She should be told about her own allowance — which is
    // actionable — rather than about the platform's capacity, which is not.
    const { spend } = build({ quotaRemaining: 0, budgetLimit: 100, budgetSpent: 100 });

    await expect(spend.assertCanGenerate(CONSUMER_ID, 'CONSUMER', NOW)).rejects.toMatchObject({
      errorCode: ErrorCode.QUOTA_EXHAUSTED,
    });
  });

  it('checks only the budget for an admin test render — nobody’s quota pays for it', async () => {
    const { spend } = build({ quotaRemaining: 0 });

    const allowance = await spend.assertCanGenerate(null, 'TEST_RENDER', NOW);

    expect(allowance.quota).toBeNull();
    expect(allowance.budget.remaining).toBe(1000);
  });
});

describe('GenerationSpendService — charging on success (§8.4)', () => {
  it('writes exactly one row to each ledger, in one transaction', async () => {
    const { spend, quotaLedger, usageLedger, transactions } = build();

    const charge = await spend.chargeSuccess({
      jobId: 'job-1',
      origin: 'CONSUMER',
      userId: CONSUMER_ID,
      period: AUGUST,
    });

    expect(charge.quota?.remaining).toBe(14);
    expect(charge.budget.remaining).toBe(999);

    expect(spendRows(quotaLedger)).toHaveLength(1);
    expect(spendRows(usageLedger)).toHaveLength(1);
    expect(transactions.started).toBe(1);
    expect(transactions.committed).toBe(1);
    expect(transactions.isolationLevels).toEqual(['SERIALIZABLE']);
  });

  it('charges a test render to the budget only', async () => {
    const { spend, quotaLedger, usageLedger } = build();

    await spend.chargeSuccess({
      jobId: 'job-test',
      origin: 'TEST_RENDER',
      userId: null,
      actorId: ADMIN_ID,
      period: AUGUST,
    });

    expect(spendRows(quotaLedger)).toHaveLength(0);
    expect(spendRows(usageLedger)).toHaveLength(1);
    expect(usageLedger.$rows.at(-1)).toMatchObject({
      reason: UsageReason.TEST_RENDER,
      actorId: ADMIN_ID,
    });
  });

  it('leaves both ledgers untouched when the quota half refuses', async () => {
    // The two inserts are one transaction, so a refusal on the first must not leave
    // the platform charged for a generation the consumer was never allowed.
    const { spend, quotaLedger, usageLedger, transactions } = build({ quotaRemaining: 0 });

    await expect(
      spend.chargeSuccess({
        jobId: 'job-1',
        origin: 'CONSUMER',
        userId: CONSUMER_ID,
        period: AUGUST,
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.QUOTA_EXHAUSTED });

    expect(spendRows(quotaLedger)).toHaveLength(0);
    expect(spendRows(usageLedger)).toHaveLength(0);
    expect(transactions.rolledBack).toBe(1);
    expect(transactions.committed).toBe(0);
  });

  it('never lets two simultaneous charges both succeed at remaining = 1', async () => {
    const { spend, quotaLedger, usageLedger } = build({ quotaRemaining: 1, serialise: true });

    const results = await Promise.allSettled([
      spend.chargeSuccess({
        jobId: 'race-a',
        origin: 'CONSUMER',
        userId: CONSUMER_ID,
        period: AUGUST,
      }),
      spend.chargeSuccess({
        jobId: 'race-b',
        origin: 'CONSUMER',
        userId: CONSUMER_ID,
        period: AUGUST,
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    // One generation charged, in both ledgers. Not two, and not one-and-a-half.
    expect(spendRows(quotaLedger)).toHaveLength(1);
    expect(spendRows(usageLedger)).toHaveLength(1);
  });
});

describe('GenerationSpendService — a failed generation costs nothing (§8.3)', () => {
  it('charges nothing when the job fails before the charge — the ordinary path', async () => {
    const { spend, quotaLedger, usageLedger } = build();

    // The guard passed, then the upstream returned "no garment detected". The try-on
    // module never reaches chargeSuccess; it calls releaseOnFailure defensively.
    await spend.assertCanGenerate(CONSUMER_ID, 'CONSUMER', NOW);
    const release = await spend.releaseOnFailure({ jobId: 'job-failed', userId: CONSUMER_ID });

    expect(release).toEqual({ quotaRefunded: false, budgetRefunded: false });
    expect(spendRows(quotaLedger)).toHaveLength(0);
    expect(spendRows(usageLedger)).toHaveLength(0);
  });

  it('is safe to call twice on a failure — it writes nothing either time', async () => {
    const { spend, quotaLedger, usageLedger } = build();

    await spend.releaseOnFailure({ jobId: 'job-failed', userId: CONSUMER_ID });
    await spend.releaseOnFailure({ jobId: 'job-failed', userId: CONSUMER_ID });

    expect(quotaLedger.$rows).toHaveLength(1);
    expect(usageLedger.$rows).toHaveLength(1);
  });

  it('reverses both ledgers when a step after the charge failed', async () => {
    const { spend, quotaLedger, usageLedger } = build();

    await spend.chargeSuccess({
      jobId: 'job-1',
      origin: 'CONSUMER',
      userId: CONSUMER_ID,
      period: AUGUST,
    });

    const release = await spend.releaseOnFailure({
      jobId: 'job-1',
      userId: CONSUMER_ID,
      reason: 'Render could not be stored',
    });

    expect(release).toEqual({ quotaRefunded: true, budgetRefunded: true });

    // Compensating rows, not deletions: the ledgers are append-only (§2.1).
    expect(quotaLedger.$rows.filter((row) => row.jobId === 'job-1')).toHaveLength(1);
    expect(quotaLedger.$rows.at(-1)).toMatchObject({ delta: 1, jobId: null });
    expect(usageLedger.$rows.at(-1)).toMatchObject({ delta: 1, jobId: null });
  });

  it('never throws out of a release — it runs while something has already gone wrong', async () => {
    const { spend, quotaLedger } = build();
    jest.spyOn(quotaLedger, 'findOne').mockRejectedValueOnce(new Error('connection reset'));

    await expect(spend.releaseOnFailure({ jobId: 'job-1', userId: CONSUMER_ID })).resolves.toEqual({
      quotaRefunded: false,
      budgetRefunded: false,
    });
  });
});
