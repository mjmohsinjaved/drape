import { EventEmitter2 } from '@nestjs/event-emitter';

import { ErrorCode, Locale, Role, UserStatus, type ICurrentUser } from '@library/common';
import { StorageService } from '@library/storage';

import { Garment } from '@api/modules/garments/entities/garment.entity';
import { PublishState } from '@api/modules/garments/enums/publish-state.enum';

import {
  buildOrphanedTryOnResult,
  buildPublishedGarment,
  buildTryOnResult,
} from '../../../../test/factories';
import { createServiceUnderTest, type TestHarness } from '../../../../test/fixtures';
import { TryOnResult } from '../entities/tryon-result.entity';

import { ResultsService } from './results.service';

import type { ResultQueryDto } from '../dto/result-query.dto';

/**
 * Try-on history — ARCHITECTURE §5.12, PRD C-24 … C-31.
 *
 * The property worth most here is C-28/C-29: **a render outlives everything it was made
 * from**. The photo is deleted, the garment is hard-removed, the job is pruned — and her
 * history still reads correctly, because the list renders from the snapshot columns and
 * joins `garments` for one bit only: is it still available to try on?
 */

const OWNER: ICurrentUser = {
  id: '11111111-1111-4111-8111-111111111111',
  role: Role.CONSUMER,
  email: 'owner@example.invalid',
  name: 'Owner',
  status: UserStatus.ACTIVE,
  emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
  phoneVerifiedAt: null,
  sessionId: '77777777-7777-4777-8777-777777777777',
  locale: Locale.EN,
};

const INTRUDER: ICurrentUser = { ...OWNER, id: '22222222-2222-4222-8222-222222222222' };

const QUERY: ResultQueryDto = { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'DESC' };

describe('ResultsService', () => {
  let harness: TestHarness;
  let service: ResultsService;
  let storage: { delete: jest.Mock; signedUrl: jest.Mock; getBuffer: jest.Mock };

  async function build(results: TryOnResult[], garments: Garment[] = []): Promise<void> {
    storage = {
      delete: jest.fn(async () => true),
      signedUrl: jest.fn(
        (key: string, subject?: string) => `https://api.test/${key}?sub=${subject ?? ''}`,
      ),
      getBuffer: jest.fn(async () => Buffer.from('render')),
    };

    const built = await createServiceUnderTest(ResultsService, {
      repositories: [
        { entity: TryOnResult, rows: results },
        { entity: Garment, rows: garments },
      ],
      overrides: [
        { token: StorageService, value: storage },
        { token: EventEmitter2, value: new EventEmitter2() },
      ],
    });

    harness = built.harness;
    service = built.service;
  }

  afterEach(async () => {
    await harness.close();
  });

  describe('the history list (C-24, C-25)', () => {
    it('returns only her own renders', async () => {
      await build([
        buildTryOnResult({ userId: OWNER.id }),
        buildTryOnResult({ userId: INTRUDER.id }),
      ]);

      const page = await service.list(OWNER, QUERY);

      expect(page.items).toHaveLength(1);
      expect(page.meta.total).toBe(1);
    });

    it('excludes admin test renders from her history', async () => {
      await build([
        buildTryOnResult({ userId: OWNER.id }),
        buildTryOnResult({ userId: OWNER.id, isTestRender: true }),
      ]);

      const page = await service.list(OWNER, QUERY);

      expect(page.items).toHaveLength(1);
    });

    it('renders from the snapshots, so a hard-deleted garment still reads (C-29)', async () => {
      await build([
        buildOrphanedTryOnResult({
          userId: OWNER.id,
          garmentTitleSnapshot: 'Ivory Chikankari Kurta',
          garmentCategorySnapshot: 'Bridal Lehenga',
          garmentPriceSnapshot: 185_000,
        }),
      ]);

      const [item] = (await service.list(OWNER, QUERY)).items;

      expect(item).toMatchObject({
        garmentId: null,
        garmentTitle: 'Ivory Chikankari Kurta',
        garmentCategory: 'Bridal Lehenga',
        garmentPrice: 185_000,
        // The UI hides the try-on action and shows "no longer available".
        garmentAvailable: false,
      });
    });

    it('marks a garment unavailable once it is unpublished (C-29)', async () => {
      const garment = buildPublishedGarment({ publishState: PublishState.ARCHIVED });
      await build([buildTryOnResult({ userId: OWNER.id, garmentId: garment.id })], [garment]);

      const [item] = (await service.list(OWNER, QUERY)).items;

      expect(item?.garmentAvailable).toBe(false);
    });

    it('marks a still-published garment available', async () => {
      const garment = buildPublishedGarment();
      await build([buildTryOnResult({ userId: OWNER.id, garmentId: garment.id })], [garment]);

      const [item] = (await service.list(OWNER, QUERY)).items;

      expect(item?.garmentAvailable).toBe(true);
    });

    it('serialises signed, subject-scoped URLs and never a storage key (E-12, §3.4)', async () => {
      await build([buildTryOnResult({ userId: OWNER.id })]);

      const [item] = (await service.list(OWNER, QUERY)).items;

      expect(item?.url).toContain('?sub=' + OWNER.id);
      expect(JSON.stringify(item)).not.toContain('"storageKey"');
      expect(storage.signedUrl).toHaveBeenCalledWith(expect.any(String), OWNER.id);
    });

    it('filters by the photo a render came from (C-30)', async () => {
      const photoId = '33333333-3333-4333-8333-333333333333';
      await build([
        buildTryOnResult({ userId: OWNER.id, personPhotoId: photoId }),
        buildTryOnResult({ userId: OWNER.id }),
      ]);

      const page = await service.list(OWNER, { ...QUERY, personPhotoId: photoId });

      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.personPhotoId).toBe(photoId);
    });
  });

  describe('grouping by photo (C-30)', () => {
    it('groups surviving photos by id', async () => {
      const photoId = '33333333-3333-4333-8333-333333333333';
      await build([
        buildTryOnResult({ userId: OWNER.id, personPhotoId: photoId }),
        buildTryOnResult({ userId: OWNER.id, personPhotoId: photoId }),
      ]);

      const groups = await service.groupsByPhoto(OWNER, QUERY);

      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({ personPhotoId: photoId, count: 2 });
    });

    it('still groups after the photo is deleted, falling back to the label snapshot (C-28)', async () => {
      await build([
        buildTryOnResult({
          userId: OWNER.id,
          personPhotoId: null,
          personPhotoLabelSnapshot: 'daylight',
        }),
        buildTryOnResult({
          userId: OWNER.id,
          personPhotoId: null,
          personPhotoLabelSnapshot: 'daylight',
        }),
      ]);

      const groups = await service.groupsByPhoto(OWNER, QUERY);

      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        personPhotoId: null,
        personPhotoLabel: 'daylight',
        count: 2,
      });
    });
  });

  describe('ownership (§9.2, S-9, E-7)', () => {
    it("throws the true RESULT_NOT_OWNED for another account's render, which the filter masks", async () => {
      const result = buildTryOnResult({ userId: OWNER.id });
      await build([result]);

      // The client is told RESULT_NOT_FOUND; the log line carries the truth.
      await expect(service.findOne(INTRUDER, result.id)).rejects.toMatchObject({
        errorCode: ErrorCode.RESULT_NOT_OWNED,
      });
    });

    it('throws RESULT_NOT_FOUND when there is genuinely no such render', async () => {
      await build([]);

      await expect(
        service.findOne(OWNER, '44444444-4444-4444-8444-444444444444'),
      ).rejects.toMatchObject({ errorCode: ErrorCode.RESULT_NOT_FOUND });
    });

    it('refuses to delete another account’s render', async () => {
      const result = buildTryOnResult({ userId: OWNER.id });
      await build([result]);

      await expect(service.remove(INTRUDER, result.id)).rejects.toMatchObject({
        errorCode: ErrorCode.RESULT_NOT_OWNED,
      });
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });

  describe('deletion is permanent, and the copy says so (C-31)', () => {
    it('soft-deletes the row and hard-deletes both files', async () => {
      const result = buildTryOnResult({ userId: OWNER.id });
      await build([result]);

      await service.remove(OWNER, result.id);

      expect(harness.repository<TryOnResult>(TryOnResult).$rows[0]?.deletedAt).toBeInstanceOf(Date);
      expect(storage.delete).toHaveBeenCalledWith(result.storageKey);
      expect(storage.delete).toHaveBeenCalledWith(result.thumbnailKey);
    });

    it('does not fail the deletion when a file was already gone', async () => {
      const result = buildTryOnResult({ userId: OWNER.id });
      await build([result]);
      storage.delete.mockRejectedValue(new Error('missing'));

      // An orphaned file is swept by the retention cron; a row whose image is gone is
      // a broken screen. The row wins.
      await expect(service.remove(OWNER, result.id)).resolves.toBeUndefined();
    });

    it('drops the render out of her history afterwards', async () => {
      const result = buildTryOnResult({ userId: OWNER.id });
      await build([result]);

      await service.remove(OWNER, result.id);

      expect((await service.list(OWNER, QUERY)).items).toHaveLength(0);
    });
  });

  describe('marketing opt-in (§9.3)', () => {
    it('is never on by default', async () => {
      await build([buildTryOnResult({ userId: OWNER.id })]);

      expect((await service.list(OWNER, QUERY)).items[0]?.marketingOptInAt).toBeNull();
    });

    it('records and revokes an explicit, per-render opt-in', async () => {
      const result = buildTryOnResult({ userId: OWNER.id });
      await build([result]);

      const optedIn = await service.setMarketingOptIn(OWNER, result.id, true);
      expect(optedIn.marketingOptInAt).toBeInstanceOf(Date);

      const revoked = await service.setMarketingOptIn(OWNER, result.id, false);
      expect(revoked.marketingOptInAt).toBeNull();
    });
  });
});
