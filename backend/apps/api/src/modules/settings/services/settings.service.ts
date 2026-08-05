import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { ErrorCode, ValidationException, type ICurrentUser } from '@library/common';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { SettingsValueType } from '@api/modules/settings/enums/settings-value-type.enum';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  type AuditAction,
} from '@api/shared/constants/audit-actions.constant';
import {
  SETTINGS_KEYS,
  SETTINGS_REGISTRY,
  type SettingDefinition,
  type SettingsKey,
} from '@api/shared/constants/settings-keys.constant';

import { BudgetPolicyResponseDto, SettingResponseDto } from '../dto/setting-response.dto';
import { Setting } from '../entities/setting.entity';
import { toSettingResponse } from '../mappers/settings.mapper';
import { definitionFor, validateSettingValue } from '../validation/setting-value.validator';

import type { UpdateSettingsDto } from '../dto/update-settings.dto';

/** A validated change, ready to write. */
interface ResolvedChange {
  readonly definition: SettingDefinition;
  readonly value: unknown;
}

/**
 * The typed, cached read/write layer over `settings` (§4.28, §5.4).
 *
 * **Every module in W3–W7 calls this on the hot path** — the try-on guard chain wants
 * `quota.defaultMonthly` and `quota.requireEmailVerification` before every generation,
 * the catalog wants `catalog.showPricesPublicly` on every browse, share and enquiry
 * each check a toggle. Seventeen keys that change a handful of times a year must not
 * cost a query per request, so the whole map is resolved once and held in memory,
 * with **explicit invalidation on write**. There is no TTL: a TTL would mean a window
 * in which an admin has turned sharing off and the API has not noticed.
 *
 * Two further guarantees worth knowing about:
 *
 *  - **The registry wins.** A key's type, description, `isPublic` flag and default all
 *    come from `SETTINGS_REGISTRY`, never from the row. A row for a key that is no
 *    longer in the registry is ignored; a key with no row falls back to the registry
 *    default. The seeder can therefore lag behind the code without breaking a read.
 *  - **A bad row degrades, it does not crash.** If a stored value fails validation —
 *    hand-edited database, a migration gone sideways — the read logs at `warn` and
 *    returns the registry default. A malformed `budget.monthlyGenerations` must not be
 *    able to take the fitting room down.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  /** Resolved key → value. `null` means "not loaded"; a rejected load clears itself. */
  private cache: Promise<ReadonlyMap<SettingsKey, unknown>> | null = null;

  constructor(
    @InjectRepository(Setting)
    private readonly settings: Repository<Setting>,
    private readonly events: EventEmitter2,
  ) {}

  /* -----------------------------------------------------------------------------------------
   * Typed getters — the hot path
   * -------------------------------------------------------------------------------------- */

  /**
   * A `NUMBER` setting.
   *
   * ```typescript
   * const monthly = await this.settings.getNumber(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY);
   * ```
   *
   * Asking for the wrong accessor is a programming error, not a runtime condition, so
   * it throws a plain `Error` rather than an `AppException` — there is no client-safe
   * message for "the developer used getNumber on a boolean".
   */
  async getNumber(key: SettingsKey): Promise<number> {
    const value = await this.readTyped(key, SettingsValueType.NUMBER);
    return typeof value === 'number' ? value : 0;
  }

  /** A `BOOLEAN` setting. */
  async getBoolean(key: SettingsKey): Promise<boolean> {
    return (await this.readTyped(key, SettingsValueType.BOOLEAN)) === true;
  }

  /** A `STRING` setting. `null` for a key an admin has not supplied yet (A-27). */
  async getString(key: SettingsKey): Promise<string | null> {
    const value = await this.readTyped(key, SettingsValueType.STRING);
    return typeof value === 'string' ? value : null;
  }

  /** A `JSON` setting. The caller names the shape; the registry guarantees only that it parsed. */
  async getJson<T>(key: SettingsKey): Promise<T> {
    return (await this.readTyped(key, SettingsValueType.JSON)) as T;
  }

  /** The raw resolved value, whatever its type. Used by the brand projection. */
  async getValue(key: SettingsKey): Promise<unknown> {
    return (await this.values()).get(key) ?? null;
  }

  /** Every resolved value, for callers that need more than one (the brand projection). */
  async values(): Promise<ReadonlyMap<SettingsKey, unknown>> {
    if (this.cache === null) {
      this.cache = this.load().catch((error: unknown) => {
        this.cache = null;
        throw error;
      });
    }
    return this.cache;
  }

  /**
   * A-29 — the monthly budget with both of its thresholds, derived in one place.
   *
   * The soft warning at `warnThresholdPercent` and the hard stop at 100% are computed
   * here rather than at each call site, so W3's generation path and E-14's alert can
   * never disagree about where the line is.
   */
  async getBudgetPolicy(): Promise<BudgetPolicyResponseDto> {
    const monthlyGenerations = await this.getNumber(SETTINGS_KEYS.BUDGET_MONTHLY_GENERATIONS);
    const warnThresholdPercent = await this.getNumber(SETTINGS_KEYS.BUDGET_WARN_THRESHOLD_PERCENT);

    const dto = new BudgetPolicyResponseDto();
    dto.monthlyGenerations = monthlyGenerations;
    dto.warnThresholdPercent = warnThresholdPercent;
    dto.warnAt = Math.floor((monthlyGenerations * warnThresholdPercent) / 100);
    dto.hardStopAt = monthlyGenerations;
    return dto;
  }

  /** Drops the cache. Called on every write; exposed so a test can force a reload. */
  invalidate(): void {
    this.cache = null;
  }

  /* -----------------------------------------------------------------------------------------
   * Admin surface
   * -------------------------------------------------------------------------------------- */

  /** `GET /settings` — the full map (§5.4). Registry order, so the screen is stable. */
  async findAll(): Promise<SettingResponseDto[]> {
    const [resolved, rows] = await Promise.all([this.values(), this.settings.find()]);
    const byKey = new Map(rows.map((row) => [row.key, row]));

    return SETTINGS_REGISTRY.map((definition) =>
      toSettingResponse(
        definition,
        resolved.get(definition.key) ?? null,
        byKey.get(definition.key),
      ),
    );
  }

  /**
   * `PATCH /settings` — update one or more keys (§5.4, A-27…A-30).
   *
   * Validate everything first, write once, invalidate, then audit. A rejected value in
   * position three must not leave positions one and two applied, so nothing is written
   * until every change has passed the registry.
   */
  async update(dto: UpdateSettingsDto, actor: ICurrentUser): Promise<SettingResponseDto[]> {
    const seen = new Set<string>();
    const changes: ResolvedChange[] = dto.changes.map((change) => {
      if (seen.has(change.key)) {
        throw new ValidationException(ErrorCode.SETTINGS_VALUE_INVALID, {
          message: 'That setting appears twice in the same update.',
          details: { settingKey: change.key },
        });
      }
      seen.add(change.key);

      const definition = definitionFor(change.key);
      return { definition, value: validateSettingValue(definition, change.value) };
    });

    // Captured before the write so the audit row can carry a before/after diff.
    const before = await this.values();

    const saved = await this.persist(changes, actor.id);
    this.invalidate();

    for (const change of changes) {
      this.emitSettingAudit(change, before.get(change.definition.key) ?? null, actor);
    }

    const rowByKey = new Map(saved.map((row) => [row.key, row]));
    const resolved = await this.values();
    return changes.map((change) =>
      toSettingResponse(
        change.definition,
        resolved.get(change.definition.key) ?? null,
        rowByKey.get(change.definition.key),
      ),
    );
  }

  /**
   * Writes one key on behalf of another service in this module — the brand-logo
   * finalise step, which has already proved the object exists in storage.
   *
   * Not exported from the module: everything outside `settings` goes through
   * `PATCH /settings`, so there is exactly one audited write path per key.
   */
  async setInternal(
    key: SettingsKey,
    value: unknown,
    actor: ICurrentUser,
    action: AuditAction,
  ): Promise<SettingResponseDto> {
    const definition = definitionFor(key);
    const change: ResolvedChange = { definition, value: validateSettingValue(definition, value) };

    const before = await this.values();
    const [row] = await this.persist([change], actor.id);
    this.invalidate();

    this.emitSettingAudit(change, before.get(key) ?? null, actor, action);

    const resolved = await this.values();
    return toSettingResponse(definition, resolved.get(key) ?? null, row);
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  private async readTyped(key: SettingsKey, expected: SettingsValueType): Promise<unknown> {
    const definition = definitionFor(key);
    if (definition.valueType !== expected) {
      throw new Error(
        `Setting "${key}" is ${definition.valueType}, not ${expected}. Use the matching getter.`,
      );
    }
    return (await this.values()).get(key) ?? null;
  }

  /**
   * Resolves the registry against the rows, once.
   *
   * The registry drives the loop, not the rows: an orphaned row for a retired key is
   * ignored, and a key with no row yet takes its registry default, so the map always
   * has exactly one entry per registered key.
   */
  private async load(): Promise<ReadonlyMap<SettingsKey, unknown>> {
    const rows = await this.settings.find();
    const stored = new Map(rows.map((row) => [row.key, row.value]));

    const resolved = new Map<SettingsKey, unknown>();
    for (const definition of SETTINGS_REGISTRY) {
      const raw = stored.has(definition.key) ? stored.get(definition.key) : definition.defaultValue;
      resolved.set(definition.key, this.coerceOrDefault(definition, raw));
    }
    return resolved;
  }

  /** A stored value that no longer validates degrades to the registry default, loudly. */
  private coerceOrDefault(definition: SettingDefinition, raw: unknown): unknown {
    if (raw === null || raw === undefined) {
      return definition.defaultValue;
    }
    try {
      return validateSettingValue(definition, raw);
    } catch {
      this.logger.warn(
        `Stored value for "${definition.key}" failed validation — falling back to the registry default.`,
      );
      return definition.defaultValue;
    }
  }

  /**
   * One `save()` for the whole batch. TypeORM wraps a multi-entity save in a
   * transaction, and every row is a `settings` row, so §2.9 rule 3's two-table
   * threshold is not reached and a `QueryRunner` would add nothing.
   *
   * `valueType`, `description` and `isPublic` are re-synced from the registry on every
   * write. That is the mechanism by which the `isPublic` **column** can never drift
   * away from the registry and quietly widen `GET /settings/brand`.
   */
  private async persist(changes: readonly ResolvedChange[], actorId: string): Promise<Setting[]> {
    const keys = changes.map((change) => change.definition.key);
    const existing = await this.settings.find({ where: { key: In(keys) } });
    const byKey = new Map(existing.map((row) => [row.key, row]));

    const rows = changes.map(({ definition, value }) => {
      const row = byKey.get(definition.key) ?? this.settings.create({ key: definition.key });
      row.value = value;
      row.valueType = definition.valueType;
      row.description = definition.description;
      row.isPublic = definition.isPublic;
      row.updatedBy = actorId;
      return row;
    });

    return this.settings.save(rows);
  }

  /**
   * A-3 — every settings change is audited.
   *
   * Three actions, because the registry distinguishes them and the A-3 filter is only
   * useful if it can isolate "who raised the budget" from "who changed the brand
   * colour". `metadata` goes through `redact()` inside `AuditService`, which is why a
   * `brand.contactEmail` change records `[EMAIL]` rather than the address (E-12).
   */
  private emitSettingAudit(
    change: ResolvedChange,
    previousValue: unknown,
    actor: ICurrentUser,
    action?: AuditAction,
  ): void {
    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: action ?? auditActionFor(change.definition.key),
        targetType: AUDIT_TARGET_TYPES.SETTING,
        actorId: actor.id,
        actorRole: actor.role,
        targetLabel: change.definition.key,
        metadata: {
          // `settingKey`, not `key`: the redactor drops anything named `key`.
          settingKey: change.definition.key,
          previousValue,
          newValue: change.value,
        },
      }),
    );
  }
}

/** The closed `AUDIT_ACTIONS` registry already distinguishes these three (§4.30). */
function auditActionFor(key: SettingsKey): AuditAction {
  switch (key) {
    case SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY:
      return AUDIT_ACTIONS.QUOTA_DEFAULT_CHANGED;
    case SETTINGS_KEYS.BUDGET_MONTHLY_GENERATIONS:
    case SETTINGS_KEYS.BUDGET_WARN_THRESHOLD_PERCENT:
      return AUDIT_ACTIONS.BUDGET_LIMIT_CHANGED;
    default:
      return AUDIT_ACTIONS.SETTING_UPDATED;
  }
}
