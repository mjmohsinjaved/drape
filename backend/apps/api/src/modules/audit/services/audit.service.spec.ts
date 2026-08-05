import { Logger } from '@nestjs/common';

import { Role } from '@library/common';

import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  AUDIT_ACTION_VALUES,
} from '@api/shared/constants/audit-actions.constant';

import {
  createServiceUnderTest,
  type TestHarness,
  type InMemoryRepository,
} from '../../../../test/fixtures';
import { AuditQueryDto } from '../dto/audit-query.dto';
import { AuditLogEntry } from '../entities/audit-log-entry.entity';

import { AuditService } from './audit.service';

import type { AuditRecordInput } from '../events/audit.event';

const ADMIN_ID = 'aa11bb22-cc33-4d44-8e55-ff6677889900';
const OTHER_ADMIN_ID = 'bb22cc33-dd44-4e55-8f66-001122334455';
const GARMENT_ID = 'cc33dd44-ee55-4f66-8077-112233445566';

/** A row exactly as the database would hand it back. */
function entry(overrides: Partial<AuditLogEntry> & { id: string }): AuditLogEntry {
  return Object.assign(new AuditLogEntry(), {
    actorId: ADMIN_ID,
    actorRole: Role.ADMIN,
    action: AUDIT_ACTIONS.GARMENT_PUBLISHED,
    targetType: AUDIT_TARGET_TYPES.GARMENT,
    targetId: GARMENT_ID,
    targetLabel: 'Zarrin Bridal Lehenga',
    metadata: {},
    ip: null,
    userAgent: null,
    requestId: null,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
  });
}

function query(overrides: Partial<AuditQueryDto> = {}): AuditQueryDto {
  return Object.assign(new AuditQueryDto(), overrides);
}

interface Fixture {
  service: AuditService;
  entries: InMemoryRepository<AuditLogEntry>;
  harness: TestHarness;
}

async function build(rows: readonly AuditLogEntry[] = []): Promise<Fixture> {
  const { service, harness } = await createServiceUnderTest(AuditService, {
    repositories: [{ entity: AuditLogEntry, rows }],
  });
  return { service, harness, entries: harness.repository<AuditLogEntry>(AuditLogEntry) };
}

describe('AuditService.record — E-12 redaction', () => {
  /**
   * PRD E-12 / §4.30: "`metadata` passes through `redact.util.ts`; photo keys and
   * personal data never reach it."
   *
   * The payload below is deliberately hostile: the same three secrets appear once
   * under an obviously sensitive property name and again buried in free text and in a
   * nested object, because a redactor that only checks property names is a redactor
   * that leaks the moment somebody writes a `note` field.
   */
  const EMAIL = 'ayesha@example.com';
  const STORAGE_KEY = 'person-photos/aa11bb22-cc33-4d44-8e55-ff6677889900/original.jpg';
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9abcdefghijklmnopqrstuvwxyz0123456789';

  const HOSTILE_METADATA: Record<string, unknown> = {
    actorEmail: EMAIL,
    photoKey: STORAGE_KEY,
    fileToken: TOKEN,
    note: `emailed ${EMAIL} a link to ${STORAGE_KEY}`,
    nested: { deeper: { downloadUrl: `https://api.test/api/v1/files/${TOKEN}` } },
    // Non-sensitive context must survive, or the audit row stops being useful.
    from: 'DRAFT',
    to: 'PUBLISHED',
    imageCount: 4,
  };

  it('persists none of the email, storage key or token', async () => {
    const { service, entries, harness } = await build();

    await service.record({
      action: AUDIT_ACTIONS.GARMENT_PUBLISHED,
      targetType: AUDIT_TARGET_TYPES.GARMENT,
      actorId: ADMIN_ID,
      actorRole: Role.ADMIN,
      targetId: GARMENT_ID,
      metadata: HOSTILE_METADATA,
    });

    expect(entries.$rows).toHaveLength(1);
    const stored = JSON.stringify(entries.$rows[0].metadata);

    expect(stored).not.toContain(EMAIL);
    expect(stored).not.toContain(STORAGE_KEY);
    expect(stored).not.toContain(TOKEN);
    // Not even a fragment: the local part and the storage prefix are both gone.
    expect(stored).not.toContain('ayesha');
    expect(stored).not.toContain('person-photos');
    expect(stored).not.toContain('https://');

    await harness.close();
  });

  it('keeps the non-sensitive context that makes the row worth reading', async () => {
    const { service, entries, harness } = await build();

    await service.record({
      action: AUDIT_ACTIONS.GARMENT_PUBLISHED,
      targetType: AUDIT_TARGET_TYPES.GARMENT,
      metadata: HOSTILE_METADATA,
    });

    expect(entries.$rows[0].metadata).toMatchObject({
      from: 'DRAFT',
      to: 'PUBLISHED',
      imageCount: 4,
    });

    await harness.close();
  });

  it('redacts free text and nested branches, not just sensitive property names', async () => {
    const { service, entries, harness } = await build();

    await service.record({
      action: AUDIT_ACTIONS.GARMENT_PUBLISHED,
      targetType: AUDIT_TARGET_TYPES.GARMENT,
      metadata: HOSTILE_METADATA,
    });

    const metadata = entries.$rows[0].metadata;

    expect(metadata.actorEmail).toBe('[REDACTED]');
    expect(metadata.photoKey).toBe('[REDACTED]');
    expect(metadata.fileToken).toBe('[REDACTED]');
    // `note` has an innocuous name, so it survives as a value — scrubbed.
    expect(metadata.note).toBe('emailed [EMAIL] a link to [STORAGE_KEY]');

    await harness.close();
  });

  it('stores an empty object when no metadata is supplied', async () => {
    const { service, entries, harness } = await build();

    await service.record({
      action: AUDIT_ACTIONS.USER_SUSPENDED,
      targetType: AUDIT_TARGET_TYPES.USER,
    });

    expect(entries.$rows[0].metadata).toEqual({});

    await harness.close();
  });
});

describe('AuditService.record — append-only (§4.30)', () => {
  it('inserts a second row rather than updating the first', async () => {
    const { service, entries, harness } = await build();

    const input: AuditRecordInput = {
      action: AUDIT_ACTIONS.SETTING_UPDATED,
      targetType: AUDIT_TARGET_TYPES.SETTING,
      actorId: ADMIN_ID,
      actorRole: Role.ADMIN,
      targetLabel: 'sharing.enabled',
      metadata: { settingKey: 'sharing.enabled', previousValue: true, newValue: false },
    };

    await service.record(input);
    await service.record({ ...input, metadata: { settingKey: 'sharing.enabled', newValue: true } });

    expect(entries.$rows).toHaveLength(2);
    expect(entries.$rows[0].id).not.toBe(entries.$rows[1].id);
    // Correcting history means appending, never editing (§2.1).
    expect(entries.update).not.toHaveBeenCalled();
    expect(entries.softDelete).not.toHaveBeenCalled();
    expect(entries.softRemove).not.toHaveBeenCalled();
    expect(entries.delete).not.toHaveBeenCalled();
    expect(entries.remove).not.toHaveBeenCalled();

    await harness.close();
  });

  it('leaves an existing row untouched when a new one lands', async () => {
    const existing = entry({ id: 'row-1', targetLabel: 'Zarrin Bridal Lehenga' });
    const snapshot = { ...existing };
    const { service, entries, harness } = await build([existing]);

    await service.record({
      action: AUDIT_ACTIONS.GARMENT_UNPUBLISHED,
      targetType: AUDIT_TARGET_TYPES.GARMENT,
      targetId: GARMENT_ID,
    });

    expect(entries.$rows).toHaveLength(2);
    expect(entries.$rows[0]).toEqual(snapshot);

    await harness.close();
  });

  it('rejects an action outside the closed registry rather than writing it', async () => {
    const { service, entries, harness } = await build();

    await expect(
      service.record({
        action: 'GARMENT_SLIGHTLY_ADJUSTED' as (typeof AUDIT_ACTION_VALUES)[number],
        targetType: AUDIT_TARGET_TYPES.GARMENT,
      }),
    ).rejects.toThrow(/AUDIT_ACTIONS registry/);

    expect(entries.$rows).toHaveLength(0);

    await harness.close();
  });

  it('truncates targetLabel and userAgent to their column widths', async () => {
    const { service, entries, harness } = await build();

    await service.record({
      action: AUDIT_ACTIONS.GARMENT_UPDATED,
      targetType: AUDIT_TARGET_TYPES.GARMENT,
      targetLabel: 'L'.repeat(400),
      userAgent: 'U'.repeat(900),
    });

    expect(entries.$rows[0].targetLabel).toHaveLength(160);
    expect(entries.$rows[0].userAgent).toHaveLength(512);

    await harness.close();
  });
});

describe('AuditService.recordSafely — the listener path', () => {
  it('swallows and logs a failed write so the emitting request still succeeds', async () => {
    const { service, entries, harness } = await build();
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(entries, 'save').mockRejectedValueOnce(new Error('connection reset'));

    await expect(
      service.recordSafely({
        action: AUDIT_ACTIONS.SETTING_UPDATED,
        targetType: AUDIT_TARGET_TYPES.SETTING,
      }),
    ).resolves.toBeUndefined();

    // A gap in the log is visible in the log.
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining(AUDIT_ACTIONS.SETTING_UPDATED),
      expect.anything(),
    );

    await harness.close();
  });
});

describe('AuditService.query — A-3 filters', () => {
  const rows: readonly AuditLogEntry[] = [
    entry({
      id: 'row-1',
      action: AUDIT_ACTIONS.GARMENT_PUBLISHED,
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
    }),
    entry({
      id: 'row-2',
      actorId: OTHER_ADMIN_ID,
      action: AUDIT_ACTIONS.SETTING_UPDATED,
      targetType: AUDIT_TARGET_TYPES.SETTING,
      targetId: null,
      createdAt: new Date('2026-08-05T10:00:00.000Z'),
    }),
    entry({
      id: 'row-3',
      action: AUDIT_ACTIONS.USER_SUSPENDED,
      targetType: AUDIT_TARGET_TYPES.USER,
      createdAt: new Date('2026-08-09T10:00:00.000Z'),
    }),
  ];

  it('filters by actor', async () => {
    const { service, harness } = await build(rows);

    const page = await service.query(query({ actorId: OTHER_ADMIN_ID }));

    expect(page.items.map((item) => item.id)).toEqual(['row-2']);
    expect(page.meta.total).toBe(1);

    await harness.close();
  });

  it('filters by action', async () => {
    const { service, harness } = await build(rows);

    const page = await service.query(query({ action: AUDIT_ACTIONS.USER_SUSPENDED }));

    expect(page.items.map((item) => item.id)).toEqual(['row-3']);

    await harness.close();
  });

  it('filters by date range, inclusively at both ends', async () => {
    const { service, harness } = await build(rows);

    const page = await service.query(
      query({ from: '2026-08-05T00:00:00.000Z', to: '2026-08-05T23:59:59.000Z' }),
    );

    expect(page.items.map((item) => item.id)).toEqual(['row-2']);

    await harness.close();
  });

  it('accepts an open-ended range', async () => {
    const { service, harness } = await build(rows);

    const fromOnly = await service.query(query({ from: '2026-08-05T00:00:00.000Z' }));
    expect(fromOnly.items.map((item) => item.id)).toEqual(['row-3', 'row-2']);

    const toOnly = await service.query(query({ to: '2026-08-05T00:00:00.000Z' }));
    expect(toOnly.items.map((item) => item.id)).toEqual(['row-1']);

    await harness.close();
  });

  it('paginates per §2.8, newest first by default', async () => {
    const { service, harness } = await build(rows);

    const page = await service.query(query({ page: 1, limit: 2 }));

    expect(page.items.map((item) => item.id)).toEqual(['row-3', 'row-2']);
    expect(page.meta).toEqual({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
    });

    await harness.close();
  });

  it('returns DTOs, never entities, and never the recorded IP or user agent', async () => {
    const { service, harness } = await build([
      entry({ id: 'row-1', ip: '203.0.113.7', userAgent: 'Mozilla/5.0' }),
    ]);

    const [item] = (await service.query(query())).items;

    expect(item).not.toBeInstanceOf(AuditLogEntry);
    expect(Object.keys(item)).toEqual([
      'id',
      'actorId',
      'actorRole',
      'action',
      'targetType',
      'targetId',
      'targetLabel',
      'metadata',
      'requestId',
      'createdAt',
    ]);
    expect(JSON.stringify(item)).not.toContain('203.0.113.7');
    expect(JSON.stringify(item)).not.toContain('Mozilla');

    await harness.close();
  });
});

describe('AuditService.listActions', () => {
  it('returns the closed registries for the filter dropdowns', async () => {
    const { service, harness } = await build();

    const registries = service.listActions();

    expect(registries.actions).toEqual([...AUDIT_ACTION_VALUES]);
    expect(registries.actions).toContain(AUDIT_ACTIONS.MODERATION_QUEUE_VIEWED);
    expect(registries.targetTypes).toContain(AUDIT_TARGET_TYPES.SETTING);

    await harness.close();
  });
});
