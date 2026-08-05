/**
 * PRD A-29, A-33, E-14 · ARCHITECTURE §4.27 — the system-wide monthly budget.
 *
 * The thresholds are the point. A-29 says "a soft warning at 80% and a hard stop at
 * 100%", and the three cases that pin that down are *exactly* 80, *exactly* 100, and
 * 99.9 — one generation short of the ceiling, where an off-by-one closes the fitting
 * room a try-on early.
 */
import { type ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  ErrorCode,
  Locale,
  MetricsService,
  Role,
  UserStatus,
  type ICurrentUser,
} from '@library/common';

import { type SettingsService } from '@api/modules/settings';

import { createMock } from '../../../../test/fixtures';
import { UsageLedgerEntry } from '../entities/usage-ledger-entry.entity';
import { UsageReason } from '../enums/usage-reason.enum';
import { QUOTA_EVENTS, type BudgetThresholdEvent } from '../events/quota.events';
import {
  createFakeTransactionalDataSource,
  createLedgerRepository,
  type TransactionState,
} from '../testing/quota-fixtures';
import { BUDGET_STATES } from '../utils/ledger-math';

import { BudgetService } from './budget.service';

import type { InMemoryRepository } from '../../../../test/fixtures';
import type { EntityManager } from 'typeorm';

const AUGUST = '2026-08';
const NOW = new Date('2026-08-15T12:00:00.000Z');
const CONSUMER_ID = '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c';

const ADMIN: ICurrentUser = {
  id: 'cccccccc-1111-4222-8333-444455556666',
  role: Role.ADMIN,
  email: 'admin@example.com',
  name: 'Studio Admin',
  status: UserStatus.ACTIVE,
  emailVerifiedAt: NOW,
  phoneVerifiedAt: null,
  sessionId: 'dddddddd-1111-4222-8333-444455556666',
  locale: Locale.EN,
};

let sequence = 0;

function usageRow(overrides: Partial<UsageLedgerEntry> = {}): UsageLedgerEntry {
  sequence += 1;
  return Object.assign(new UsageLedgerEntry(), {
    id: `10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
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

/** A budget grant plus `spent` consumer generations — the shape every threshold test wants. */
function ledgerAt(limit: number, spent: number, createdAt: Date = NOW): UsageLedgerEntry[] {
  return [
    usageRow({ delta: limit, reason: UsageReason.MONTHLY_BUDGET_GRANT }),
    ...Array.from({ length: spent }, () =>
      usageRow({
        delta: -1,
        reason: UsageReason.CONSUMER_GENERATION,
        userId: CONSUMER_ID,
        createdAt,
      }),
    ),
  ];
}

interface Harness {
  service: BudgetService;
  ledger: InMemoryRepository<UsageLedgerEntry>;
  transactions: TransactionState;
  events: EventEmitter2;
}

function build(
  options: {
    rows?: readonly UsageLedgerEntry[];
    monthlyGenerations?: number;
    warnThresholdPercent?: number;
  } = {},
): Harness {
  const ledger = createLedgerRepository<UsageLedgerEntry>(options.rows ?? []);

  const { dataSource, transactions } = createFakeTransactionalDataSource({
    repositories: new Map<unknown, unknown>([[UsageLedgerEntry, ledger]]),
  });

  const monthlyGenerations = options.monthlyGenerations ?? 1000;
  const warnThresholdPercent = options.warnThresholdPercent ?? 80;

  const settings = createMock<SettingsService>(['getBudgetPolicy']);
  settings.getBudgetPolicy.mockResolvedValue({
    monthlyGenerations,
    warnThresholdPercent,
    warnAt: Math.floor((monthlyGenerations * warnThresholdPercent) / 100),
    hardStopAt: monthlyGenerations,
  });

  const config = createMock<ConfigService>(['get']);
  config.get.mockReturnValue('Asia/Karachi');

  const events = new EventEmitter2();

  const service = new BudgetService(
    ledger,
    dataSource,
    settings,
    config,
    new MetricsService(),
    events,
  );

  return { service, ledger, transactions, events };
}

describe('BudgetService — the A-29 thresholds', () => {
  it('is OK below 80%', async () => {
    const { service } = build({ rows: ledgerAt(1000, 799) });

    await expect(service.getSnapshot(NOW)).resolves.toMatchObject({
      used: 799,
      remaining: 201,
      state: BUDGET_STATES.OK,
      warnAt: 800,
      hardStopAt: 1000,
    });
  });

  it('warns at exactly 80%', async () => {
    const { service } = build({ rows: ledgerAt(1000, 800) });

    await expect(service.getSnapshot(NOW)).resolves.toMatchObject({
      used: 800,
      percentUsed: 80,
      state: BUDGET_STATES.WARNING,
    });
  });

  it('does not hard-stop at 99.9%', async () => {
    const { service } = build({ rows: ledgerAt(1000, 999) });

    const snapshot = await service.getSnapshot(NOW);

    expect(snapshot.percentUsed).toBe(99.9);
    expect(snapshot.state).toBe(BUDGET_STATES.WARNING);
    // And the guard lets the generation through.
    await expect(service.assertBudgetAvailable(NOW)).resolves.toMatchObject({ remaining: 1 });
  });

  it('hard-stops at exactly 100%', async () => {
    const { service } = build({ rows: ledgerAt(1000, 1000) });

    await expect(service.getSnapshot(NOW)).resolves.toMatchObject({
      used: 1000,
      remaining: 0,
      percentUsed: 100,
      state: BUDGET_STATES.EXHAUSTED,
    });

    await expect(service.assertBudgetAvailable(NOW)).rejects.toMatchObject({
      errorCode: ErrorCode.BUDGET_EXHAUSTED,
    });
  });

  it('returns the §8.3 message verbatim on the hard stop', async () => {
    const { service } = build({ rows: ledgerAt(1000, 1000) });

    await expect(service.assertBudgetAvailable(NOW)).rejects.toMatchObject({
      message: "Our fitting room is at capacity today — we'll email you when it's back.",
    });
  });

  it('writes nothing when it refuses — a hard stop is a read', async () => {
    const { service, ledger } = build({ rows: ledgerAt(1000, 1000) });
    const before = ledger.$rows.length;

    await expect(service.assertBudgetAvailable(NOW)).rejects.toBeDefined();

    expect(ledger.$rows).toHaveLength(before);
  });
});

describe('BudgetService — the lazy grant reconciles to the setting', () => {
  it('materialises the monthly grant on the first read of a period', async () => {
    const { service, ledger } = build({ monthlyGenerations: 2000 });

    const snapshot = await service.getSnapshot(NOW);

    expect(snapshot.limit).toBe(2000);
    expect(ledger.$rows).toHaveLength(1);
    expect(ledger.$rows[0]).toMatchObject({
      delta: 2000,
      reason: UsageReason.MONTHLY_BUDGET_GRANT,
    });
  });

  it('applies a mid-period raise immediately, as a further grant row', async () => {
    const { service, ledger } = build({ rows: ledgerAt(1000, 900), monthlyGenerations: 1500 });

    const snapshot = await service.getSnapshot(NOW);

    expect(snapshot.limit).toBe(1500);
    expect(snapshot.remaining).toBe(600);
    expect(ledger.$rows.at(-1)).toMatchObject({
      delta: 500,
      reason: UsageReason.MONTHLY_BUDGET_GRANT,
    });
  });

  it('applies a mid-period reduction immediately too — a ceiling binds when it is set', async () => {
    // Unlike a consumer's quota, a budget is a cost control. An admin who lowers it at
    // 3pm because the month is running hot means it to bind at 3pm.
    const { service } = build({ rows: ledgerAt(1000, 900), monthlyGenerations: 900 });

    await expect(service.getSnapshot(NOW)).resolves.toMatchObject({
      limit: 900,
      used: 900,
      remaining: 0,
      state: BUDGET_STATES.EXHAUSTED,
    });
  });

  it('writes no reconciliation row when the grant already matches', async () => {
    const { service, ledger, transactions } = build({
      rows: ledgerAt(1000, 10),
      monthlyGenerations: 1000,
    });
    const before = ledger.$rows.length;

    await service.getSnapshot(NOW);

    expect(ledger.$rows).toHaveLength(before);
    expect(transactions.started).toBe(0);
  });
});

describe('BudgetService — consumption (§8.4)', () => {
  it('appends a -1 row with the A-33 reason and an advisory balanceAfter', async () => {
    const { service, ledger } = build({ rows: ledgerAt(1000, 10) });

    const charge = await inTransaction(service, (manager) =>
      service.consumeWithin(manager, {
        jobId: 'job-1',
        period: AUGUST,
        reason: UsageReason.CONSUMER_GENERATION,
        userId: CONSUMER_ID,
      }),
    );

    expect(charge.before.used).toBe(10);
    expect(charge.after.used).toBe(11);
    expect(ledger.$rows.at(-1)).toMatchObject({
      delta: -1,
      reason: UsageReason.CONSUMER_GENERATION,
      jobId: 'job-1',
      userId: CONSUMER_ID,
      balanceAfter: 989,
    });
  });

  it('refuses to charge past the hard stop, and writes nothing', async () => {
    const { service, ledger } = build({ rows: ledgerAt(1000, 1000) });
    const before = ledger.$rows.length;

    await expect(
      inTransaction(service, (manager) =>
        service.consumeWithin(manager, {
          jobId: 'job-over',
          period: AUGUST,
          reason: UsageReason.CONSUMER_GENERATION,
          userId: CONSUMER_ID,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.BUDGET_EXHAUSTED });

    expect(ledger.$rows).toHaveLength(before);
  });

  it('charges a test render to the budget under its own reason (A-33)', async () => {
    const { service, ledger } = build({ rows: ledgerAt(1000, 0) });

    await inTransaction(service, (manager) =>
      service.consumeWithin(manager, {
        jobId: 'job-test',
        period: AUGUST,
        reason: UsageReason.TEST_RENDER,
        userId: null,
        actorId: ADMIN.id,
      }),
    );

    expect(ledger.$rows.at(-1)).toMatchObject({
      reason: UsageReason.TEST_RENDER,
      actorId: ADMIN.id,
    });
  });
});

describe('BudgetService — E-14 events fire on the crossing', () => {
  it('emits the warning exactly once, on the generation that reaches 80%', async () => {
    const { service, events } = build({ rows: ledgerAt(1000, 799) });
    const warnings: BudgetThresholdEvent[] = [];
    events.on(QUOTA_EVENTS.BUDGET_WARNING_REACHED, (payload: BudgetThresholdEvent) =>
      warnings.push(payload),
    );

    const crossing = await inTransaction(service, (manager) =>
      service.consumeWithin(manager, {
        jobId: 'job-800',
        period: AUGUST,
        reason: UsageReason.CONSUMER_GENERATION,
        userId: CONSUMER_ID,
      }),
    );
    service.emitThresholdEvents(crossing);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ used: 800, percentUsed: 80, state: BUDGET_STATES.WARNING });

    // The next generation is above the threshold but does not cross it, so it is silent.
    const after = await inTransaction(service, (manager) =>
      service.consumeWithin(manager, {
        jobId: 'job-801',
        period: AUGUST,
        reason: UsageReason.CONSUMER_GENERATION,
        userId: CONSUMER_ID,
      }),
    );
    service.emitThresholdEvents(after);

    expect(warnings).toHaveLength(1);
  });

  it('emits the exhaustion event on the generation that reaches 100%', async () => {
    const { service, events } = build({ rows: ledgerAt(1000, 999) });
    const exhausted: BudgetThresholdEvent[] = [];
    events.on(QUOTA_EVENTS.BUDGET_EXHAUSTED, (payload: BudgetThresholdEvent) =>
      exhausted.push(payload),
    );

    const crossing = await inTransaction(service, (manager) =>
      service.consumeWithin(manager, {
        jobId: 'job-1000',
        period: AUGUST,
        reason: UsageReason.CONSUMER_GENERATION,
        userId: CONSUMER_ID,
      }),
    );
    service.emitThresholdEvents(crossing);

    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]).toMatchObject({
      used: 1000,
      remaining: 0,
      state: BUDGET_STATES.EXHAUSTED,
    });
  });
});

describe('BudgetService — refunds', () => {
  it('does nothing when the job was never charged', async () => {
    const { service, ledger } = build({ rows: ledgerAt(1000, 5) });
    const before = ledger.$rows.length;

    const result = await inTransaction(service, (manager) =>
      service.refundWithin(manager, { jobId: 'never-charged' }),
    );

    expect(result.refunded).toBe(false);
    expect(ledger.$rows).toHaveLength(before);
  });

  it('reverses a charge without reusing the jobId (UQ_usage_ledger_job)', async () => {
    const rows = [
      ...ledgerAt(1000, 0),
      usageRow({
        delta: -1,
        reason: UsageReason.CONSUMER_GENERATION,
        jobId: 'job-1',
        userId: CONSUMER_ID,
        balanceAfter: 999,
      }),
    ];
    const { service, ledger } = build({ rows });

    const result = await inTransaction(service, (manager) =>
      service.refundWithin(manager, { jobId: 'job-1', reason: 'Render could not be stored' }),
    );

    expect(result.refunded).toBe(true);
    expect(result.snapshot.remaining).toBe(1000);
    expect(ledger.$rows.at(-1)).toMatchObject({ delta: 1, jobId: null });
  });
});

describe('BudgetService — the A-33 dashboard', () => {
  it('splits consumer demand from test renders and projects from the trailing rate', async () => {
    const withinWindow = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
    const rows = [
      usageRow({ delta: 1000, reason: UsageReason.MONTHLY_BUDGET_GRANT }),
      ...Array.from({ length: 70 }, () =>
        usageRow({
          delta: -1,
          reason: UsageReason.CONSUMER_GENERATION,
          userId: CONSUMER_ID,
          createdAt: withinWindow,
        }),
      ),
      ...Array.from({ length: 7 }, () =>
        usageRow({
          delta: -1,
          reason: UsageReason.TEST_RENDER,
          createdAt: withinWindow,
        }),
      ),
    ];
    const { service } = build({ rows });

    const overview = await service.overview(NOW);

    expect(overview.consumerGenerations).toBe(70);
    expect(overview.testRenders).toBe(7);
    expect(overview.trailingDailyRate).toBe(11);
    expect(overview.budget.remaining).toBe(923);
    // 923 remaining at 11/day is 84 days — well past the period boundary, so there is
    // no exhaustion to project.
    expect(overview.projectedExhaustionAt).toBeNull();
  });

  it('projects an exhaustion date when the burn rate would reach it inside the period', async () => {
    const withinWindow = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000);
    const rows = [
      usageRow({ delta: 1000, reason: UsageReason.MONTHLY_BUDGET_GRANT }),
      ...Array.from({ length: 980 }, () =>
        usageRow({
          delta: -1,
          reason: UsageReason.CONSUMER_GENERATION,
          userId: CONSUMER_ID,
          createdAt: withinWindow,
        }),
      ),
    ];
    const { service } = build({ rows });

    const overview = await service.overview(NOW);

    expect(overview.budget.remaining).toBe(20);
    expect(overview.projectedExhaustionAt).toBeInstanceOf(Date);
    expect(overview.projectedExhaustionAt?.getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe('BudgetService — admin adjustment', () => {
  it('appends an ADMIN_ADJUSTMENT row with the actor and a note', async () => {
    const { service, ledger } = build({ rows: ledgerAt(1000, 100) });

    const snapshot = await service.adjust(ADMIN, { delta: 200, note: 'Campaign week.' });

    expect(snapshot.remaining).toBe(1100);
    expect(ledger.$rows.at(-1)).toMatchObject({
      delta: 200,
      reason: UsageReason.ADMIN_ADJUSTMENT,
      actorId: ADMIN.id,
      note: 'Campaign week.',
    });
  });

  it('refuses an adjustment that would take the budget below zero', async () => {
    const { service, ledger } = build({ rows: ledgerAt(1000, 900) });
    const before = ledger.$rows.length;

    await expect(service.adjust(ADMIN, { delta: -500 })).rejects.toMatchObject({
      errorCode: ErrorCode.QUOTA_ADJUSTMENT_INVALID,
    });
    expect(ledger.$rows).toHaveLength(before);
  });
});

describe('BudgetService — what the guard chain pays for (PRD §9.1)', () => {
  it('reads usage_ledger exactly once per budget check', async () => {
    // §8.1 step 3 runs on *every* generation, against a table that grows forever, inside a
    // p95 budget of 400 ms for a cache hit. `remaining`, `limit` and the monthly grant total
    // used to be three separate aggregates; they are one grouped scan.
    const { service, ledger } = build({ rows: ledgerAt(1000, 10) });
    const scans = jest.mocked(ledger.createQueryBuilder);
    scans.mockClear();

    await service.assertBudgetAvailable(NOW);

    expect(scans).toHaveBeenCalledTimes(1);
  });

  it('re-reads only when the lazy grant actually wrote a row', async () => {
    const { service, ledger } = build({ rows: ledgerAt(1000, 10), monthlyGenerations: 1500 });
    const scans = jest.mocked(ledger.createQueryBuilder);
    scans.mockClear();

    await service.getSnapshot(NOW);

    // One to notice the grant is stale, one inside the reconciling transaction, one after.
    expect(scans.mock.calls.length).toBeGreaterThan(1);
    expect(ledger.$rows.at(-1)).toMatchObject({ delta: 500 });
  });

  it('answers the whole A-33 dashboard from the same single scan', async () => {
    const { service, ledger } = build({ rows: ledgerAt(1000, 10) });
    const scans = jest.mocked(ledger.createQueryBuilder);
    scans.mockClear();

    await service.overview(NOW);

    // The splits and the trailing burn are conditional aggregates over the rows the
    // snapshot already read — not three more queries.
    expect(scans).toHaveBeenCalledTimes(1);
  });
});

/** Runs a manager-taking method through the service's own transactional wrapper. */
async function inTransaction<T>(
  service: BudgetService,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const runner = service as unknown as {
    runSerializable(label: string, work: (manager: EntityManager) => Promise<T>): Promise<T>;
  };
  return runner.runSerializable('spec', work);
}
