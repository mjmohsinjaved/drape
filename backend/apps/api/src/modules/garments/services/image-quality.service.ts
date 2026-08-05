import { Injectable, Logger } from '@nestjs/common';

import { ImageService } from '@library/storage';

import { SettingsService } from '@api/modules/settings';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { IMAGE_QUALITY_THRESHOLDS } from '../validators/image-quality.constants';
import { evaluateImageQuality } from '../validators/image-quality.validator';

import type { QualityCheckResult } from '../entities/garment.entity';
import type { ImageQualityReport } from '../validators/image-quality.validator';

/** The columns an A-10 report writes onto `garments` (§4.13). */
export interface GarmentQualityColumns {
  qualityScore: number;
  qualityChecks: QualityCheckResult[];
}

/**
 * PRD A-10 — the thin, injectable layer between the measurement and the judgement.
 *
 * Three lines of real work, and that is the point. `ImageService.probeQuality()` measures
 * (§3.6), `image-quality.validator.ts` scores (pure, exhaustively unit-tested), and this class
 * exists only to fetch the one tunable number — `quality.minScore` from the settings registry
 * (§4.28) — and to shape the result for the two consumers that need it: the `garments` row and
 * the response DTO.
 *
 * Keeping the settings read here rather than in the validator is what lets a studio move the
 * pass mark from the admin console without a deploy, while the scoring itself stays a function
 * of numbers that a test can call ten thousand times without a container.
 */
@Injectable()
export class ImageQualityService {
  private readonly logger = new Logger(ImageQualityService.name);

  constructor(
    private readonly images: ImageService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The configured pass mark.
   *
   * A settings read that fails must not stop an admin publishing a catalogue, so a failure
   * degrades to the registry default and says so in the log. `SettingsService` already does the
   * same for a stored value that will not validate; this covers the read itself failing.
   */
  async minScore(): Promise<number> {
    try {
      const configured = await this.settings.getNumber(SETTINGS_KEYS.QUALITY_MIN_SCORE);
      return configured > 0 ? configured : IMAGE_QUALITY_THRESHOLDS.DEFAULT_MIN_SCORE;
    } catch {
      this.logger.warn(
        'Could not read quality.minScore — using the registry default for this evaluation.',
      );
      return IMAGE_QUALITY_THRESHOLDS.DEFAULT_MIN_SCORE;
    }
  }

  /**
   * Runs the A-10 validation over the bytes of a try-on source.
   *
   * Throws `IMAGE_CORRUPT` when `sharp` cannot decode the file — which is the honest answer,
   * because an image we cannot open is not an image with a low score, it is not an image.
   */
  async evaluate(buffer: Buffer): Promise<ImageQualityReport> {
    const measurements = await this.images.probeQuality(buffer);
    return evaluateImageQuality(measurements, { minScore: await this.minScore() });
  }

  /**
   * The report as `garments.qualityScore` and `garments.qualityChecks` (§4.13).
   *
   * The whole per-check outcome is persisted, not just the number, so `GET /admin/garments/:id`
   * can show the remediation guidance A-10 asks for without re-reading the image — and so the
   * A-15 catalog-health panel can say *why* a score is low rather than only that it is.
   */
  toGarmentColumns(report: ImageQualityReport): GarmentQualityColumns {
    return {
      qualityScore: report.score,
      qualityChecks: report.checks.map((check) => ({
        check: check.check,
        passed: check.passed,
        score: check.score,
        remediation: check.remediation,
      })),
    };
  }
}
