import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, LessThan, Repository } from 'typeorm';

import { MILLISECONDS_PER_HOUR } from '@library/common';

import { Enquiry } from '@api/modules/enquiries/entities/enquiry.entity';
import { EnquiryStatus } from '@api/modules/enquiries/enums/enquiry-status.enum';
import { Garment } from '@api/modules/garments/entities/garment.entity';
import { PublishState } from '@api/modules/garments/enums/publish-state.enum';
import { TestRenderState } from '@api/modules/garments/enums/test-render-state.enum';
import { ModerationQueueService } from '@api/modules/moderation/services/moderation-queue.service';

import { AdminOverviewResponseDto } from '../dto/analytics-response.dto';

import { UsageAnalyticsService } from './usage-analytics.service';

import type { AnalyticsWindow } from '../queries/analytics-window';

/**
 * **The A-1 landing view — ARCHITECTURE §5.18.**
 *
 * > "Admin landing view on `/dashboard`: new enquiries awaiting reply, generations used
 * > against the monthly budget, garments waiting on an approved test render, and items
 * > flagged for review."
 *
 * Four tiles, four owners. This service assembles them and owns none of the underlying
 * data: the budget half comes from `quota` through {@link UsageAnalyticsService}, and
 * the moderation count from `moderation`'s own service rather than from a second query
 * against a table this module has no business reading. `enquiries` and `garments` are
 * counted directly, because both are `COUNT`s over indexed columns and neither module
 * exposes a counting method that would save anything.
 *
 * ### Why the A-33 usage block is nested here rather than on its own route
 *
 * §5.18 declares seven analytics routes and a usage dashboard is not among them —
 * `GET /admin/usage` in §5.16 is `quota`'s. But A-1 asks this screen for "generations
 * used against the monthly budget", and A-33 asks for the cache ratio that `quota`
 * structurally cannot produce (C-22: a cache hit writes no ledger row). Nesting the
 * full A-33 block under the tile that already needed part of it satisfies both without
 * inventing an eighth route that the OpenAPI contract check (B-4) would flag as
 * undeclared.
 *
 * ### Five counts, no rows
 *
 * Every figure below is a `COUNT`. The landing screen is the most-loaded page in the
 * admin console and it must stay a handful of index scans however large the platform
 * gets (§5.18).
 */
@Injectable()
export class OverviewService {
  constructor(
    @InjectRepository(Enquiry)
    private readonly enquiries: Repository<Enquiry>,
    @InjectRepository(Garment)
    private readonly garments: Repository<Garment>,
    private readonly moderation: ModerationQueueService,
    private readonly usage: UsageAnalyticsService,
  ) {}

  /** `GET /admin/analytics/overview` (A-1, A-33, §5.18). */
  async overview(
    window: AnalyticsWindow,
    now: Date = new Date(),
  ): Promise<AdminOverviewResponseDto> {
    const staleBefore = new Date(now.getTime() - 24 * MILLISECONDS_PER_HOUR);

    const [newEnquiries, staleEnquiries, awaitingTestRender, flagged, moderation, usage] =
      await Promise.all([
        this.enquiries.count({ where: { status: EnquiryStatus.NEW } }),
        // A-25: "enquiries untouched after 24 hours are highlighted".
        // `IDX_enquiries_firstRespondedAt WHERE "firstRespondedAt" IS NULL` (§4.23) is
        // this predicate exactly.
        this.enquiries.count({
          where: { firstRespondedAt: IsNull(), createdAt: LessThan(staleBefore) },
        }),
        // A-1: a garment cannot be published until a test render is approved (A-11), so
        // "waiting" is a draft whose render has not been approved yet.
        this.garments.count({
          where: [
            { publishState: PublishState.DRAFT, testRenderState: TestRenderState.PENDING },
            { publishState: PublishState.DRAFT, testRenderState: TestRenderState.NONE },
          ],
        }),
        this.garments.count({ where: { flaggedForReview: true } }),
        this.moderation.pendingSummary(),
        this.usage.usage(window, now),
      ]);

    const dto = new AdminOverviewResponseDto();
    dto.newEnquiries = newEnquiries;
    dto.staleEnquiries = staleEnquiries;
    dto.garmentsAwaitingTestRender = awaitingTestRender;
    dto.garmentsFlaggedForReview = flagged;
    dto.moderationItemsPending = moderation.pending;
    dto.usage = usage;
    return dto;
  }
}
