import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { ConflictException, ConsentException, ErrorCode, type ICurrentUser } from '@library/common';

import { Locale } from '@api/modules/users/enums/locale.enum';

import { ConsentStatusResponseDto } from '../dto/consent-status-response.dto';
import { Consent } from '../entities/consent.entity';
import { ConsentStatus } from '../enums/consent-status.enum';

import { PolicyService } from './policy.service';

import type { CreateConsentDto } from '../dto/create-consent.dto';

/** `consents.userAgent` is `varchar(512)` (§4.11). */
const MAX_USER_AGENT_LENGTH = 512;

/** What the controller knows about the request that recorded a consent (C-12). */
export interface ConsentRequestContext {
  readonly ip: string;
  readonly userAgent: string;
}

/**
 * `consents` (§4.11, C-11, C-12) · **append-only**.
 *
 * The one rule this service exists to hold: **consent is derived, never stored as a
 * flag.** There is no `users.hasConsented` column to forget to clear, because
 * "consented" means "a `consents` row exists against the row `policy_versions` marks
 * current". Publishing a new version therefore re-gates everyone atomically, with no
 * migration, no backfill and no window in which the two disagree.
 *
 * {@link resolveStatus} is that predicate, and it is the only implementation of it.
 * The C-11 gate reads it through `GET /consents/me`; the §8.1 step-3 guard chain calls
 * {@link assertConsentIsCurrent}. Neither reimplements the comparison.
 */
@Injectable()
export class ConsentsService {
  private readonly logger = new Logger(ConsentsService.name);

  constructor(
    @InjectRepository(Consent)
    private readonly consents: Repository<Consent>,
    private readonly policies: PolicyService,
  ) {}

  /**
   * **The** consent predicate (C-12).
   *
   * `GRANTED` — a row exists against the current version.
   * `STALE`   — she has consented, but to an older version.
   * `REQUIRED`— she never has.
   *
   * The two lookups are deliberate: the first answers the common case in one indexed
   * hit on `IDX_consents_userId_createdAt`, and the second only runs when the answer
   * is already "no", to tell `CONSENT_STALE` apart from `CONSENT_REQUIRED` — a
   * distinction the consumer feels, because one of them says "have a read and confirm
   * to carry on" and the other says "before your first try-on".
   */
  async resolveStatus(userId: string): Promise<ConsentStatusResponseDto> {
    const current = await this.policies.currentSummary();

    const atCurrent = await this.consents.findOne({
      where: { userId, policyVersionId: current.id },
      order: { createdAt: 'DESC' },
    });

    const dto = new ConsentStatusResponseDto();
    dto.policyVersion = current.version;

    if (atCurrent !== null) {
      dto.status = ConsentStatus.GRANTED;
      dto.grantedAt = atCurrent.grantedAt;
      dto.consentedPolicyVersion = atCurrent.policyVersion;
      return dto;
    }

    const previous = await this.consents.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    dto.status = previous === null ? ConsentStatus.REQUIRED : ConsentStatus.STALE;
    dto.grantedAt = previous?.grantedAt ?? null;
    dto.consentedPolicyVersion = previous?.policyVersion ?? null;
    return dto;
  }

  /** The predicate as a boolean, for callers that only need yes or no. */
  async hasCurrentConsent(userId: string): Promise<boolean> {
    const status = await this.resolveStatus(userId);
    return status.status === ConsentStatus.GRANTED;
  }

  /**
   * Steps 4 and 5 of the §8.1 guard chain, in the order the table gives them.
   *
   * Throws before any spend: no `tryon_jobs` row, no quota, no budget. The try-on
   * module calls this rather than comparing versions itself.
   */
  async assertConsentIsCurrent(userId: string): Promise<void> {
    const status = await this.resolveStatus(userId);

    if (status.status === ConsentStatus.REQUIRED) {
      throw new ConsentException(ErrorCode.CONSENT_REQUIRED, {
        details: { policyVersion: status.policyVersion },
      });
    }
    if (status.status === ConsentStatus.STALE) {
      throw new ConsentException(ErrorCode.CONSENT_STALE, {
        details: {
          policyVersion: status.policyVersion,
          consentedPolicyVersion: status.consentedPolicyVersion,
        },
      });
    }
  }

  /**
   * `POST /consents` — record consent (C-12).
   *
   * **Appends. Always.** Re-consent after a version change inserts a second row; it
   * never updates the first, because the first is the evidence of what she agreed to
   * in July and the second is the evidence of what she agreed to in September. §4.11
   * carries no unique index for exactly this reason, and `AppendOnlyEntity` gives the
   * row no `updatedAt` and no `deletedAt` to change.
   */
  async record(
    user: ICurrentUser,
    dto: CreateConsentDto,
    context: ConsentRequestContext,
  ): Promise<ConsentStatusResponseDto> {
    const current = await this.policies.currentSummary();

    if (dto.policyVersion !== current.version) {
      // The gate was rendered against a version that is no longer in force. Recording
      // it would log agreement to text she never saw.
      throw new ConflictException(ErrorCode.RESOURCE_CONFLICT, {
        message: 'This policy was updated while you were reading. Have another look and confirm.',
        details: { policyVersion: current.version, submittedVersion: dto.policyVersion },
      });
    }

    const consent = this.consents.create({
      userId: user.id,
      policyVersionId: current.id,
      policyVersion: current.version,
      grantedAt: new Date(),
      ip: context.ip,
      userAgent: context.userAgent.slice(0, MAX_USER_AGENT_LENGTH),
      locale: dto.locale ?? user.locale ?? Locale.EN,
    });

    await this.consents.insert(consent);

    this.logger.log(`Consent recorded at policy version ${current.version}.`);

    return this.resolveStatus(user.id);
  }
}
