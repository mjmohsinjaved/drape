/**
 * PRD C-39, §9.3 — the data export, and how much of it is allowed to exist at once.
 *
 * `retention.constants.ts` has always declared `EXPORT_RETENTION_HOURS = 48` — "how long
 * an export stays downloadable before the purge collects it" — and **nothing collected
 * it**. `findExport` reported `EXPIRED` and withheld the URL while the object stayed on
 * disk, so the response told the truth and the store did not. There was no cap either:
 * each `POST /me/export` minted a fresh archive, and each can hold up to
 * {@link MAX_EXPORT_RENDERS} full-resolution renders of her body.
 *
 * The sweep half is asserted in `orphan-sweep.service.spec.ts`. This file asserts the cap,
 * which is the half that bounds the **peak** rather than the duration — a limit that only
 * takes effect on the next cron run is not a limit.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';

import { Role, UserStatus, Locale, type ICurrentUser } from '@library/common';
import {
  StoragePrefixes,
  type PutResult,
  type StorageService,
  type StoredObject,
} from '@library/storage';

import { type TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { type ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';

import { createInMemoryRepository, createMock } from '../../../../test/fixtures';
import { MAX_LIVE_EXPORTS_PER_CONSUMER } from '../constants/retention.constants';

import { DataExportService } from './data-export.service';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const CONSUMER_ID = 'aaaaaaaa-1111-4222-8333-444455556666';

const CONSUMER: ICurrentUser = {
  id: CONSUMER_ID,
  role: Role.CONSUMER,
  email: 'ayesha@example.com',
  name: 'Ayesha Khan',
  status: UserStatus.ACTIVE,
  emailVerifiedAt: NOW,
  phoneVerifiedAt: null,
  sessionId: 'bbbbbbbb-1111-4222-8333-444455556666',
  locale: Locale.EN,
};

function archive(index: number, lastModified: Date): StoredObject {
  return {
    key: `exports/${CONSUMER_ID}/c0000000-0000-4000-8000-${String(index).padStart(12, '0')}.zip`,
    byteSize: 9_000_000,
    contentType: 'application/zip',
    etag: 'd'.repeat(64),
    lastModified,
  };
}

interface Harness {
  readonly service: DataExportService;
  readonly storage: jest.Mocked<StorageService>;
  readonly deletedKeys: string[];
  readonly writtenKeys: string[];
}

/** @param existing archives already in her prefix, oldest first. */
function build(existing: readonly StoredObject[] = []): Harness {
  const renders = createInMemoryRepository<TryOnResult>();
  const shortlist = createInMemoryRepository<ShortlistItem>();

  const deletedKeys: string[] = [];
  const writtenKeys: string[] = [];
  const live = [...existing];

  const storage = createMock<StorageService>(['put', 'list', 'delete', 'head', 'signedUrl']);
  storage.put.mockImplementation(
    async (key: string, body: Parameters<StorageService['put']>[1]): Promise<PutResult> => {
      writtenKeys.push(key);
      live.push({
        key,
        byteSize: Buffer.isBuffer(body) ? body.byteLength : 0,
        contentType: 'application/zip',
        etag: 'e'.repeat(64),
        // Written now, so it is always the newest and must never be the one evicted.
        lastModified: NOW,
      });
      return { key, size: 0, sha256: 'e'.repeat(64), mimeType: 'application/zip' };
    },
  );
  storage.list.mockImplementation(async () => [...live]);
  storage.delete.mockImplementation(async (key: string) => {
    deletedKeys.push(key);
    const index = live.findIndex((object) => object.key === key);
    if (index >= 0) {
      live.splice(index, 1);
    }
    return true;
  });
  storage.signedUrl.mockImplementation((key: string) => `https://api.test/files/${key}`);

  return {
    service: new DataExportService(renders, shortlist, storage, new EventEmitter2()),
    storage,
    deletedKeys,
    writtenKeys,
  };
}

/** `n` archives, oldest first, one hour apart. */
function existingArchives(count: number): StoredObject[] {
  return Array.from({ length: count }, (_, index) =>
    archive(index, new Date(NOW.getTime() - (count - index) * 3_600_000)),
  );
}

describe('DataExportService — a consumer holds a bounded number of archives (C-39)', () => {
  it('leaves everything alone while she is under the cap', async () => {
    const harness = build(existingArchives(MAX_LIVE_EXPORTS_PER_CONSUMER - 1));

    await harness.service.createExport(CONSUMER, NOW);

    expect(harness.deletedKeys).toEqual([]);
  });

  it('evicts the oldest once a new archive takes her over the cap', async () => {
    const existing = existingArchives(MAX_LIVE_EXPORTS_PER_CONSUMER);
    const harness = build(existing);

    await harness.service.createExport(CONSUMER, NOW);

    expect(harness.deletedKeys).toEqual([existing[0]?.key]);
  });

  it('never evicts the archive she just asked for', async () => {
    const harness = build(existingArchives(MAX_LIVE_EXPORTS_PER_CONSUMER * 3));

    const response = await harness.service.createExport(CONSUMER, NOW);

    const newKey = harness.writtenKeys[0];
    expect(newKey).toBeDefined();
    expect(harness.deletedKeys).not.toContain(newKey);
    expect(response.downloadUrl).toContain(response.exportId);
  });

  it('settles at the cap however many times she presses the button', async () => {
    const harness = build();

    for (let attempt = 0; attempt < 11; attempt += 1) {
      await harness.service.createExport(CONSUMER, NOW);
    }

    const remaining = await harness.storage.list(StoragePrefixes.exportsOfUser(CONSUMER_ID));
    expect(remaining).toHaveLength(MAX_LIVE_EXPORTS_PER_CONSUMER);
  });

  it('only ever looks inside her own prefix', async () => {
    const harness = build(existingArchives(MAX_LIVE_EXPORTS_PER_CONSUMER));

    await harness.service.createExport(CONSUMER, NOW);

    for (const [prefix] of harness.storage.list.mock.calls) {
      expect(prefix).toBe(`exports/${CONSUMER_ID}/`);
    }
  });

  it('still returns her export when the eviction itself fails', async () => {
    const harness = build(existingArchives(MAX_LIVE_EXPORTS_PER_CONSUMER));
    harness.storage.delete.mockRejectedValue(new Error('the volume is unavailable'));

    // Her export succeeded. A failed eviction is a bounded amount of extra storage that
    // the sweep collects within EXPORT_RETENTION_HOURS, not a reason to fail the request.
    await expect(harness.service.createExport(CONSUMER, NOW)).resolves.toMatchObject({
      status: 'READY',
    });
  });

  it('signs the download URL for her and nobody else (§3.4)', async () => {
    const harness = build();

    await harness.service.createExport(CONSUMER, NOW);

    // `exports/**` requires a `sub`; issuing without one now throws in `SignedUrlService`.
    for (const [, subject] of harness.storage.signedUrl.mock.calls) {
      expect(subject).toBe(CONSUMER_ID);
    }
  });
});
