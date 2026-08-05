import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  ConsentException,
  ErrorCode,
  GuardChainException,
  METRICS,
  MetricsService,
  OwnershipException,
  QuotaException,
  type ICurrentUser,
} from '@library/common';

import { ConsentsService } from '@api/modules/consents';
import { Garment } from '@api/modules/garments/entities/garment.entity';
import { SettingsService } from '@api/modules/settings';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { TryOnJob } from '../entities/tryon-job.entity';
import { JobStatus } from '../enums/job-status.enum';
import {
  checkAccountStatus,
  checkBudget,
  checkConsent,
  checkEmailVerified,
  checkGarmentReady,
  checkIdempotency,
  checkPhotoOwnership,
  checkQuota,
  checkRateLimits,
  checkSession,
  type GuardRejection,
} from '../guards/tryon-guard.predicates';
import {
  PERSON_PHOTO_PORT,
  type PersonPhotoPort,
  type PersonPhotoRef,
} from '../ports/person-photo.port';
import { QUOTA_PORT, type BudgetView, type QuotaPort, type QuotaView } from '../ports/quota.port';

import { TryOnRateLimitService } from './tryon-rate-limit.service';

/** What the caller asks the chain to authorise. */
export interface TryOnGuardInput {
  readonly user: ICurrentUser | undefined;
  readonly garmentId: string;
  /** Omitted means "the active photo" (C-16). */
  readonly personPhotoId?: string;
  readonly idempotencyKey: string;
  /** Client IP as resolved by Express, honouring `TRUST_PROXY`. */
  readonly ip?: string;
}

/**
 * Everything the chain resolved on the way through, so the caller does not fetch any
 * of it a second time. A guard chain that made the service re-read the garment would
 * be a guard chain with a race in it.
 */
export interface TryOnGuardOutcome {
  readonly user: ICurrentUser;
  readonly garment: Garment;
  readonly photo: PersonPhotoRef;
  readonly quota: QuotaView;
  readonly budget: BudgetView;
  /**
   * A previous job under the same idempotency key that already **succeeded**. The
   * caller replays its result instead of generating (§8.4). `null` is the normal case.
   */
  readonly completedJob: TryOnJob | null;
}

/**
 * **PRD §8.1 step 3 — the guard chain, composed.** E-5.
 *
 * > "Guard chain, entirely before any spend."
 *
 * This class does one thing: gather the facts each predicate needs, in the §2.4 order,
 * and stop at the first refusal. The predicates themselves are pure and live next door
 * in `tryon-guard.predicates.ts`; nothing in this file decides *whether* something is
 * allowed, only *what to ask next*.
 *
 * ### Why the order is load-bearing
 *
 * Two things are usually wrong at once — an unverified email and no consent, an
 * exhausted quota and an unpublished garment — and which error she sees decides which
 * screen she lands on. §2.4 fixes the order; `tryon-guard.service.spec.ts` asserts it
 * by arranging several simultaneous failures and checking which code surfaces.
 *
 * ### Why nothing is written here
 *
 * §2.4: "No `tryon_jobs` row is written for a guard-chain rejection." Not one row, not
 * one ledger entry, not one storage read of a photo. The first thing this class does
 * that costs anything at all is the garment lookup at step 9, and by then eight cheap
 * predicates have already had their say.
 *
 * Every refusal increments `tryon.guard_rejected` tagged with its code (E-13), which
 * is what makes "consumers are bouncing off the consent gate" a number rather than a
 * hunch.
 */
@Injectable()
export class TryOnGuardService {
  private readonly logger = new Logger(TryOnGuardService.name);

  constructor(
    @InjectRepository(Garment)
    private readonly garments: Repository<Garment>,
    @InjectRepository(TryOnJob)
    private readonly jobs: Repository<TryOnJob>,
    @Inject(PERSON_PHOTO_PORT)
    private readonly photos: PersonPhotoPort,
    @Inject(QUOTA_PORT)
    private readonly quota: QuotaPort,
    private readonly consents: ConsentsService,
    private readonly settings: SettingsService,
    private readonly rateLimits: TryOnRateLimitService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Runs the chain. Resolves with everything the generation needs, or throws the §2.4
   * code for the first unmet precondition.
   */
  async assertMayGenerate(input: TryOnGuardInput): Promise<TryOnGuardOutcome> {
    // ── 1. session valid ──────────────────────────────────────────────────────
    this.orThrow(checkSession(input.user));
    const user = input.user as ICurrentUser;

    // ── 2. account active and not suspended ───────────────────────────────────
    this.orThrow(checkAccountStatus(user.status));

    // ── 3. email verified if settings require it ──────────────────────────────
    const requireVerification = await this.settings.getBoolean(
      SETTINGS_KEYS.QUOTA_REQUIRE_EMAIL_VERIFICATION,
    );
    this.orThrow(checkEmailVerified(user.emailVerifiedAt, requireVerification));

    // ── 4 & 5. consent recorded at the current policy version ─────────────────
    const consent = await this.consents.resolveStatus(user.id);
    this.orThrow(checkConsent(consent.status));

    // ── 6. monthly quota remaining ────────────────────────────────────────────
    // `quota` raises QUOTA_EXHAUSTED itself, from the ledger it owns. The predicate
    // runs afterwards as defence in depth and as the statement E-5 can test without a
    // database — including the boundary where remaining is exactly zero.
    const quota = await this.quota.assertQuotaAvailable(user.id);
    this.orThrow(checkQuota(quota.remaining, quota.resetsAt));

    // ── 7. per-hour and per-IP rate limits ────────────────────────────────────
    // Between quota and budget, exactly where §2.4 puts them. Which of two
    // simultaneous refusals she sees decides which screen she lands on.
    const accountWindow = await this.rateLimits.accountWindow(user.id);
    this.orThrow(checkRateLimits(accountWindow, this.rateLimits.ipWindow(input.ip)));

    // ── 8. system-wide budget not exhausted ───────────────────────────────────
    const budget = await this.quota.assertBudgetAvailable();
    this.orThrow(checkBudget(budget.used, budget.hardStopAt));

    // ── 9 & 10. garment published with an approved test render ────────────────
    // The category comes along because §4.18 snapshots its name onto the result, and
    // one join here is cheaper than a second query on the spend path.
    const garment = await this.garments.findOne({
      where: { id: input.garmentId },
      relations: { category: true },
    });
    this.orThrow(checkGarmentReady(garment));

    // ── 11. the referenced photo belongs to this user ─────────────────────────
    // `person-photos` owns the predicate and raises PHOTO_NOT_FOUND /
    // PHOTO_NOT_OWNED / PHOTO_BLOCKED_BY_MODERATION from a query whose `where` clause
    // already carries the userId (§9.2). The check below is belt and braces at the one
    // place where getting it wrong sends one consumer's photograph upstream on
    // another's behalf.
    const photo = await this.photos.resolveGenerationPhoto(user.id, input.personPhotoId ?? null);
    this.orThrow(checkPhotoOwnership(photo, user.id));

    // ── 12. idempotency key not already in flight or completed ────────────────
    const existing = await this.jobs.findOne({
      where: { userId: user.id, idempotencyKey: input.idempotencyKey },
    });
    this.orThrow(checkIdempotency(existing));

    return {
      user,
      garment: garment as Garment,
      photo,
      quota,
      budget,
      completedJob: existing !== null && existing.status === JobStatus.SUCCEEDED ? existing : null,
    };
  }

  /**
   * Turns a rejection into the right exception, records the metric, and returns
   * quietly when there is nothing to refuse.
   *
   * The exception *class* matters as much as the code: `OwnershipException` is what
   * `GlobalExceptionFilter` masks (§2.4), `ConsentException` and `QuotaException` are
   * what the §2.5 taxonomy names, and everything else is a plain guard-chain refusal.
   */
  private orThrow(rejection: GuardRejection | null, beforeThrow?: () => void): void {
    if (rejection === null) {
      return;
    }

    this.metrics.increment(METRICS.TRYON_GUARD_REJECTED, { errorCode: rejection.code });
    beforeThrow?.();

    this.logger.debug(`Guard chain refused a generation: ${rejection.code}.`);

    const options = rejection.details === undefined ? {} : { details: rejection.details };

    switch (rejection.code) {
      case ErrorCode.CONSENT_REQUIRED:
      case ErrorCode.CONSENT_STALE:
        throw new ConsentException(rejection.code, options);
      case ErrorCode.QUOTA_EXHAUSTED:
      case ErrorCode.BUDGET_EXHAUSTED:
        throw new QuotaException(rejection.code, options);
      case ErrorCode.PHOTO_NOT_OWNED:
        // Thrown with its true code; the filter returns PHOTO_NOT_FOUND (§2.4).
        throw new OwnershipException(rejection.code, options);
      default:
        throw new GuardChainException(rejection.code, options);
    }
  }
}
