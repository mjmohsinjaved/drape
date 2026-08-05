import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, type ObjectLiteral, type SelectQueryBuilder } from 'typeorm';

import { Role } from '@library/common';

import { Enquiry } from '@api/modules/enquiries/entities/enquiry.entity';
import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { Verdict } from '@api/modules/shortlist/enums/verdict.enum';
import { User } from '@api/modules/users/entities/user.entity';

import { FunnelResponseDto, FunnelStepResponseDto } from '../dto/analytics-response.dto';
import { buildFunnel, type FunnelCounts } from '../queries/funnel-math';

import type { AnalyticsWindow } from '../queries/analytics-window';

/** Verdicts that count as "≥1 star" in A-36. `NOT_FOR_ME` is not one (§4.20). */
const STAR_VERDICTS: readonly Verdict[] = [Verdict.LOVE_IT, Verdict.MAYBE];

/**
 * **A-36 — signups → email verified → photo uploaded → first try-on → ≥1 star → enquiry.**
 *
 * ### Six counts, one cohort
 *
 * Every step counts members of the **same set**: consumers who signed up inside the
 * window. Counting "photos uploaded during the window" instead would put a consumer who
 * signed up in March into February's photo-upload rate, and the funnel would stop
 * describing anybody's journey. So the cohort is defined once, as a correlated subquery
 * over `users`, and each of the five later steps asks "how many distinct members of that
 * set appear in my table?".
 *
 * ### Six queries rather than one join
 *
 * A single query with five `LEFT JOIN`s across `person_photos`, `tryon_results`,
 * `shortlist_items` and `enquiries` would multiply rows against each other and then need
 * `COUNT(DISTINCT)` on every column to undo the damage — a plan that gets worse with
 * every render a popular consumer produces. Six independent `COUNT`s against a subquery
 * on an indexed `createdAt` are each trivial, none of them returns a row, and all six
 * run concurrently. §5.18: bounded and indexed-friendly.
 *
 * ### S-10 note
 *
 * `person_photos` appears here as `COUNT(DISTINCT "userId")` and in no other form. A
 * count is not a photograph: no key is selected, nothing is signed, and there is no
 * shape this query could return that identifies an image. A-16 already defines what an
 * admin may know about a consumer, and a cohort count discloses strictly less.
 */
@Injectable()
export class FunnelService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(PersonPhoto)
    private readonly photos: Repository<PersonPhoto>,
    @InjectRepository(TryOnResult)
    private readonly results: Repository<TryOnResult>,
    @InjectRepository(ShortlistItem)
    private readonly shortlist: Repository<ShortlistItem>,
    @InjectRepository(Enquiry)
    private readonly enquiries: Repository<Enquiry>,
  ) {}

  /** `GET /admin/analytics/funnel` (A-36, §5.18). */
  async funnel(window: AnalyticsWindow): Promise<FunnelResponseDto> {
    const counts = await this.collect(window);
    const steps = buildFunnel(counts);

    const dto = new FunnelResponseDto();
    dto.from = window.from;
    dto.to = window.to;
    dto.cohortSize = counts.SIGNUP;
    dto.steps = steps.map((step) => {
      const row = new FunnelStepResponseDto();
      row.step = step.step;
      row.count = step.count;
      row.conversionFromStart = step.conversionFromStart;
      row.conversionFromPrevious = step.conversionFromPrevious;
      row.droppedFromPrevious = step.droppedFromPrevious;
      return row;
    });
    return dto;
  }

  /**
   * The six raw counts. Separated from {@link funnel} so the arithmetic that turns them
   * into rates is a pure function that can be tested from a literal (E-5).
   */
  async collect(window: AnalyticsWindow): Promise<FunnelCounts> {
    const [signup, emailVerified, photoUploaded, firstTryOn, shortlisted, enquiry] =
      await Promise.all([
        this.cohortSize(window),
        this.verifiedInCohort(window),
        this.distinctInCohort(this.photos, window),
        this.distinctInCohort(this.results, window),
        this.starredInCohort(window),
        this.distinctInCohort(this.enquiries, window),
      ]);

    return {
      SIGNUP: signup,
      EMAIL_VERIFIED: emailVerified,
      PHOTO_UPLOADED: photoUploaded,
      FIRST_TRYON: firstTryOn,
      SHORTLISTED: shortlisted,
      ENQUIRY: enquiry,
    };
  }

  /* -----------------------------------------------------------------------------------------
   * Internals — every one a COUNT, none of them returning a row
   * -------------------------------------------------------------------------------------- */

  private cohortSize(window: AnalyticsWindow): Promise<number> {
    return this.cohortQuery(window).getCount();
  }

  private verifiedInCohort(window: AnalyticsWindow): Promise<number> {
    return this.cohortQuery(window).andWhere('u.emailVerifiedAt IS NOT NULL').getCount();
  }

  /**
   * Distinct cohort members appearing in a table that carries a `userId`.
   *
   * One method for three tables, because the question is identical and only the
   * repository differs. Nothing about the table is interpolated — the alias is `t` and
   * TypeORM resolves the real name from the repository's metadata, so there is no
   * identifier in this string that a caller could influence.
   */
  private async distinctInCohort(
    repository: Repository<ObjectLiteral>,
    window: AnalyticsWindow,
  ): Promise<number> {
    const row = await repository
      .createQueryBuilder('t')
      .select('COUNT(DISTINCT t."userId")', 'reached')
      .where(`t."userId" IN (${this.cohortSubQuery()})`, {
        from: window.from,
        to: window.to,
        role: Role.CONSUMER,
      })
      .getRawOne<{ reached: string }>();

    return Number(row?.reached ?? 0);
  }

  /** A-36's "≥1 star" — `LOVE_IT` or `MAYBE`. `NOT_FOR_ME` is a verdict, not a star (§4.20). */
  private async starredInCohort(window: AnalyticsWindow): Promise<number> {
    const row = await this.shortlist
      .createQueryBuilder('t')
      .select('COUNT(DISTINCT t."userId")', 'reached')
      .where('t.verdict IN (:...verdicts)', { verdicts: STAR_VERDICTS })
      .andWhere(`t."userId" IN (${this.cohortSubQuery()})`, {
        from: window.from,
        to: window.to,
        role: Role.CONSUMER,
      })
      .getRawOne<{ reached: string }>();

    return Number(row?.reached ?? 0);
  }

  /** The cohort itself: consumers who signed up inside the window. */
  private cohortQuery(window: AnalyticsWindow): SelectQueryBuilder<User> {
    return this.users
      .createQueryBuilder('u')
      .where('u.role = :role', { role: Role.CONSUMER })
      .andWhere('u.createdAt >= :from', { from: window.from })
      .andWhere('u.createdAt <= :to', { to: window.to })
      .andWhere('u.deletedAt IS NULL');
  }

  /**
   * The cohort as a subquery, for the five `IN (…)` predicates.
   *
   * Written out rather than built with `getQuery()` so the parameter names are stable
   * and visible: a subquery whose placeholders are generated leaves the caller guessing
   * which names to bind.
   */
  private cohortSubQuery(): string {
    return (
      'SELECT "id" FROM "users" ' +
      'WHERE "role" = :role AND "createdAt" >= :from AND "createdAt" <= :to ' +
      'AND "deletedAt" IS NULL'
    );
  }
}
