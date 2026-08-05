/**
 * PRD A-10 — the seam between the measurement, the pass mark and the publish gate.
 *
 * The scoring itself is covered exhaustively in `validators/image-quality.validator.spec.ts`.
 * What is pinned here is everything around it: that the pass mark really comes from
 * `quality.minScore` and can therefore be tuned without a deploy (§4.28), that a failed settings
 * read degrades instead of blocking a catalogue, that the report persists in the shape §4.13
 * declares — and that a score produced by this validator drives `evaluatePublishGate` exactly
 * the way A-10 says it must.
 */
import { ErrorCode } from '@library/common';
import { type ImageService, type ImageQualityMeasurements } from '@library/storage';

import { type SettingsService } from '@api/modules/settings';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { createMock } from '../../../../test/fixtures';
import { PublishState } from '../enums/publish-state.enum';
import { TestRenderState } from '../enums/test-render-state.enum';
import {
  IMAGE_QUALITY_THRESHOLDS,
  QUALITY_CHECK_ORDER,
} from '../validators/image-quality.constants';
import { measurements } from '../validators/image-quality.fixtures';

import { evaluatePublishGate } from './garment-publish.gate';
import { ImageQualityService } from './image-quality.service';

import type { Garment } from '../entities/garment.entity';

const ADMIN_ID = 'cccccccc-1111-4222-8333-444455556666';

interface Harness {
  service: ImageQualityService;
  images: jest.Mocked<ImageService>;
  settings: jest.Mocked<SettingsService>;
}

function build(probe: ImageQualityMeasurements = measurements(), minScore = 70): Harness {
  const images = createMock<ImageService>(['probeQuality']);
  images.probeQuality.mockResolvedValue(probe);

  const settings = createMock<SettingsService>(['getNumber']);
  settings.getNumber.mockResolvedValue(minScore);

  return { service: new ImageQualityService(images, settings), images, settings };
}

/** A garment that has cleared A-11 and A-9, so only the A-10 objection can be in play. */
function readyGarment(overrides: Partial<Garment> = {}): Garment {
  return {
    id: '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c',
    publishState: PublishState.DRAFT,
    testRenderState: TestRenderState.APPROVED,
    testRenderApprovedAt: new Date('2026-08-02T00:00:00.000Z'),
    qualityScore: null,
    qualityOverriddenBy: null,
    qualityOverriddenAt: null,
    ...overrides,
  } as Garment;
}

describe('ImageQualityService.minScore — the one tunable number (§4.28)', () => {
  it('reads quality.minScore from the settings registry', async () => {
    const { service, settings } = build(measurements(), 85);

    await expect(service.minScore()).resolves.toBe(85);
    expect(settings.getNumber).toHaveBeenCalledWith(SETTINGS_KEYS.QUALITY_MIN_SCORE);
  });

  it('falls back to the registry default when the setting is unusable', async () => {
    const { service } = build(measurements(), 0);

    await expect(service.minScore()).resolves.toBe(IMAGE_QUALITY_THRESHOLDS.DEFAULT_MIN_SCORE);
  });

  it('degrades rather than blocking every publish when the settings read fails', async () => {
    const { service, settings } = build();
    settings.getNumber.mockRejectedValue(new Error('database unavailable'));

    await expect(service.minScore()).resolves.toBe(IMAGE_QUALITY_THRESHOLDS.DEFAULT_MIN_SCORE);
  });
});

describe('ImageQualityService.evaluate', () => {
  it('judges the probe against the configured pass mark', async () => {
    // 82 — one qualitative check failed.
    const probe = measurements({ backgroundUniformity: 0.4 });

    await expect(build(probe, 70).service.evaluate(Buffer.from('x'))).resolves.toMatchObject({
      score: 82,
      minScore: 70,
      passed: true,
    });
    await expect(build(probe, 90).service.evaluate(Buffer.from('x'))).resolves.toMatchObject({
      score: 82,
      minScore: 90,
      passed: false,
    });
  });

  it('passes the bytes to the probe and nothing else', async () => {
    const { service, images } = build();
    const buffer = Buffer.from('jpeg-bytes');

    await service.evaluate(buffer);

    expect(images.probeQuality).toHaveBeenCalledWith(buffer);
  });

  it('reports a file sharp cannot decode as IMAGE_CORRUPT rather than as a low score', async () => {
    const { service, images } = build();
    images.probeQuality.mockRejectedValue(
      Object.assign(new Error('decode failed'), { errorCode: ErrorCode.IMAGE_CORRUPT }),
    );

    await expect(service.evaluate(Buffer.from('not-an-image'))).rejects.toMatchObject({
      errorCode: ErrorCode.IMAGE_CORRUPT,
    });
  });
});

describe('ImageQualityService.toGarmentColumns (§4.13)', () => {
  it('persists the score and the whole per-check outcome', async () => {
    const { service } = build(measurements({ format: 'gif' }));

    const columns = service.toGarmentColumns(await service.evaluate(Buffer.from('x')));

    expect(columns.qualityScore).toBe(94);
    expect(columns.qualityChecks).toHaveLength(QUALITY_CHECK_ORDER.length);
    expect(columns.qualityChecks).toContainEqual({
      check: 'FORMAT',
      passed: false,
      score: 0,
      remediation: 'Export this piece as JPEG, PNG, WebP or HEIC.',
    });
  });

  it('keeps the remediation guidance A-10 asks for, so the console needs no second read', async () => {
    const { service } = build(measurements({ longEdgePx: 1400 }));

    const columns = service.toGarmentColumns(await service.evaluate(Buffer.from('x')));
    const longEdge = columns.qualityChecks.find((check) => check.check === 'LONG_EDGE');

    expect(longEdge?.remediation).toContain('1,400px');
  });
});

describe('A-10 end to end — the score this validator produces drives the publish gate', () => {
  it('refuses to publish a garment whose try-on source scored below the bar', async () => {
    const { service } = build(measurements({ longEdgePx: 1200 }));
    const report = await service.evaluate(Buffer.from('x'));
    const garment = readyGarment({ qualityScore: report.score });

    expect(report.score).toBeLessThan(report.minScore);
    expect(
      evaluatePublishGate({ garment, hasTryOnSource: true, minQualityScore: report.minScore }),
    ).toBe(ErrorCode.QUALITY_OVERRIDE_REQUIRED);
  });

  it('permits the same garment once an explicit override has been recorded', async () => {
    const { service } = build(measurements({ longEdgePx: 1200 }));
    const report = await service.evaluate(Buffer.from('x'));
    const garment = readyGarment({
      qualityScore: report.score,
      // What `POST /admin/garments/:garmentId/quality-override` writes, and what the
      // GARMENT_QUALITY_OVERRIDDEN audit row records (A-3, A-10).
      qualityOverriddenBy: ADMIN_ID,
      qualityOverriddenAt: new Date('2026-08-03T00:00:00.000Z'),
    });

    expect(
      evaluatePublishGate({ garment, hasTryOnSource: true, minQualityScore: report.minScore }),
    ).toBeNull();
  });

  it('publishes a good photograph with no override at all', async () => {
    const { service } = build();
    const report = await service.evaluate(Buffer.from('x'));
    const garment = readyGarment({ qualityScore: report.score });

    expect(report.score).toBe(100);
    expect(
      evaluatePublishGate({ garment, hasTryOnSource: true, minQualityScore: report.minScore }),
    ).toBeNull();
  });

  it('still refuses when the piece has no try-on source, whatever it scored', async () => {
    const { service } = build();
    const report = await service.evaluate(Buffer.from('x'));
    const garment = readyGarment({ qualityScore: report.score });

    expect(
      evaluatePublishGate({ garment, hasTryOnSource: false, minQualityScore: report.minScore }),
    ).toBe(ErrorCode.TRYON_SOURCE_REQUIRED);
  });
});
