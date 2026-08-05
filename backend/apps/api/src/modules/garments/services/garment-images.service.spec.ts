/**
 * PRD A-9 / A-10, ARCHITECTURE §5.7 — a garment's images.
 *
 * The invariant these tests exist for is the try-on source: exactly one per garment, replaced
 * atomically, and never removable from underneath a published piece. The transaction double
 * counts `start`/`commit`/`rollback`, so "atomically" is asserted rather than assumed.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';

import { ErrorCode, Locale, Role, UserStatus, type ICurrentUser } from '@library/common';
import {
  type ImageService,
  type StorageService,
  type ImageQualityMeasurements,
  type StoredObject,
} from '@library/storage';

import { AUDIT_RECORD_EVENT } from '@api/modules/audit/events/audit.event';
import { type SettingsService } from '@api/modules/settings';
import { AUDIT_ACTIONS } from '@api/shared/constants/audit-actions.constant';

import { createInMemoryRepository, createMock } from '../../../../test/fixtures';
import { GarmentImage } from '../entities/garment-image.entity';
import { Garment } from '../entities/garment.entity';
import { PublishState } from '../enums/publish-state.enum';
import { TestRenderState } from '../enums/test-render-state.enum';
import { measurements } from '../validators/image-quality.fixtures';

import { GarmentImagesService } from './garment-images.service';
import { ImageQualityService } from './image-quality.service';

import type { InMemoryRepository } from '../../../../test/fixtures';
import type { DataSource, EntityManager } from 'typeorm';

const GARMENT_ID = '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c';
const IMAGE_A = 'aaaaaaaa-1111-4222-8333-444455556666';
const IMAGE_B = 'bbbbbbbb-1111-4222-8333-444455556666';

const ADMIN: ICurrentUser = {
  id: 'cccccccc-1111-4222-8333-444455556666',
  role: Role.ADMIN,
  email: 'admin@example.com',
  name: 'Studio Admin',
  status: UserStatus.ACTIVE,
  emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
  phoneVerifiedAt: null,
  sessionId: 'dddddddd-1111-4222-8333-444455556666',
  locale: Locale.EN,
};

function keyFor(name: string): string {
  return `garments/${GARMENT_ID}/${name}.jpg`;
}

function buildGarmentRow(overrides: Partial<Garment> = {}): Garment {
  return Object.assign(new Garment(), {
    id: GARMENT_ID,
    title: 'Zarrin Bridal Lehenga',
    publishState: PublishState.DRAFT,
    qualityScore: null,
    qualityChecks: null,
    qualityOverriddenBy: null,
    qualityOverriddenAt: null,
    testRenderState: TestRenderState.NONE,
    testRenderId: null,
    testRenderApprovedAt: null,
    approvedBy: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  });
}

function buildImageRow(overrides: Partial<GarmentImage> = {}): GarmentImage {
  return Object.assign(new GarmentImage(), {
    id: IMAGE_A,
    garmentId: GARMENT_ID,
    storageKey: keyFor('image-a'),
    thumbnailKey: 'thumbnails/garment/aaaa1111-2222-4333-8444-555566667777-320.webp',
    isTryOnSource: false,
    hash: 'a'.repeat(64),
    width: 2400,
    height: 3000,
    byteSize: 1024,
    mimeType: 'image/jpeg',
    position: 0,
    altText: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  });
}

function storedObject(key: string): StoredObject {
  return {
    key,
    byteSize: 2_400_000,
    contentType: 'image/jpeg',
    etag: 'f'.repeat(64),
    lastModified: new Date('2026-08-01T00:00:00.000Z'),
  };
}

interface TransactionState {
  started: number;
  committed: number;
  rolledBack: number;
  released: number;
}

interface Harness {
  service: GarmentImagesService;
  garments: InMemoryRepository<Garment>;
  images: InMemoryRepository<GarmentImage>;
  storage: jest.Mocked<StorageService>;
  processor: jest.Mocked<ImageService>;
  events: EventEmitter2;
  transactions: TransactionState;
}

function build(
  options: {
    garment?: Garment;
    images?: readonly GarmentImage[];
    probe?: ImageQualityMeasurements;
    minScore?: number;
  } = {},
): Harness {
  const garments = createInMemoryRepository<Garment>({
    rows: [options.garment ?? buildGarmentRow()],
  });
  const images = createInMemoryRepository<GarmentImage>({ rows: options.images ?? [] });

  const transactions: TransactionState = { started: 0, committed: 0, rolledBack: 0, released: 0 };
  const manager = {
    getRepository: (entity: unknown): unknown => (entity === Garment ? garments : images),
  } as unknown as EntityManager;

  const queryRunner = {
    manager,
    get isTransactionActive(): boolean {
      return transactions.started > transactions.committed + transactions.rolledBack;
    },
    connect: (): Promise<void> => Promise.resolve(),
    startTransaction: (): Promise<void> => {
      transactions.started += 1;
      return Promise.resolve();
    },
    commitTransaction: (): Promise<void> => {
      transactions.committed += 1;
      return Promise.resolve();
    },
    rollbackTransaction: (): Promise<void> => {
      transactions.rolledBack += 1;
      return Promise.resolve();
    },
    release: (): Promise<void> => {
      transactions.released += 1;
      return Promise.resolve();
    },
  };
  const dataSource = { createQueryRunner: (): unknown => queryRunner } as unknown as DataSource;

  const storage = createMock<StorageService>(['head', 'getBuffer', 'put', 'delete', 'signedUrl']);
  storage.head.mockImplementation((key) => Promise.resolve(storedObject(key)));
  storage.getBuffer.mockResolvedValue(Buffer.from('jpeg-bytes'));
  storage.put.mockImplementation((key) =>
    Promise.resolve({ key, size: 20_000, sha256: 'b'.repeat(64), mimeType: 'image/webp' }),
  );
  storage.delete.mockResolvedValue(true);
  // Opaque by construction, like the real thing: the token is base64url of a signed payload,
  // so a response that leaked a key would show it as a key rather than hiding inside a URL.
  storage.signedUrl.mockImplementation(
    (key) => `https://api.test/api/v1/files/${Buffer.from(key, 'utf8').toString('hex')}.sig`,
  );

  const processor = createMock<ImageService>(['metadata', 'toWebpThumbnail', 'probeQuality']);
  processor.metadata.mockResolvedValue({
    width: 2400,
    height: 3000,
    format: 'jpeg',
    byteSize: 2_400_000,
    hasAlpha: false,
    orientation: 1,
  });
  processor.toWebpThumbnail.mockResolvedValue(Buffer.from('webp-bytes'));
  processor.probeQuality.mockResolvedValue(options.probe ?? measurements());

  const settings = createMock<SettingsService>(['getNumber']);
  settings.getNumber.mockResolvedValue(options.minScore ?? 70);

  const events = new EventEmitter2();
  jest.spyOn(events, 'emit');

  const quality = new ImageQualityService(processor, settings);

  return {
    service: new GarmentImagesService(
      garments,
      images,
      dataSource,
      storage,
      processor,
      quality,
      events,
    ),
    garments,
    images,
    storage,
    processor,
    events,
    transactions,
  };
}

/** Every audit action emitted so far, in order. */
function emittedActions(events: EventEmitter2): string[] {
  return jest
    .mocked(events.emit)
    .mock.calls.filter(([name]) => name === AUDIT_RECORD_EVENT)
    .map(([, event]) => (event as { input: { action: string } }).input.action);
}

describe('GarmentImagesService.findAll (§5.7)', () => {
  it('returns the gallery in position order with signed URLs and no storage keys', async () => {
    const harness = build({
      images: [
        buildImageRow({ id: IMAGE_B, position: 1, storageKey: keyFor('image-b') }),
        buildImageRow({ id: IMAGE_A, position: 0 }),
      ],
    });

    const gallery = await harness.service.findAll(GARMENT_ID);

    expect(gallery.map((image) => image.id)).toEqual([IMAGE_A, IMAGE_B]);
    // §3.4: "a storage key must never cross the network boundary."
    const serialised = JSON.stringify(gallery);
    expect(serialised).not.toContain(keyFor('image-a'));
    expect(serialised).toContain('/api/v1/files/');
    expect(Object.keys(gallery[0])).not.toContain('storageKey');
    expect(Object.keys(gallery[0])).not.toContain('hash');
  });

  it('reports an unknown garment as GARMENT_NOT_FOUND', async () => {
    const harness = build();

    await expect(
      harness.service.findAll('11111111-2222-4333-8444-555566667777'),
    ).rejects.toMatchObject({ errorCode: ErrorCode.GARMENT_NOT_FOUND });
  });
});

describe('GarmentImagesService.create (§5.7, §3.5 step 3)', () => {
  it('records an image, measuring the file rather than believing the client', async () => {
    const harness = build();

    await harness.service.create(GARMENT_ID, { key: keyFor('image-a') }, ADMIN);

    const [row] = harness.images.$rows;
    expect(row.width).toBe(2400);
    expect(row.height).toBe(3000);
    expect(row.byteSize).toBe(2_400_000);
    expect(row.mimeType).toBe('image/jpeg');
    // §3.2 requirement 7 — the sha256 the driver returned, not one the client supplied.
    expect(row.hash).toBe('f'.repeat(64));
  });

  it('refuses a key that belongs to another prefix', async () => {
    const harness = build();

    await expect(
      harness.service.create(
        GARMENT_ID,
        { key: 'person-photos/11111111-2222-4333-8444-555566667777/x.jpg' },
        ADMIN,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.STORAGE_PATH_REJECTED });

    expect(harness.images.$rows).toHaveLength(0);
  });

  it('refuses a key that belongs to another garment', async () => {
    const harness = build();

    await expect(
      harness.service.create(
        GARMENT_ID,
        { key: 'garments/99999999-8888-4777-8666-555544443333/x.jpg' },
        ADMIN,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.STORAGE_PATH_REJECTED });
  });

  it('refuses a key that names no stored object', async () => {
    const harness = build();
    harness.storage.head.mockResolvedValue(null);

    await expect(
      harness.service.create(GARMENT_ID, { key: keyFor('missing') }, ADMIN),
    ).rejects.toMatchObject({ errorCode: ErrorCode.FILE_NOT_FOUND });
  });

  it('appends to the end of the gallery by default', async () => {
    const harness = build({ images: [buildImageRow({ position: 0 })] });

    await harness.service.create(GARMENT_ID, { key: keyFor('image-b') }, ADMIN);

    expect(harness.images.$rows.map((row) => row.position)).toEqual([0, 1]);
  });

  it('validates and scores a try-on source, writing the verdict to the garment (A-10)', async () => {
    const harness = build();

    await harness.service.create(
      GARMENT_ID,
      { key: keyFor('image-a'), isTryOnSource: true },
      ADMIN,
    );

    const garment = harness.garments.$rows[0];
    expect(garment.qualityScore).toBe(100);
    expect(garment.qualityChecks).toHaveLength(5);
    expect(emittedActions(harness.events)).toEqual([
      AUDIT_ACTIONS.GARMENT_IMAGE_ADDED,
      AUDIT_ACTIONS.GARMENT_TRYON_SOURCE_SET,
    ]);
  });

  it('refuses to add a second try-on source, so nothing is demoted by accident', async () => {
    const harness = build({ images: [buildImageRow({ isTryOnSource: true })] });

    await expect(
      harness.service.create(GARMENT_ID, { key: keyFor('image-b'), isTryOnSource: true }, ADMIN),
    ).rejects.toMatchObject({ errorCode: ErrorCode.TRYON_SOURCE_ALREADY_SET });

    expect(harness.images.$rows).toHaveLength(1);
  });

  it('keeps the image when the thumbnail encoder trips', async () => {
    const harness = build();
    harness.processor.toWebpThumbnail.mockRejectedValue(new Error('encoder unavailable'));

    await harness.service.create(GARMENT_ID, { key: keyFor('image-a') }, ADMIN);

    expect(harness.images.$rows[0].thumbnailKey).toBeNull();
  });

  it('puts no storage key in the audit metadata (E-12)', async () => {
    const harness = build();

    await harness.service.create(GARMENT_ID, { key: keyFor('image-a') }, ADMIN);

    const emitted = JSON.stringify(jest.mocked(harness.events.emit).mock.calls);
    expect(emitted).not.toContain(keyFor('image-a'));
    expect(emitted).not.toContain('garments/');
  });
});

describe('GarmentImagesService.setTryOnSource — the A-9 invariant (§4.14)', () => {
  it('clears the previous source and promotes the new one', async () => {
    const harness = build({
      images: [
        buildImageRow({ id: IMAGE_A, isTryOnSource: true }),
        buildImageRow({ id: IMAGE_B, isTryOnSource: false, storageKey: keyFor('image-b') }),
      ],
    });

    await harness.service.setTryOnSource(IMAGE_B, ADMIN);

    const sources = harness.images.$rows.filter((row) => row.isTryOnSource);
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe(IMAGE_B);
  });

  it('does the demote and the promote in one transaction, which commits once', async () => {
    const harness = build({
      images: [
        buildImageRow({ id: IMAGE_A, isTryOnSource: true }),
        buildImageRow({ id: IMAGE_B, storageKey: keyFor('image-b') }),
      ],
    });

    await harness.service.setTryOnSource(IMAGE_B, ADMIN);

    // One unit of work. A concurrent designation of a third image serialises on
    // UQ_garment_images_source (§4.14) instead of interleaving with these two statements.
    expect(harness.transactions).toEqual({
      started: 1,
      committed: 1,
      rolledBack: 0,
      released: 1,
    });
  });

  it('leaves exactly one source when two designations run back to back', async () => {
    const harness = build({
      images: [
        buildImageRow({ id: IMAGE_A, isTryOnSource: true }),
        buildImageRow({ id: IMAGE_B, storageKey: keyFor('image-b') }),
      ],
    });

    await harness.service.setTryOnSource(IMAGE_B, ADMIN);
    await harness.service.setTryOnSource(IMAGE_A, ADMIN);

    expect(harness.images.$rows.filter((row) => row.isTryOnSource).map((row) => row.id)).toEqual([
      IMAGE_A,
    ]);
  });

  it('resets the test render, because the approval described the previous file (A-11)', async () => {
    const harness = build({
      garment: buildGarmentRow({
        testRenderState: TestRenderState.APPROVED,
        testRenderId: '11111111-2222-4333-8444-555566667777',
        testRenderApprovedAt: new Date('2026-08-02T00:00:00.000Z'),
        approvedBy: ADMIN.id,
      }),
      images: [buildImageRow({ id: IMAGE_B, storageKey: keyFor('image-b') })],
    });

    await harness.service.setTryOnSource(IMAGE_B, ADMIN);

    const garment = harness.garments.$rows[0];
    expect(garment.testRenderState).toBe(TestRenderState.NONE);
    expect(garment.testRenderId).toBeNull();
    expect(garment.testRenderApprovedAt).toBeNull();
    expect(garment.approvedBy).toBeNull();
  });

  it('returns the A-10 verdict alongside the image', async () => {
    const harness = build({
      images: [buildImageRow({ id: IMAGE_B, storageKey: keyFor('image-b') })],
      probe: measurements({ backgroundUniformity: 0.2, longEdgePx: 1200 }),
    });

    const result = await harness.service.setTryOnSource(IMAGE_B, ADMIN);

    expect(result.quality.needsBetterPhoto).toBe(true);
    expect(result.quality.label).toBe('Needs a better photo');
    expect(result.quality.checks.filter((check) => !check.passed)).toHaveLength(2);
    expect(result.image.isTryOnSource).toBe(true);
  });

  it('audits the designation with the score it produced (A-3)', async () => {
    const harness = build({ images: [buildImageRow({ id: IMAGE_B })] });

    await harness.service.setTryOnSource(IMAGE_B, ADMIN);

    expect(harness.events.emit).toHaveBeenCalledWith(
      AUDIT_RECORD_EVENT,
      expect.objectContaining({
        input: expect.objectContaining({
          action: AUDIT_ACTIONS.GARMENT_TRYON_SOURCE_SET,
          actorId: ADMIN.id,
          metadata: expect.objectContaining({ qualityScore: 100 }),
        }),
      }),
    );
  });
});

describe('GarmentImagesService.reorder (§5.7)', () => {
  it('persists the submitted order', async () => {
    const harness = build({
      images: [
        buildImageRow({ id: IMAGE_A, position: 0 }),
        buildImageRow({ id: IMAGE_B, position: 1, storageKey: keyFor('image-b') }),
      ],
    });

    const gallery = await harness.service.reorder(
      GARMENT_ID,
      { imageIds: [IMAGE_B, IMAGE_A] },
      ADMIN,
    );

    expect(gallery.map((image) => image.id)).toEqual([IMAGE_B, IMAGE_A]);
    expect(emittedActions(harness.events)).toContain(AUDIT_ACTIONS.GARMENT_IMAGE_REORDERED);
  });

  it('refuses a list that does not name every image of the piece', async () => {
    const harness = build({
      images: [buildImageRow({ id: IMAGE_A }), buildImageRow({ id: IMAGE_B })],
    });

    await expect(
      harness.service.reorder(GARMENT_ID, { imageIds: [IMAGE_A] }, ADMIN),
    ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_ERROR });
  });

  it('refuses a list naming an image from another garment', async () => {
    const harness = build({ images: [buildImageRow({ id: IMAGE_A })] });

    await expect(
      harness.service.reorder(
        GARMENT_ID,
        { imageIds: ['99999999-8888-4777-8666-555544443333'] },
        ADMIN,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_ERROR });
  });
});

describe('GarmentImagesService.remove — deleting a try-on source (§5.7)', () => {
  it('refuses to remove the try-on source of a published garment', async () => {
    const harness = build({
      garment: buildGarmentRow({ publishState: PublishState.PUBLISHED, qualityScore: 88 }),
      images: [buildImageRow({ isTryOnSource: true })],
    });

    await expect(harness.service.remove(IMAGE_A, ADMIN)).rejects.toMatchObject({
      errorCode: ErrorCode.TRYON_SOURCE_REQUIRED,
    });

    // Nothing removed, nothing unpublished, no file deleted.
    expect(harness.images.$rows[0].deletedAt).toBeNull();
    expect(harness.garments.$rows[0].publishState).toBe(PublishState.PUBLISHED);
    expect(harness.storage.delete).not.toHaveBeenCalled();
  });

  it('names the two ways forward instead of silently unpublishing', async () => {
    const harness = build({
      garment: buildGarmentRow({ publishState: PublishState.PUBLISHED }),
      images: [buildImageRow({ isTryOnSource: true })],
    });

    await expect(harness.service.remove(IMAGE_A, ADMIN)).rejects.toMatchObject({
      message: expect.stringContaining('Unpublish the piece'),
    });
  });

  it('allows removing a gallery image from a published garment', async () => {
    const harness = build({
      garment: buildGarmentRow({ publishState: PublishState.PUBLISHED }),
      images: [
        buildImageRow({ id: IMAGE_A, isTryOnSource: true }),
        buildImageRow({ id: IMAGE_B, storageKey: keyFor('image-b') }),
      ],
    });

    await harness.service.remove(IMAGE_B, ADMIN);

    expect(harness.images.$rows.find((row) => row.id === IMAGE_B)?.deletedAt).not.toBeNull();
    expect(harness.garments.$rows[0].publishState).toBe(PublishState.PUBLISHED);
  });

  it('allows removing the try-on source of a draft, clearing the verdict it produced', async () => {
    const harness = build({
      garment: buildGarmentRow({
        qualityScore: 88,
        qualityChecks: [{ check: 'LONG_EDGE', passed: true, score: 32, remediation: null }],
        testRenderState: TestRenderState.APPROVED,
        testRenderApprovedAt: new Date('2026-08-02T00:00:00.000Z'),
      }),
      images: [buildImageRow({ isTryOnSource: true })],
    });

    await harness.service.remove(IMAGE_A, ADMIN);

    const garment = harness.garments.$rows[0];
    expect(garment.qualityScore).toBeNull();
    expect(garment.qualityChecks).toBeNull();
    expect(garment.testRenderState).toBe(TestRenderState.NONE);
  });

  it('removes the stored object and its thumbnail, after the row is gone', async () => {
    const harness = build({ images: [buildImageRow()] });

    await harness.service.remove(IMAGE_A, ADMIN);

    expect(harness.storage.delete).toHaveBeenCalledWith(keyFor('image-a'));
    expect(harness.storage.delete).toHaveBeenCalledWith(
      'thumbnails/garment/aaaa1111-2222-4333-8444-555566667777-320.webp',
    );
    expect(emittedActions(harness.events)).toContain(AUDIT_ACTIONS.GARMENT_IMAGE_REMOVED);
  });

  it('keeps the row deleted even when the file delete fails', async () => {
    const harness = build({ images: [buildImageRow()] });
    harness.storage.delete.mockRejectedValue(new Error('volume unavailable'));

    await expect(harness.service.remove(IMAGE_A, ADMIN)).resolves.toBeUndefined();

    expect(harness.images.$rows[0].deletedAt).not.toBeNull();
  });
});

describe('GarmentImagesService.revalidate (§5.7)', () => {
  it('re-scores the try-on source and writes the new verdict to the garment', async () => {
    const harness = build({
      garment: buildGarmentRow({ qualityScore: 100 }),
      images: [buildImageRow({ isTryOnSource: true })],
      probe: measurements({ longEdgePx: 1200, width: 960, height: 1200 }),
    });

    const report = await harness.service.revalidate(IMAGE_A, ADMIN);

    expect(report.score).toBe(68);
    expect(report.needsBetterPhoto).toBe(true);
    expect(harness.garments.$rows[0].qualityScore).toBe(68);
  });

  it('scores a gallery image without touching the garment', async () => {
    const harness = build({
      garment: buildGarmentRow({ qualityScore: 91 }),
      images: [buildImageRow({ isTryOnSource: false })],
    });

    const report = await harness.service.revalidate(IMAGE_A, ADMIN);

    expect(report.score).toBe(100);
    expect(harness.garments.$rows[0].qualityScore).toBe(91);
  });

  it('honours a pass mark moved in settings, without a deploy (§4.28)', async () => {
    const harness = build({
      images: [buildImageRow({ isTryOnSource: true })],
      probe: measurements({ backgroundUniformity: 0.4 }),
      minScore: 95,
    });

    const report = await harness.service.revalidate(IMAGE_A, ADMIN);

    expect(report.score).toBe(82);
    expect(report.minScore).toBe(95);
    expect(report.needsBetterPhoto).toBe(true);
  });
});
