import { Injectable, Logger } from '@nestjs/common';

import { PreviewModeResponseDto } from '../dto/preview-mode.dto';

/**
 * How long a preview session lasts before it lapses on its own.
 *
 * A forgotten flag is the failure mode worth designing against: an admin who leaves
 * preview mode on and then genuinely wants a test render would get a fake one, and
 * would have no idea why. Two hours is longer than any real session of browsing the
 * consumer experience and shorter than a working day.
 */
export const PREVIEW_MODE_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * A-31 — preview mode: view the consumer experience without spending generations.
 *
 * **Scoped to one admin, and held in memory.** Two decisions worth stating plainly:
 *
 *  - It is *not* a `settings` row. `SETTINGS_REGISTRY` is closed and correctly has no
 *    key for it, because a platform-wide flag would mean one admin turning preview on
 *    changes what every consumer sees. Preview is a property of who is looking.
 *  - It is *not* persisted. It is per-process, expiring, per-admin state: losing it on
 *    a restart means an admin sees the real consumer experience again, which is the
 *    safe direction to fail in. There is one API process in V1 (§8.2, no queue), so
 *    there is nothing to share it with.
 *
 * W3 honours it at the one place that matters — `TryOnService` reads
 * {@link isPreviewActive} and serves a canned result instead of calling upstream, so
 * no quota is consumed, no budget is spent and no `usage_ledger` row is written.
 */
@Injectable()
export class PreviewModeService {
  private readonly logger = new Logger(PreviewModeService.name);

  /** adminId → when the flag lapses. Absent means preview mode is off. */
  private readonly expiries = new Map<string, number>();

  /** Turns preview mode on or off for one admin. */
  setPreviewMode(adminId: string, enabled: boolean): PreviewModeResponseDto {
    if (enabled) {
      this.expiries.set(adminId, Date.now() + PREVIEW_MODE_TTL_MS);
      this.logger.log(
        'Preview mode enabled — generations will not be spent for this admin (A-31).',
      );
    } else {
      this.expiries.delete(adminId);
    }
    return this.getState(adminId);
  }

  /**
   * The predicate W3's try-on path calls. Never throws, never awaits: it sits in front
   * of a generation, and a config lookup that can fail there is a generation that can
   * fail there.
   */
  isPreviewActive(adminId: string | undefined): boolean {
    if (adminId === undefined) {
      return false;
    }
    const expiresAt = this.expiries.get(adminId);
    if (expiresAt === undefined) {
      return false;
    }
    if (expiresAt <= Date.now()) {
      this.expiries.delete(adminId);
      return false;
    }
    return true;
  }

  /** `GET /settings/preview` — the current state for this admin. */
  getState(adminId: string): PreviewModeResponseDto {
    const active = this.isPreviewActive(adminId);
    const dto = new PreviewModeResponseDto();
    dto.enabled = active;
    dto.expiresAt = active ? new Date(this.expiries.get(adminId) as number) : null;
    return dto;
  }
}
