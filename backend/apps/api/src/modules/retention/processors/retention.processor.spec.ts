/**
 * ARCHITECTURE §3.5 step 4 and §3.2 requirement 4 — the sweep is **scheduled**.
 *
 * `OrphanSweepService` has its own spec covering what it deletes and what it must never
 * delete. This file covers the half that made the gap a leak rather than a missing
 * feature: for three sweeps' worth of PRD text there was no cron entry at all, and three
 * separate files — `results.service.ts`, `garment-images.service.ts` and
 * `files/services/upload-ticket.service.ts` — each said in a comment that the retention
 * cron would collect their orphans. A sweep nothing calls is a sweep that does not exist.
 */
import { type ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';

import { AUDIT_RECORD_EVENT } from '@api/modules/audit/events/audit.event';
import type { AlertingService } from '@api/modules/notifications/services/alerting.service';
import { AUDIT_ACTIONS } from '@api/shared/constants/audit-actions.constant';

import { createMock } from '../../../../test/fixtures';
import { ORPHAN_SWEEP_CRON } from '../constants/retention.constants';

import { ORPHAN_SWEEP_JOB_NAME, RetentionProcessor } from './retention.processor';

import type { AccountDeletionService } from '../services/account-deletion.service';
import type { OrphanSweepReport, OrphanSweepService } from '../services/orphan-sweep.service';
import type { PurgeService } from '../services/purge.service';

const NOW = new Date('2026-08-15T12:00:00.000Z');

function emptyReport(overrides: Partial<OrphanSweepReport> = {}): OrphanSweepReport {
  const namespace = { examined: 0, deleted: 0, bytesReclaimed: 0, bounded: false };
  return {
    personPhotos: namespace,
    renders: namespace,
    exports: namespace,
    temporaryFilesDeleted: 0,
    cancelled: false,
    ...overrides,
  };
}

interface Harness {
  readonly processor: RetentionProcessor;
  readonly orphans: jest.Mocked<OrphanSweepService>;
  readonly purge: jest.Mocked<PurgeService>;
  readonly deletions: jest.Mocked<AccountDeletionService>;
  readonly alerts: jest.Mocked<AlertingService>;
  readonly emitted: unknown[][];
}

function build(): Harness {
  const purge = createMock<PurgeService>(['purgeExpiredPhotos', 'countDue', 'cancel']);
  purge.countDue.mockResolvedValue(0);

  const deletions = createMock<AccountDeletionService>(['sweep', 'countOverdue', 'cancel']);
  deletions.sweep.mockResolvedValue({ completed: 0, failed: 0 });
  deletions.countOverdue.mockResolvedValue(0);

  const orphans = createMock<OrphanSweepService>(['sweepOnce', 'cancel']);
  orphans.sweepOnce.mockResolvedValue(emptyReport());

  const alerts = createMock<AlertingService>(['purgeJobFailed']);
  alerts.purgeJobFailed.mockResolvedValue(undefined);

  const config = createMock<ConfigService>(['get']);
  config.get.mockReturnValue(24);

  const events = new EventEmitter2();
  const emitted: unknown[][] = [];
  jest.spyOn(events, 'emit').mockImplementation((...args: unknown[]) => {
    emitted.push(args);
    return true;
  });

  return {
    processor: new RetentionProcessor(purge, deletions, orphans, alerts, config, events),
    orphans,
    purge,
    deletions,
    alerts,
    emitted,
  };
}

describe('RetentionProcessor — the orphan sweep is actually scheduled', () => {
  it('carries the @Cron metadata ScheduleModule reads at boot', () => {
    // This is the assertion the whole file exists for. `OrphanSweepService` can be
    // perfect and the leak stays open if nothing ever calls it, which is exactly the
    // state §3.5 step 4 was in.
    const schedule = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      RetentionProcessor.prototype.runOrphanSweep,
    ) as { name?: string } | undefined;

    expect(schedule).toBeDefined();
    expect(schedule?.name).toBe(ORPHAN_SWEEP_JOB_NAME);
  });

  it('uses the hourly cadence the six-hour grace period calls for', () => {
    // Nightly would mean a leaked photograph sits for up to thirty hours rather than seven.
    expect(ORPHAN_SWEEP_CRON.endsWith(' * * * *')).toBe(true);
  });

  it('runs one sweep per tick', async () => {
    const harness = build();

    await harness.processor.runOrphanSweep();

    expect(harness.orphans.sweepOnce).toHaveBeenCalledTimes(1);
  });

  it('cancels the sweep on shutdown, alongside the other two jobs', () => {
    const harness = build();

    harness.processor.onModuleDestroy();

    expect(harness.orphans.cancel).toHaveBeenCalled();
    expect(harness.purge.cancel).toHaveBeenCalled();
    expect(harness.deletions.cancel).toHaveBeenCalled();
  });
});

describe('RetentionProcessor — what the orphan sweep reports', () => {
  it('audits a run that reclaimed something, with counts and never a key (E-12)', async () => {
    const harness = build();
    harness.orphans.sweepOnce.mockResolvedValue(
      emptyReport({
        personPhotos: { examined: 4, deleted: 2, bytesReclaimed: 800_000, bounded: false },
        temporaryFilesDeleted: 3,
      }),
    );

    await harness.processor.orphanSweepOnce(NOW);

    const audit = harness.emitted.find(
      ([name, event]) =>
        name === AUDIT_RECORD_EVENT &&
        (event as { input: { targetLabel?: string } }).input.targetLabel === ORPHAN_SWEEP_JOB_NAME,
    );
    expect(audit).toBeDefined();
    const input = (audit?.[1] as { input: { action: string; metadata: Record<string, unknown> } })
      .input;
    expect(input.action).toBe(AUDIT_ACTIONS.PURGE_JOB_COMPLETED);
    expect(input.metadata).toMatchObject({
      personPhotoObjectsDeleted: 2,
      temporaryFilesDeleted: 3,
      bytesReclaimed: 800_000,
    });
    expect(JSON.stringify(input.metadata)).not.toContain('person-photos/');
  });

  it('stays quiet on a clean run', async () => {
    const harness = build();

    await harness.processor.orphanSweepOnce(NOW);

    expect(harness.emitted).toHaveLength(0);
  });

  /**
   * E-14 — "purge job failure". A sweep that has been broken for a fortnight is a
   * fortnight of photographs accumulating where neither an operator nor the consumer
   * herself can see them.
   */
  it('raises the E-14 alert when a run throws', async () => {
    const harness = build();
    harness.orphans.sweepOnce.mockRejectedValue(new Error('the storage volume is unreachable'));

    await harness.processor.orphanSweepOnce(NOW);

    expect(harness.alerts.purgeJobFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        jobName: ORPHAN_SWEEP_JOB_NAME,
        errorSummary: expect.stringContaining('unreachable'),
      }),
    );
  });

  it('never lets a failed sweep escape into the scheduler', async () => {
    const harness = build();
    harness.orphans.sweepOnce.mockRejectedValue(new Error('boom'));

    await expect(harness.processor.runOrphanSweep()).resolves.toBeUndefined();
  });
});
