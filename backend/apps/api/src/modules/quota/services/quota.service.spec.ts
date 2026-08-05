/**
 * PRD C-5, A-18, A-28, §8.4 · ARCHITECTURE §4.26 — the per-consumer quota ledger.
 *
 * The three things worth proving here, in descending order of how much damage getting
 * them wrong would do:
 *
 *  1. **Two simultaneous consumptions at `remaining = 1` cannot both succeed.** Proved
 *     against the transactional path, with a `DataSource` double that serialises
 *     transactions the way row and predicate locks do — not by hoping the two calls
 *     happen to run apart.
 *  2. **A mid-period override raise is available immediately**, as an appended row,
 *     with the original grant untouched.
 *  3. **Nothing is charged on a failure**, and every balance is a sum rather than a
 *     column.
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
import { ConsumerProfile } from '@api/modules/users/entities/consumer-profile.entity';

import { createMock } from '../../../../test/fixtures';
import { QuotaLedgerEntry } from '../entities/quota-ledger-entry.entity';
import { QuotaReason } from '../enums/quota-reason.enum';
import { QUOTA_EVENTS } from '../events/quota.events';
import {
  createFakeTransactionalDataSource,
  createLedgerRepository,
  type TransactionState,
} from '../testing/quota-fixtures';

import { QuotaService } from './quota.service';

import type { InMemoryRepository } from '../../../../test/fixtures';
import type { EntityManager } from 'typeorm';

const CONSUMER_ID = '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c';
const ADMIN_ID = 'cccccccc-1111-4222-8333-444455556666';
const AUGUST = '2026-08';

/** Mid-month, mid-day UTC — 17:00 in Asia/Karachi, so both zones agree on the date. */
const NOW = new Date('2026-08-15T12:00:00.000Z');

const ADMIN: ICurrentUser = {
  id: ADMIN_ID,
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

function ledgerRow(overrides: Partial<QuotaLedgerEntry> = {}): QuotaLedgerEntry {
  sequence += 1;
  return Object.assign(new QuotaLedgerEntry(), {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
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

function grant(delta = 15, overrides: Partial<QuotaLedgerEntry> = {}): QuotaLedgerEntry {
  return ledgerRow({ delta, reason: QuotaReason.MONTHLY_GRANT, ...overrides });
}

function consumption(jobId: string): QuotaLedgerEntry {
  return ledgerRow({ delta: -1, reason: QuotaReason.GENERATION_CONSUMED, jobId });
}

function profileRow(monthlyQuotaOverride: number | null): ConsumerProfile {
  return Object.assign(new ConsumerProfile(), {
    id: 'aaaaaaaa-1111-4222-8333-444455556666',
    userId: CONSUMER_ID,
    monthlyQuotaOverride,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  });
}

interface Harness {
  service: QuotaService;
  ledger: InMemoryRepository<QuotaLedgerEntry>;
  transactions: TransactionState;
  events: EventEmitter2;
}

function build(
  options: {
    rows?: readonly QuotaLedgerEntry[];
    profile?: ConsumerProfile | null;
    defaultMonthly?: number;
    serialise?: boolean;
    failWithSerializationErrorOnAttempt?: number;
  } = {},
): Harness {
  const ledger = createLedgerRepository<QuotaLedgerEntry>(options.rows ?? []);
  const profiles = createLedgerRepository<ConsumerProfile>(
    options.profile === undefined || options.profile === null ? [] : [options.profile],
  );

  const { dataSource, transactions } = createFakeTransactionalDataSource({
    repositories: new Map<unknown, unknown>([[QuotaLedgerEntry, ledger]]),
    ...(options.serialise === undefined ? {} : { serialise: options.serialise }),
    ...(options.failWithSerializationErrorOnAttempt === undefined
      ? {}
      : { failWithSerializationErrorOnAttempt: options.failWithSerializationErrorOnAttempt }),
  });

  const settings = createMock<SettingsService>(['getNumber']);
  settings.getNumber.mockResolvedValue(options.defaultMonthly ?? 15);

  const config = createMock<ConfigService>(['get']);
  config.get.mockReturnValue('Asia/Karachi');

  const events = new EventEmitter2();

  const service = new QuotaService(
    ledger,
    profiles,
    dataSource,
    settings,
    config,
    new MetricsService(),
    events,
  );

  return { service, ledger, transactions, events };
}

describe('QuotaService — derivation (§4.26)', () => {
  it('derives limit, used and remaining by summing, with no balance column anywhere', () => {
    const rows = [grant(15), consumption('job-1'), consumption('job-2')];
    const { service } = build({ rows });

    return expect(service.getSnapshot(CONSUMER_ID, NOW)).resolves.toMatchObject({
      period: AUGUST,
      limit: 15,
      used: 2,
      remaining: 13,
    });
  });

  it('reports resetsAt as local midnight starting the next period', async () => {
    const { service } = build({ rows: [grant()] });

    const snapshot = await service.getSnapshot(CONSUMER_ID, NOW);

    // 2026-09-01 00:00 in Asia/Karachi (UTC+5) is 2026-08-31T19:00Z.
    expect(snapshot.resetsAt.toISOString()).toBe('2026-08-31T19:00:00.000Z');
  });

  it('keeps one period out of another', async () => {
    const { service } = build({
      rows: [grant(15, { period: '2026-07' }), consumption('job-july')],
    });

    // The July grant does not fund August, so August materialises its own.
    const snapshot = await service.getSnapshot(CONSUMER_ID, NOW);

    expect(snapshot.period).toBe(AUGUST);
    expect(snapshot.limit).toBe(15);
  });
});

describe('QuotaService — the lazy monthly grant (§4.26)', () => {
  it('materialises the grant on the first read of a period, once', async () => {
    const { service, ledger, transactions } = build();

    await service.getSnapshot(CONSUMER_ID, NOW);
    await service.getSnapshot(CONSUMER_ID, NOW);

    const grants = ledger.$rows.filter((row) => row.reason === QuotaReason.MONTHLY_GRANT);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ delta: 15, period: AUGUST });
    // The second read short-circuits on the existence probe — no second transaction.
    expect(transactions.started).toBe(1);
  });

  it('grants `monthlyQuotaOverride` in preference to the settings default (A-18, A-28)', async () => {
    const { service, ledger } = build({ profile: profileRow(40), defaultMonthly: 15 });

    await service.getSnapshot(CONSUMER_ID, NOW);

    expect(ledger.$rows[0]).toMatchObject({ delta: 40, reason: QuotaReason.MONTHLY_GRANT });
  });

  it('opens the grant transaction at SERIALIZABLE', async () => {
    const { service, transactions } = build();

    await service.getSnapshot(CONSUMER_ID, NOW);

    expect(transactions.isolationLevels).toEqual(['SERIALIZABLE']);
  });
});

describe('QuotaService — the guard-chain read (§8.1 step 3)', () => {
  it('passes and writes nothing when she has generations left', async () => {
    const { service, ledger } = build({ rows: [grant(15), consumption('job-1')] });
    const before = ledger.$rows.length;

    await expect(service.assertQuotaAvailable(CONSUMER_ID, NOW)).resolves.toMatchObject({
      remaining: 14,
    });
    expect(ledger.$rows).toHaveLength(before);
  });

  it('throws QUOTA_EXHAUSTED with the §2.3 details the C-5 screen renders from', async () => {
    const rows = [grant(2), consumption('job-1'), consumption('job-2')];
    const { service } = build({ rows });

    await expect(service.assertQuotaAvailable(CONSUMER_ID, NOW)).rejects.toMatchObject({
      errorCode: ErrorCode.QUOTA_EXHAUSTED,
      details: { period: AUGUST, limit: 2, used: 2 },
    });
  });
});

describe('QuotaService — consumption charges exactly once (§8.4)', () => {
  it('appends a -1 row tied to the job', async () => {
    const { service, ledger } = build({ rows: [grant(15)] });

    const after = await withManager(service, (manager) =>
      service.consumeWithin(manager, { userId: CONSUMER_ID, jobId: 'job-1', period: AUGUST }),
    );

    expect(after).toMatchObject({ limit: 15, used: 1, remaining: 14 });
    expect(ledger.$rows.at(-1)).toMatchObject({
      delta: -1,
      reason: QuotaReason.GENERATION_CONSUMED,
      jobId: 'job-1',
      period: AUGUST,
    });
  });

  it('refuses and writes nothing when the balance is spent', async () => {
    const { service, ledger } = build({ rows: [grant(1), consumption('job-1')] });
    const before = ledger.$rows.length;

    await expect(
      withManager(service, (manager) =>
        service.consumeWithin(manager, { userId: CONSUMER_ID, jobId: 'job-2', period: AUGUST }),
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.QUOTA_EXHAUSTED });

    expect(ledger.$rows).toHaveLength(before);
  });

  /**
   * The one that matters.
   *
   * `remaining = 1`, two requests in flight. The `DataSource` double serialises
   * transactions — which is what `SERIALIZABLE` predicate locks buy in PostgreSQL —
   * so the second consumption re-derives the balance *after* the first has committed
   * its row. It sees zero, and is refused.
   *
   * The assertion is deliberately on the ledger as well as on the outcomes: "one
   * fulfilled, one rejected" would still pass if both rows had been written and one
   * call had failed for an unrelated reason.
   */
  it('never lets two simultaneous consumptions both succeed at remaining = 1', async () => {
    const { service, ledger, transactions } = build({
      rows: [grant(15), ...Array.from({ length: 14 }, (_, index) => consumption(`job-${index}`))],
      serialise: true,
    });

    expect((await service.getSnapshot(CONSUMER_ID, NOW)).remaining).toBe(1);

    const results = await Promise.allSettled([
      chargeThroughTransaction(service, 'race-a'),
      chargeThroughTransaction(service, 'race-b'),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      errorCode: ErrorCode.QUOTA_EXHAUSTED,
    });

    const raceRows = ledger.$rows.filter((row) => row.jobId?.startsWith('race-') === true);
    expect(raceRows).toHaveLength(1);
    expect((await service.getSnapshot(CONSUMER_ID, NOW)).remaining).toBe(0);
    expect(transactions.rolledBack).toBe(1);
  });

  it('retries a serialization failure exactly once, then lets the real answer stand', async () => {
    const { service, transactions } = build({
      rows: [grant(15)],
      failWithSerializationErrorOnAttempt: 1,
    });

    // `adjust` goes through the same `runSerializable` wrapper the charge path uses.
    await service.adjust(ADMIN, CONSUMER_ID, { delta: 5 });

    expect(transactions.started).toBe(2);
    expect(transactions.rolledBack).toBe(1);
    expect(transactions.committed).toBe(1);
    expect(transactions.isolationLevels).toEqual(['SERIALIZABLE', 'SERIALIZABLE']);
  });
});

describe('QuotaService — refunds (§8.4)', () => {
  it('does nothing when the generation was never charged — the ordinary failure path', async () => {
    const { service, ledger } = build({ rows: [grant(15)] });
    const before = ledger.$rows.length;

    const result = await withManager(service, (manager) =>
      service.refundWithin(manager, { userId: CONSUMER_ID, jobId: 'never-charged' }),
    );

    expect(result.refunded).toBe(false);
    expect(ledger.$rows).toHaveLength(before);
  });

  it('appends a compensating row without reusing the jobId (UQ_quota_ledger_job)', async () => {
    const { service, ledger } = build({ rows: [grant(15), consumption('job-1')] });

    const result = await withManager(service, (manager) =>
      service.refundWithin(manager, {
        userId: CONSUMER_ID,
        jobId: 'job-1',
        reason: 'Render could not be stored',
      }),
    );

    expect(result.refunded).toBe(true);
    expect(result.snapshot.remaining).toBe(15);

    const compensating = ledger.$rows.at(-1);
    expect(compensating).toMatchObject({
      delta: 1,
      reason: QuotaReason.GENERATION_CONSUMED,
      jobId: null,
    });
    expect(compensating?.note).toContain('job-1');
    // The original row is untouched: append-only means append-only (§2.1).
    expect(ledger.$rows.filter((row) => row.jobId === 'job-1')).toHaveLength(1);
  });

  it('books the reversal into the period the charge was made in, not today', async () => {
    const julyCharge = ledgerRow({
      delta: -1,
      reason: QuotaReason.GENERATION_CONSUMED,
      jobId: 'job-july',
      period: '2026-07',
    });
    const { service, ledger } = build({ rows: [grant(15, { period: '2026-07' }), julyCharge] });

    await withManager(service, (manager) =>
      service.refundWithin(manager, { userId: CONSUMER_ID, jobId: 'job-july' }),
    );

    expect(ledger.$rows.at(-1)).toMatchObject({ period: '2026-07', delta: 1 });
  });
});

describe('QuotaService — the A-18 mid-period raise', () => {
  it('raises the remaining balance immediately, without rewriting the grant', async () => {
    const { service, ledger } = build({
      rows: [grant(15), consumption('job-1'), consumption('job-2')],
    });

    expect((await service.getSnapshot(CONSUMER_ID, NOW)).remaining).toBe(13);

    const granted = await service.raiseEntitlementTo(CONSUMER_ID, AUGUST, 40, ADMIN_ID, 'A-18');

    expect(granted).toBe(25);
    expect((await service.getSnapshot(CONSUMER_ID, NOW)).remaining).toBe(38);

    // The original MONTHLY_GRANT row is exactly as it was.
    expect(ledger.$rows[0]).toMatchObject({ delta: 15, reason: QuotaReason.MONTHLY_GRANT });
    expect(ledger.$rows.at(-1)).toMatchObject({
      delta: 25,
      reason: QuotaReason.OVERRIDE_GRANT,
      actorId: ADMIN_ID,
    });
  });

  it('converges rather than double-granting when the same raise arrives twice', async () => {
    const { service } = build({ rows: [grant(15)] });

    await service.raiseEntitlementTo(CONSUMER_ID, AUGUST, 40, ADMIN_ID, null);
    const second = await service.raiseEntitlementTo(CONSUMER_ID, AUGUST, 40, ADMIN_ID, null);

    expect(second).toBe(0);
    expect((await service.getSnapshot(CONSUMER_ID, NOW)).limit).toBe(40);
  });

  it('grants the new value outright when the period has no monthly grant yet', async () => {
    const { service, ledger } = build();

    const granted = await service.raiseEntitlementTo(CONSUMER_ID, AUGUST, 40, ADMIN_ID, null);

    expect(granted).toBe(40);
    expect(ledger.$rows).toHaveLength(1);
    expect(ledger.$rows[0]).toMatchObject({ delta: 40, reason: QuotaReason.MONTHLY_GRANT });
  });

  it('appends nothing when the entitlement already covers the target', async () => {
    const { service, ledger } = build({
      rows: [grant(15), ledgerRow({ delta: 25, reason: QuotaReason.OVERRIDE_GRANT })],
    });
    const before = ledger.$rows.length;

    expect(await service.raiseEntitlementTo(CONSUMER_ID, AUGUST, 30, ADMIN_ID, null)).toBe(0);
    expect(ledger.$rows).toHaveLength(before);
  });
});

describe('QuotaService — admin adjustment (A-18)', () => {
  it('appends an ADMIN_ADJUSTMENT row carrying the actor and the note', async () => {
    const { service, ledger } = build({ rows: [grant(15)] });

    const snapshot = await service.adjust(ADMIN, CONSUMER_ID, {
      delta: 10,
      note: 'Raised for an upcoming event.',
    });

    expect(snapshot).toMatchObject({ limit: 25, remaining: 25 });
    expect(ledger.$rows.at(-1)).toMatchObject({
      delta: 10,
      reason: QuotaReason.ADMIN_ADJUSTMENT,
      actorId: ADMIN_ID,
      note: 'Raised for an upcoming event.',
    });
  });

  it('refuses an adjustment that would take her below zero, and writes nothing', async () => {
    const { service, ledger } = build({ rows: [grant(15), consumption('job-1')] });
    const before = ledger.$rows.length;

    await expect(service.adjust(ADMIN, CONSUMER_ID, { delta: -20 })).rejects.toMatchObject({
      errorCode: ErrorCode.QUOTA_ADJUSTMENT_INVALID,
    });
    expect(ledger.$rows).toHaveLength(before);
  });
});

describe('QuotaService — the C-5 exhaustion event', () => {
  it('fires only when the charge took her to zero', () => {
    const { service, events } = build();
    const seen: unknown[] = [];
    events.on(QUOTA_EVENTS.QUOTA_EXHAUSTED, (payload: unknown) => seen.push(payload));

    service.emitExhaustionIfSpent({
      userId: CONSUMER_ID,
      period: AUGUST,
      limit: 15,
      used: 14,
      remaining: 1,
      resetsAt: NOW,
    });
    expect(seen).toHaveLength(0);

    service.emitExhaustionIfSpent({
      userId: CONSUMER_ID,
      period: AUGUST,
      limit: 15,
      used: 15,
      remaining: 0,
      resetsAt: NOW,
    });
    expect(seen).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------------------------ */

/**
 * Runs a manager-taking method the way `GenerationSpendService` does — inside a real
 * `runInTransaction` against the fake `DataSource` — so the transactional path is what
 * is exercised, not a hand-rolled manager.
 */
async function withManager<T>(
  service: QuotaService,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return runThroughService(service, work);
}

async function chargeThroughTransaction(service: QuotaService, jobId: string): Promise<unknown> {
  return runThroughService(service, (manager) =>
    service.consumeWithin(manager, { userId: CONSUMER_ID, jobId, period: AUGUST }),
  );
}

/** Reaches the private `runSerializable` the same way every public write path does. */
async function runThroughService<T>(
  service: QuotaService,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const runner = service as unknown as {
    runSerializable(label: string, work: (manager: EntityManager) => Promise<T>): Promise<T>;
  };
  return runner.runSerializable('spec', work);
}
