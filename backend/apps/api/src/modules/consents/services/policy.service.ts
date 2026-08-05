import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';

import {
  ConflictException,
  ErrorCode,
  NotFoundException,
  type ICurrentUser,
} from '@library/common';
import { runInTransaction } from '@library/database';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import type { Locale } from '@api/modules/users/enums/locale.enum';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import { PolicyResponseDto, PolicyVersionResponseDto } from '../dto/policy-response.dto';
import { PolicyVersion } from '../entities/policy-version.entity';
import { toPolicyResponse, toPolicyVersionResponse } from '../mappers/policy.mapper';

import type { CreatePolicyVersionDto } from '../dto/create-policy-version.dto';

/**
 * The slice of the current policy other services need. Deliberately not the entity:
 * `ConsentsService` needs an id and a version string, not four bodies of Markdown.
 */
export interface CurrentPolicySummary {
  readonly id: string;
  readonly version: string;
  readonly effectiveFrom: Date;
}

/**
 * `policy_versions` (§4.10, C-11, C-12).
 *
 * Exactly one row is current at a time — `UQ_policy_versions_current` enforces it —
 * and that row is what every consent is measured against. It is therefore read on the
 * try-on hot path, once per generation, so it is **cached in memory** and invalidated
 * on publish. Publishing is a once-a-quarter admin action; reading is a per-request
 * one, and the cache is the difference between those two facts.
 */
@Injectable()
export class PolicyService {
  private readonly logger = new Logger(PolicyService.name);

  /** The in-flight or resolved current policy. `null` means "not loaded". */
  private cached: Promise<PolicyVersion> | null = null;

  constructor(
    @InjectRepository(PolicyVersion)
    private readonly policies: Repository<PolicyVersion>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
  ) {}

  /** Drops the cache. Called on publish; exposed so a test can force a reload. */
  invalidate(): void {
    this.cached = null;
  }

  /**
   * The current policy version, cached.
   *
   * A rejected load clears the cache rather than being memoised: a transient database
   * error must not turn into a permanently broken consent gate.
   */
  async currentPolicy(): Promise<PolicyVersion> {
    if (this.cached === null) {
      this.cached = this.loadCurrent().catch((error: unknown) => {
        this.cached = null;
        throw error;
      });
    }
    return this.cached;
  }

  /** The current policy narrowed to what a cross-module caller needs. */
  async currentSummary(): Promise<CurrentPolicySummary> {
    const policy = await this.currentPolicy();
    return { id: policy.id, version: policy.version, effectiveFrom: policy.effectiveFrom };
  }

  /** `GET /consents/policy` — the gate text, in one locale (C-11). */
  async getCurrentForLocale(locale: Locale): Promise<PolicyResponseDto> {
    return toPolicyResponse(await this.currentPolicy(), locale);
  }

  /** `GET /settings/policy` — the whole row, both translations (§5.4). */
  async getCurrentForAdmin(): Promise<PolicyVersionResponseDto> {
    return toPolicyVersionResponse(await this.currentPolicy());
  }

  /**
   * `POST /settings/policy` — publish a new version (C-12).
   *
   * Two writes against `policy_versions` guarded by a partial unique index, so they go
   * in one transaction: clearing the old `isCurrent` and inserting the new row cannot
   * be allowed to half-happen, or the index leaves the product with no current policy
   * and every consumer locked out of the fitting room.
   *
   * Nothing is edited and nothing is deleted. The superseded row stays exactly as the
   * consumers who agreed to it read it.
   */
  async publish(
    dto: CreatePolicyVersionDto,
    actor: ICurrentUser,
  ): Promise<PolicyVersionResponseDto> {
    const clash = await this.policies.findOne({ where: { version: dto.version } });
    if (clash !== null) {
      throw new ConflictException(ErrorCode.RESOURCE_CONFLICT, {
        message: 'A policy with that version number already exists. Choose a new version.',
        details: { version: dto.version },
      });
    }

    const published = await runInTransaction(
      this.dataSource,
      async (manager) => {
        const repository = manager.getRepository(PolicyVersion);

        // Clear first: UQ_policy_versions_current allows exactly one true.
        await repository.update({ isCurrent: true }, { isCurrent: false });

        return repository.save(
          repository.create({
            version: dto.version,
            effectiveFrom:
              dto.effectiveFrom === undefined ? new Date() : new Date(dto.effectiveFrom),
            isCurrent: true,
            bodyEn: dto.bodyEn,
            bodyUr: dto.bodyUr,
            summaryEn: dto.summaryEn,
            summaryUr: dto.summaryUr,
            retentionSummary: {
              photoDays: dto.retentionSummary.photoDays,
              rendersLifetime: dto.retentionSummary.rendersLifetime,
            },
          }),
        );
      },
      { label: 'PolicyService.publish' },
    );

    this.invalidate();

    // After commit (§2.9 rule 3). Two actions because the registry distinguishes
    // authoring a version from putting it in force, and A-3 wants both readable.
    for (const action of [
      AUDIT_ACTIONS.POLICY_VERSION_CREATED,
      AUDIT_ACTIONS.POLICY_VERSION_PUBLISHED,
    ]) {
      this.events.emit(
        AUDIT_RECORD_EVENT,
        new AuditRecordEvent({
          action,
          targetType: AUDIT_TARGET_TYPES.POLICY_VERSION,
          actorId: actor.id,
          actorRole: actor.role,
          targetId: published.id,
          targetLabel: published.version,
          metadata: {
            version: published.version,
            effectiveFrom: published.effectiveFrom.toISOString(),
            photoRetentionDays: published.retentionSummary.photoDays,
          },
        }),
      );
    }

    this.logger.log(
      `Policy version ${published.version} is now current — everyone must re-consent.`,
    );

    return toPolicyVersionResponse(published);
  }

  private async loadCurrent(): Promise<PolicyVersion> {
    const policy = await this.policies.findOne({ where: { isCurrent: true } });
    if (policy === null) {
      // The seeder guarantees one exists (§4.10). Reaching this means the database
      // has been edited by hand, so it is a 404 with a message that does not blame
      // the consumer for it.
      throw new NotFoundException(ErrorCode.CONSENT_POLICY_NOT_FOUND);
    }
    return policy;
  }
}
