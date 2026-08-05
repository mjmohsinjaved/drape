/**
 * PRD A-34, S-10, §9.3 · ARCHITECTURE §4.29 — the moderation queue.
 *
 * Two properties, and they are the two the PRD is most emphatic about.
 *
 * **Every view is audit-logged.** Not "usually", not "asynchronously": the row is
 * written and awaited before the response is produced, so an audit write that fails
 * takes the view down with it. A queue that could be read without leaving a trace is
 * the exact thing §9.3 lists as a privacy control.
 *
 * **An unblurred original is never served.** The strong form of this is not "the DTO
 * has no field for it" — it is that the service never loads `person_photos.storageKey`
 * at all. The fixtures below give every photograph a real, obvious storage key, and the
 * assertions prove it reaches neither the response nor the URL signer.
 */
import { ErrorCode, Locale, Role, UserStatus, type ICurrentUser } from '@library/common';
import type { StorageService } from '@library/storage';

import type { AuditService } from '@api/modules/audit/services/audit.service';
import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { PhotoModerationState } from '@api/modules/person-photos/enums/photo-moderation-state.enum';
import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';
import { JobStatus } from '@api/modules/tryon/enums/job-status.enum';
import { AUDIT_ACTIONS } from '@api/shared/constants/audit-actions.constant';

import { createInMemoryRepository, createMock } from '../../../../test/fixtures';
import { MODERATION_PHOTO_COLUMNS } from '../constants/moderation.constants';
import { ModerationItem } from '../entities/moderation-item.entity';
import { ModerationSource } from '../enums/moderation-source.enum';
import { ModerationState } from '../enums/moderation-state.enum';

import { ModerationQueueService } from './moderation-queue.service';

import type { InMemoryRepository } from '../../../../test/fixtures';
import type { ModerationQueryDto } from '../dto/moderation-query.dto';
import type { DataSource, EntityManager } from 'typeorm';

const NOW = new Date('2026-08-15T12:00:00.000Z');

const ADMIN: ICurrentUser = {
  id: 'dddddddd-1111-4222-8333-444455556666',
  role: Role.ADMIN,
  email: 'admin@example.com',
  name: 'Studio Admin',
  status: UserStatus.ACTIVE,
  emailVerifiedAt: NOW,
  phoneVerifiedAt: null,
  sessionId: 'eeeeeeee-1111-4222-8333-444455556666',
  locale: Locale.EN,
};

const CONSUMER_ID = 'aaaaaaaa-1111-4222-8333-444455556666';
const PHOTO_ID = 'bbbbbbbb-1111-4222-8333-444455556666';

/** The thing that must never leave this module. Deliberately unmistakable in an assertion. */
const ORIGINAL_KEY = `person-photos/${CONSUMER_ID}/the-original-photograph.jpg`;
const BLURRED_KEY = 'thumbnails/person-blurred/1f2e3d4c-5b6a-4789-8012-3456789abcde-160.webp';

let sequence = 0;

function item(overrides: Partial<ModerationItem> = {}): ModerationItem {
  sequence += 1;
  return Object.assign(new ModerationItem(), {
    id: `30000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    createdAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
    updatedAt: NOW,
    deletedAt: null,
    personPhotoId: PHOTO_ID,
    userId: CONSUMER_ID,
    jobId: null,
    source: ModerationSource.UPSTREAM,
    reasonCode: 'UPSTREAM_NSFW',
    state: ModerationState.PENDING,
    blurredThumbnailKey: BLURRED_KEY,
    reviewedBy: null,
    reviewedAt: null,
    decisionNote: null,
    ...overrides,
  });
}

/** A photograph row with a very real `storageKey` on it — the thing that must not escape. */
function photo(overrides: Partial<PersonPhoto> = {}): PersonPhoto {
  return Object.assign(new PersonPhoto(), {
    id: PHOTO_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    userId: CONSUMER_ID,
    storageKey: ORIGINAL_KEY,
    blurredThumbnailKey: BLURRED_KEY,
    hash: 'a'.repeat(64),
    isActive: true,
    label: null,
    uploadedAt: NOW,
    purgeAfter: new Date(NOW.getTime() + 30 * 86_400_000),
    moderationState: PhotoModerationState.PENDING,
    width: 1200,
    height: 1600,
    byteSize: 480_000,
    mimeType: 'image/jpeg',
    ...overrides,
  });
}

function query(overrides: Partial<ModerationQueryDto> = {}): ModerationQueryDto {
  return {
    page: 1,
    limit: 20,
    sortBy: 'createdAt',
    sortOrder: 'ASC',
    ...overrides,
  };
}

interface Harness {
  readonly service: ModerationQueueService;
  readonly items: InMemoryRepository<ModerationItem>;
  readonly photos: InMemoryRepository<PersonPhoto>;
  readonly jobs: InMemoryRepository<TryOnJob>;
  readonly audit: jest.Mocked<AuditService>;
  readonly storage: jest.Mocked<StorageService>;
}

function build(options: { items?: ModerationItem[]; photos?: PersonPhoto[] } = {}): Harness {
  const items = createInMemoryRepository<ModerationItem>({ rows: options.items ?? [item()] });
  const photos = createInMemoryRepository<PersonPhoto>({ rows: options.photos ?? [photo()] });
  const jobs = createInMemoryRepository<TryOnJob>();

  const audit = createMock<AuditService>(['record', 'recordSafely']);
  audit.record.mockResolvedValue(undefined);

  const storage = createMock<StorageService>(['signedUrl']);
  storage.signedUrl.mockImplementation(
    (key: string, subject?: string) => `https://files.test/${key}?sub=${subject ?? ''}`,
  );

  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === ModerationItem) return items;
      if (entity === PersonPhoto) return photos;
      if (entity === TryOnJob) return jobs;
      throw new Error('Unexpected repository requested inside the transaction.');
    },
  } as unknown as EntityManager;

  const dataSource = {
    createQueryRunner: () => ({
      manager,
      isTransactionActive: false,
      connect: async (): Promise<void> => undefined,
      startTransaction: async (): Promise<void> => undefined,
      commitTransaction: async (): Promise<void> => undefined,
      rollbackTransaction: async (): Promise<void> => undefined,
      release: async (): Promise<void> => undefined,
    }),
  } as unknown as DataSource;

  const service = new ModerationQueueService(items, photos, dataSource, audit, storage);
  return { service, items, photos, jobs, audit, storage };
}

describe('ModerationQueueService', () => {
  describe('S-10 — an unblurred original is never served (A-34)', () => {
    it('never selects `storageKey` from person_photos', async () => {
      const harness = build();

      await harness.service.list(ADMIN, query());

      expect(harness.photos.find).toHaveBeenCalledWith(
        expect.objectContaining({ select: MODERATION_PHOTO_COLUMNS }),
      );
      // The guarantee itself, stated where a reviewer will see it fail.
      expect(Object.keys(MODERATION_PHOTO_COLUMNS)).not.toContain('storageKey');
    });

    it('serves only the blurred derivative, signed to the reviewing admin (§3.4)', async () => {
      const harness = build();

      const page = await harness.service.list(ADMIN, query());

      expect(page.items).toHaveLength(1);
      expect(page.items[0].blurredThumbnailUrl).toContain(BLURRED_KEY);
      expect(page.items[0].blurredThumbnailUrl).toContain(`sub=${ADMIN.id}`);

      // The signer was handed the blurred key and the admin's own id, and nothing else.
      expect(harness.storage.signedUrl).toHaveBeenCalledWith(BLURRED_KEY, ADMIN.id);
      expect(harness.storage.signedUrl).not.toHaveBeenCalledWith(ORIGINAL_KEY, expect.anything());
    });

    it('leaks no reference to the original anywhere in the serialised response', async () => {
      const harness = build();

      const page = await harness.service.list(ADMIN, query());
      const serialised = JSON.stringify(page);

      expect(serialised).not.toContain(ORIGINAL_KEY);
      expect(serialised).not.toContain('the-original-photograph');
      expect(serialised).not.toContain('storageKey');
    });

    it('returns a null thumbnail rather than falling back to the original', async () => {
      const harness = build({
        items: [item({ blurredThumbnailKey: null })],
        photos: [photo({ blurredThumbnailKey: null })],
      });

      const page = await harness.service.list(ADMIN, query());

      expect(page.items[0].blurredThumbnailUrl).toBeNull();
      expect(harness.storage.signedUrl).not.toHaveBeenCalled();
    });
  });

  describe('A-34 / §9.3 — every view is audit-logged', () => {
    it('writes MODERATION_QUEUE_VIEWED for a list read, before answering', async () => {
      const harness = build();

      await harness.service.list(ADMIN, query());

      expect(harness.audit.record).toHaveBeenCalledTimes(1);
      expect(harness.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.MODERATION_QUEUE_VIEWED,
          actorId: ADMIN.id,
          actorRole: ADMIN.role,
        }),
      );
    });

    it('writes MODERATION_ITEM_VIEWED for a single-item read', async () => {
      const harness = build();
      const target = harness.items.$rows[0];

      await harness.service.findOne(ADMIN, target.id);

      expect(harness.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.MODERATION_ITEM_VIEWED,
          targetId: target.id,
        }),
      );
    });

    it('records that a thumbnail exists, never the key itself (E-12)', async () => {
      const harness = build();
      const target = harness.items.$rows[0];

      await harness.service.findOne(ADMIN, target.id);

      const call = harness.audit.record.mock.calls[0][0];
      expect(call.metadata).toMatchObject({ hasBlurredThumbnail: true });
      expect(JSON.stringify(call.metadata)).not.toContain(BLURRED_KEY);
      expect(JSON.stringify(call.metadata)).not.toContain(ORIGINAL_KEY);
    });

    it('does not answer when the audit row cannot be written', async () => {
      const harness = build();
      harness.audit.record.mockRejectedValue(new Error('audit_log is unreachable'));

      await expect(harness.service.list(ADMIN, query())).rejects.toThrow(
        'audit_log is unreachable',
      );
    });
  });

  describe('decisions (§5.17)', () => {
    it('approve releases the photograph for generation', async () => {
      const harness = build();
      const target = harness.items.$rows[0];

      await harness.service.approve(ADMIN, target.id, { note: 'False positive.' });

      expect(harness.items.$rows[0]).toMatchObject({
        state: ModerationState.APPROVED,
        reviewedBy: ADMIN.id,
        decisionNote: 'False positive.',
      });
      expect(harness.photos.$rows[0].moderationState).toBe(PhotoModerationState.APPROVED);
      expect(harness.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTIONS.MODERATION_ITEM_APPROVED }),
      );
    });

    it('reject blocks the photograph and fails the generation waiting on it', async () => {
      const jobId = 'cccccccc-1111-4222-8333-444455556666';
      const harness = build({ items: [item({ jobId })] });
      harness.jobs.$seed([
        Object.assign(new TryOnJob(), {
          id: jobId,
          createdAt: NOW,
          updatedAt: NOW,
          deletedAt: null,
          userId: CONSUMER_ID,
          status: JobStatus.QUEUED,
          errorCode: null,
          finishedAt: null,
        }),
      ]);

      await harness.service.reject(ADMIN, harness.items.$rows[0].id, {});

      expect(harness.items.$rows[0].state).toBe(ModerationState.REJECTED);
      expect(harness.photos.$rows[0].moderationState).toBe(PhotoModerationState.BLOCKED);
      expect(harness.jobs.$rows[0]).toMatchObject({
        status: JobStatus.FAILED,
        errorCode: ErrorCode.MODERATION_REJECTED,
      });
    });

    it('refuses a second decision on an item another admin already reviewed', async () => {
      const harness = build({
        items: [item({ state: ModerationState.APPROVED, reviewedAt: NOW })],
      });

      await expect(
        harness.service.reject(ADMIN, harness.items.$rows[0].id, {}),
      ).rejects.toMatchObject({ errorCode: ErrorCode.MODERATION_ALREADY_REVIEWED });
    });

    it('decides an item whose photograph she has since deleted (C-38)', async () => {
      const harness = build({ photos: [] });

      const decided = await harness.service.approve(ADMIN, harness.items.$rows[0].id, {});

      expect(decided.state).toBe(ModerationState.APPROVED);
      expect(decided.photoState).toBeNull();
    });
  });

  describe('queue health — the E-14 backlog input', () => {
    it('reports how many are waiting and since when', async () => {
      const oldest = item({ createdAt: new Date('2026-08-14T00:00:00.000Z') });
      const harness = build({ items: [item(), oldest] });

      const summary = await harness.service.pendingSummary();

      expect(summary.pending).toBe(2);
      expect(summary.oldestPendingAt).toEqual(oldest.createdAt);
    });

    it('reports nothing waiting when the queue is empty', async () => {
      const harness = build({ items: [] });

      const summary = await harness.service.pendingSummary();

      expect(summary).toEqual({ pending: 0, oldestPendingAt: null });
    });
  });
});
