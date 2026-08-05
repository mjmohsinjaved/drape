import type { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  ErrorCode,
  Locale,
  MetricsService,
  QuotaException,
  Role,
  UserStatus,
  type ICurrentUser,
} from '@library/common';
import { ImageService, StorageService } from '@library/storage';
import type { PutResult } from '@library/storage';

import { ConsentStatus, ConsentsService } from '@api/modules/consents';
import { GarmentImage } from '@api/modules/garments/entities/garment-image.entity';
import { Garment } from '@api/modules/garments/entities/garment.entity';
import { PublishState } from '@api/modules/garments/enums/publish-state.enum';
import { TestRenderState } from '@api/modules/garments/enums/test-render-state.enum';
import { PhotoModerationState } from '@api/modules/person-photos';
import { ResultWriterService } from '@api/modules/results';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { PreviewModeService, SettingsService } from '@api/modules/settings';

import { createTestingModule, type TestHarness } from '../../../../test/fixtures';
import { TryOnConfig } from '../config/tryon.config';
import { ReferenceModel } from '../entities/reference-model.entity';
import { TryOnCache } from '../entities/tryon-cache.entity';
import { TryOnJob } from '../entities/tryon-job.entity';
import {
  PERSON_PHOTO_PORT,
  type PersonPhotoPort,
  type PersonPhotoRef,
} from '../ports/person-photo.port';
import {
  QUOTA_PORT,
  type BudgetView,
  type ChargeGenerationInput,
  type QuotaPort,
  type QuotaView,
} from '../ports/quota.port';
import { MockTryOnProvider } from '../providers/mock-tryon.provider';
import { TRYON_PROVIDER } from '../providers/tryon-provider.interface';
import { ReferenceModelsService } from '../services/reference-models.service';
import { TestRenderBatchEventsService } from '../services/test-render-batch-events.service';
import { TestRenderService } from '../services/test-render.service';
import { TryOnCacheService } from '../services/tryon-cache.service';
import { TryOnEventsService } from '../services/tryon-events.service';
import { TryOnGuardService } from '../services/tryon-guard.service';
import { TryOnJobsService } from '../services/tryon-jobs.service';
import { TryOnRateLimitService } from '../services/tryon-rate-limit.service';
import { TryOnRunnerService } from '../services/tryon-runner.service';
import { TryOnService } from '../services/tryon.service';

/**
 * The try-on module's test harness.
 *
 * E-6 asks for "integration tests for the try-on route covering every branch of the
 * failure taxonomy in 8.3", and the thing each of those tests has to prove is
 * negative: *nothing was charged*. That is only convincing if the object under test is
 * the real stack — the real guard chain, the real runner, the real cache, the real
 * provider — with only the edges faked. So this builds all of it, and fakes exactly
 * four things:
 *
 *  - **storage**, as an in-memory key → bytes map. Tests assert on keys and bytes, never
 *    on a file; there is no `STORAGE_ROOT` on the machine this suite runs on (CLAUDE.md);
 *  - **`ImageService.toWebpThumbnail`**, because `sharp` re-encoding a thumbnail per
 *    test buys nothing and costs seconds;
 *  - **the quota port**, as a spy. `chargeSuccess` calls are counted, and the count is
 *    the assertion in every §8.3 test;
 *  - **the person-photo port**, so the suite does not need `person-photos`' upload
 *    pipeline to exercise a generation.
 *
 * Everything else is production code, including `MockTryOnProvider` — which is also
 * what runs in CI, and `tryon-provider.factory.spec.ts` asserts as much.
 */

export const CONSUMER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_CONSUMER_ID = '22222222-2222-4222-8222-222222222222';
export const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
export const GARMENT_ID = '44444444-4444-4444-8444-444444444444';
export const PHOTO_ID = '55555555-5555-4555-8555-555555555555';
export const REFERENCE_MODEL_ID = '66666666-6666-4666-8666-666666666666';

const GARMENT_SOURCE_HASH = 'a'.repeat(64);
export const PHOTO_HASH = 'b'.repeat(64);
export const REPLACEMENT_PHOTO_HASH = 'c'.repeat(64);
const REFERENCE_MODEL_HASH = 'd'.repeat(64);

export const CONSUMER: ICurrentUser = {
  id: CONSUMER_ID,
  role: Role.CONSUMER,
  email: 'consumer@example.invalid',
  name: 'Test Consumer',
  status: UserStatus.ACTIVE,
  emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
  phoneVerifiedAt: null,
  sessionId: '77777777-7777-4777-8777-777777777777',
  locale: Locale.EN,
};

export const ADMIN: ICurrentUser = {
  ...CONSUMER,
  id: ADMIN_ID,
  role: Role.ADMIN,
  email: 'admin@example.invalid',
  name: 'Studio Admin',
};

/* -------------------------------------------------------------------------------------------------
 * Doubles
 * ---------------------------------------------------------------------------------------------- */

/**
 * An in-memory object store. Keys are real §3.3 keys; bytes are real bytes.
 *
 * The doubles below return `Promise.resolve`/`Promise.reject` rather than being `async`
 * with nothing to await — they exist to satisfy a promise-returning contract, and
 * `async` on a body with no `await` in it is noise the linter is right about.
 */
export class FakeStorage {
  readonly objects = new Map<string, Buffer>();

  put = jest.fn((key: string, body: Buffer): Promise<PutResult> => {
    this.objects.set(key, body);
    return Promise.resolve({
      key,
      size: body.length,
      sha256: 'not-a-real-hash',
      mimeType: 'image/png',
    });
  });

  getBuffer = jest.fn((key: string): Promise<Buffer> => {
    const bytes = this.objects.get(key);
    return bytes === undefined
      ? Promise.reject(new Error(`No stored object for ${key}`))
      : Promise.resolve(bytes);
  });

  copy = jest.fn(async (source: string, destination: string): Promise<PutResult> => {
    const bytes = await this.getBuffer(source);
    // A real copy: the destination gets its own entry, exactly as §3.7 requires.
    this.objects.set(destination, Buffer.from(bytes));
    return {
      key: destination,
      size: bytes.length,
      sha256: 'not-a-real-hash',
      mimeType: 'image/png',
    };
  });

  delete = jest.fn((key: string): Promise<boolean> => Promise.resolve(this.objects.delete(key)));

  signedUrl = jest.fn(
    (key: string, subject?: string): string =>
      `https://api.test/api/v1/files/token?key=${key}&sub=${subject ?? ''}`,
  );

  signToken = jest.fn((key: string): string => `token-for-${key}`);
}

/**
 * The quota port, as a spy.
 *
 * `charges` is the assertion in every §8.3 test: **"Failed jobs never consume quota or
 * budget"** is checkable by looking at whether this array is empty.
 */
export class SpyQuotaPort implements QuotaPort {
  readonly charges: ChargeGenerationInput[] = [];

  quotaRemaining = 10;

  budgetUsed = 0;

  budgetLimit = 2000;

  assertQuotaAvailable = jest.fn((): Promise<QuotaView> => {
    // The real `QuotaService` refuses from the ledger; the shape of the refusal is
    // what the try-on path depends on, so the double raises the same exception.
    if (this.quotaRemaining <= 0) {
      return Promise.reject(new QuotaException(ErrorCode.QUOTA_EXHAUSTED));
    }
    return Promise.resolve({
      period: '2026-08',
      remaining: this.quotaRemaining,
      limit: 15,
      used: 15 - this.quotaRemaining,
      resetsAt: new Date('2026-09-01T00:00:00.000Z'),
    });
  });

  assertBudgetAvailable = jest.fn((): Promise<BudgetView> => {
    if (this.budgetUsed >= this.budgetLimit) {
      return Promise.reject(new QuotaException(ErrorCode.BUDGET_EXHAUSTED));
    }
    return Promise.resolve(this.snapshot());
  });

  budgetSnapshot = jest.fn((): Promise<BudgetView> => Promise.resolve(this.snapshot()));

  chargeSuccess = jest.fn((input: ChargeGenerationInput): Promise<void> => {
    this.charges.push(input);
    this.quotaRemaining -= input.origin === 'CONSUMER' ? 1 : 0;
    this.budgetUsed += 1;
    return Promise.resolve();
  });

  /** Consumer-quota charges only — §8.4's split between demand and catalogue work. */
  get consumerCharges(): ChargeGenerationInput[] {
    return this.charges.filter((charge) => charge.origin === 'CONSUMER');
  }

  get testRenderCharges(): ChargeGenerationInput[] {
    return this.charges.filter((charge) => charge.origin === 'TEST_RENDER');
  }

  private snapshot(): BudgetView {
    return {
      period: '2026-08',
      limit: this.budgetLimit,
      used: this.budgetUsed,
      remaining: Math.max(0, this.budgetLimit - this.budgetUsed),
      warnAt: Math.floor(this.budgetLimit * 0.8),
      hardStopAt: this.budgetLimit,
      resetsAt: new Date('2026-09-01T00:00:00.000Z'),
    };
  }
}

/** The person-photo port, over a single in-memory photo. */
export class FakePersonPhotoPort implements PersonPhotoPort {
  photo: PersonPhotoRef = {
    id: PHOTO_ID,
    userId: CONSUMER_ID,
    storageKey: `person-photos/${CONSUMER_ID}/photo.jpg`,
    hash: PHOTO_HASH,
    label: 'daylight',
    moderationState: PhotoModerationState.APPROVED,
    mimeType: 'image/jpeg',
  };

  /** Set to have the port throw, exactly as `PersonPhotosService` would. */
  failWith: Error | null = null;

  resolveGenerationPhoto = jest.fn((): Promise<PersonPhotoRef> =>
    this.failWith === null ? Promise.resolve(this.photo) : Promise.reject(this.failWith),
  );
}

/* -------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

/** A published garment with an **approved** test render — the only kind a consumer may try on. */
export function buildTryableGarment(overrides: Partial<Garment> = {}): Garment {
  return Object.assign(new Garment(), {
    id: GARMENT_ID,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    sku: 'SKU-0001',
    title: 'Ivory Chikankari Kurta',
    titleUr: null,
    slug: 'ivory-chikankari-kurta',
    categoryId: '88888888-8888-4888-8888-888888888888',
    category: { name: 'Bridal Lehenga' },
    colors: ['ivory'],
    fabric: 'cotton',
    price: 185_000,
    currency: 'PKR',
    description: null,
    descriptionUr: null,
    sizes: ['S'],
    styleTags: [],
    publishState: PublishState.PUBLISHED,
    publishedAt: new Date('2026-08-01T00:00:00.000Z'),
    qualityScore: 90,
    qualityChecks: null,
    qualityOverriddenBy: null,
    qualityOverriddenAt: null,
    testRenderId: null,
    testRenderState: TestRenderState.APPROVED,
    testRenderApprovedAt: new Date('2026-08-01T00:00:00.000Z'),
    approvedBy: ADMIN_ID,
    flaggedForReview: false,
    tryOnCount: 0,
    loveCount: 0,
    maybeCount: 0,
    rejectCount: 0,
    enquiryCount: 0,
    failureCount: 0,
    lastTriedAt: null,
    ...overrides,
  });
}

export function buildTryOnSourceImage(overrides: Partial<GarmentImage> = {}): GarmentImage {
  return Object.assign(new GarmentImage(), {
    id: '99999999-9999-4999-8999-999999999999',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    garmentId: GARMENT_ID,
    storageKey: `garments/${GARMENT_ID}/source.jpg`,
    thumbnailKey: null,
    isTryOnSource: true,
    hash: GARMENT_SOURCE_HASH,
    width: 2400,
    height: 3600,
    byteSize: 1_000,
    mimeType: 'image/jpeg',
    position: 0,
    altText: null,
    ...overrides,
  });
}

export function buildReferenceModel(overrides: Partial<ReferenceModel> = {}): ReferenceModel {
  return Object.assign(new ReferenceModel(), {
    id: REFERENCE_MODEL_ID,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    label: 'Reference model — front facing',
    storageKey: 'reference-models/default.jpg',
    thumbnailKey: null,
    hash: REFERENCE_MODEL_HASH,
    isDefault: true,
    position: 0,
    active: true,
    ...overrides,
  });
}

/* -------------------------------------------------------------------------------------------------
 * The harness
 * ---------------------------------------------------------------------------------------------- */

export interface TryOnTestContext {
  readonly harness: TestHarness;
  readonly tryOn: TryOnService;
  readonly jobs: TryOnJobsService;
  readonly guards: TryOnGuardService;
  readonly runner: TryOnRunnerService;
  readonly cache: TryOnCacheService;
  readonly testRenders: TestRenderService;
  readonly events: TryOnEventsService;
  /** The A-12 batch SSE bus (§5.11), so a batch test can assert what a watcher was told. */
  readonly batchEvents: TestRenderBatchEventsService;
  readonly rateLimits: TryOnRateLimitService;
  readonly preview: PreviewModeService;
  readonly provider: MockTryOnProvider;
  readonly quota: SpyQuotaPort;
  readonly photos: FakePersonPhotoPort;
  readonly storage: FakeStorage;
  /** The sharp double. A cache hit must never reach it — see PRD §9.1. */
  readonly images: { toWebpThumbnail: jest.Mock };
  readonly config: TryOnConfig;
  readonly consents: { resolveStatus: jest.Mock };
  readonly settings: { getBoolean: jest.Mock; getString: jest.Mock };
  close(): Promise<void>;
}

export interface TryOnTestOptions {
  readonly garment?: Garment | null;
  readonly sourceImage?: GarmentImage | null;
  readonly consentStatus?: ConsentStatus;
  readonly requireEmailVerification?: boolean;
  /** Overrides on top of the safe test defaults in `test-env.ts`. */
  readonly env?: Readonly<Record<string, string | number>>;
}

const DEFAULT_ENV: Readonly<Record<string, string | number>> = {
  TRYON_DRIVER: 'mock',
  TRYON_API_VERSION: 'test-0000-00-00',
  TRYON_TIMEOUT_MS: 1_000,
  TRYON_MAX_ATTEMPTS: 3,
  TRYON_BACKOFF_BASE_MS: 0,
  TRYON_TEST_RENDER_CONCURRENCY: 1,
  TRYON_MOCK_LATENCY_MS: 0,
  TRYON_MOCK_FAILURE_RATE: 0,
  TRYON_RATE_PER_HOUR: 1_000,
  TRYON_RATE_PER_IP_HOUR: 1_000,
};

/** A `ConfigService`-shaped double over a plain map. Nothing reads `process.env`. */
export function fakeConfigService(
  values: Readonly<Record<string, string | number>>,
): ConfigService {
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
    getOrThrow: <T>(key: string): T => {
      const value = values[key];
      if (value === undefined) {
        throw new Error(`Missing test configuration for ${key}`);
      }
      return value as T;
    },
  } as unknown as ConfigService;
}

export async function createTryOnContext(
  options: TryOnTestOptions = {},
): Promise<TryOnTestContext> {
  const garment = options.garment === undefined ? buildTryableGarment() : options.garment;
  const sourceImage =
    options.sourceImage === undefined ? buildTryOnSourceImage() : options.sourceImage;

  const storage = new FakeStorage();
  const quota = new SpyQuotaPort();
  const photos = new FakePersonPhotoPort();
  const config = new TryOnConfig(fakeConfigService({ ...DEFAULT_ENV, ...options.env }));
  const provider = new MockTryOnProvider(config);

  const consents = {
    resolveStatus: jest.fn(() =>
      Promise.resolve({
        status: options.consentStatus ?? ConsentStatus.GRANTED,
        policyVersion: '2026-01',
        grantedAt: new Date('2026-08-01T00:00:00.000Z'),
        consentedPolicyVersion: '2026-01',
      }),
    ),
  };

  const settings = {
    getBoolean: jest.fn(() => Promise.resolve(options.requireEmailVerification ?? true)),
    getString: jest.fn(() => Promise.resolve(null)),
  };

  // Re-encoding a thumbnail with sharp per test buys nothing and costs seconds.
  const images = {
    toWebpThumbnail: jest.fn(() => Promise.resolve(Buffer.from('thumbnail-bytes'))),
  };

  const harness = await createTestingModule({
    providers: [
      TryOnCacheService,
      TryOnRateLimitService,
      TryOnEventsService,
      TestRenderBatchEventsService,
      TryOnGuardService,
      TryOnRunnerService,
      TryOnService,
      TryOnJobsService,
      ResultWriterService,
      ReferenceModelsService,
      TestRenderService,
      PreviewModeService,
      EventEmitter2,
      MetricsService,
    ],
    repositories: [
      { entity: TryOnJob },
      { entity: TryOnCache },
      { entity: TryOnResult },
      { entity: ReferenceModel, rows: [buildReferenceModel()] },
      { entity: Garment, rows: garment === null ? [] : [garment] },
      { entity: GarmentImage, rows: sourceImage === null ? [] : [sourceImage] },
    ],
    overrides: [
      { token: TryOnConfig, value: config },
      { token: TRYON_PROVIDER, value: provider },
      { token: QUOTA_PORT, value: quota },
      { token: PERSON_PHOTO_PORT, value: photos },
      { token: StorageService, value: storage },
      { token: ImageService, value: images },
      { token: ConsentsService, value: consents },
      { token: SettingsService, value: settings },
    ],
  });

  // Seed the two objects a generation reads. Real keys, real (tiny) bytes.
  if (sourceImage !== null) {
    storage.objects.set(sourceImage.storageKey, Buffer.from('garment-source-bytes'));
  }
  storage.objects.set(photos.photo.storageKey, Buffer.from('person-photo-bytes'));
  storage.objects.set('reference-models/default.jpg', Buffer.from('reference-model-bytes'));

  return {
    harness,
    tryOn: harness.get(TryOnService),
    jobs: harness.get(TryOnJobsService),
    guards: harness.get(TryOnGuardService),
    runner: harness.get(TryOnRunnerService),
    cache: harness.get(TryOnCacheService),
    testRenders: harness.get(TestRenderService),
    events: harness.get(TryOnEventsService),
    batchEvents: harness.get(TestRenderBatchEventsService),
    rateLimits: harness.get(TryOnRateLimitService),
    preview: harness.get(PreviewModeService),
    provider,
    quota,
    photos,
    storage,
    images,
    config,
    consents,
    settings,
    close: () => harness.close(),
  };
}
