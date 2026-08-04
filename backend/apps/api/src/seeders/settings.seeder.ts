import { In } from 'typeorm';

import { Setting } from '@api/modules/settings/entities/setting.entity';
import {
  SETTINGS_KEYS,
  SETTINGS_REGISTRY,
  type SettingDefinition,
} from '@api/shared/constants/settings-keys.constant';

import {
  readSeedInteger,
  type SeedContext,
  type SeedOutcome,
  type Seeder,
} from './seeder.contract';

/**
 * The default `settings` rows (§4.28) — A-27 brand configuration, A-28 quota, A-29 budget
 * and the A-30 feature toggles.
 *
 * The key registry itself lives in `@api/shared/constants/settings-keys.constant.ts` and is
 * closed. This seeder walks it rather than restating it, so there is exactly one list of
 * keys, types, descriptions and `isPublic` flags in the codebase and no way for the seeded
 * rows to drift from what `PATCH /api/v1/settings` will accept.
 *
 * Two things it deliberately does **not** do:
 *
 *  - **It never updates an existing row.** `QUOTA_DEFAULT_MONTHLY` and friends are *seed*
 *    values (§7). Once the row exists the database is authoritative and an admin changes it
 *    through the audited settings endpoint. Re-running the seed after an admin has raised
 *    the monthly budget must not quietly undo it.
 *  - **It never stores a balance.** Remaining quota and remaining budget are DERIVED with
 *    `SUM(delta)` over `quota_ledger` / `usage_ledger` at read time (§4.0 rule 10).
 *    `budget.monthlyGenerations` is the ceiling, not a countdown.
 */

/**
 * The three keys §7 allows the environment to seed. Everything else takes the registry's
 * product default.
 */
function seedValueFor(definition: SettingDefinition, env: NodeJS.ProcessEnv): unknown {
  switch (definition.key) {
    case SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY:
      return readSeedInteger(env, 'QUOTA_DEFAULT_MONTHLY', 15);
    case SETTINGS_KEYS.BUDGET_MONTHLY_GENERATIONS:
      return readSeedInteger(env, 'BUDGET_DEFAULT_MONTHLY', 2000);
    case SETTINGS_KEYS.BUDGET_WARN_THRESHOLD_PERCENT:
      return readSeedInteger(env, 'BUDGET_WARN_PERCENT', 80);
    default:
      return definition.defaultValue;
  }
}

/**
 * Keys whose registry default is `null` — "no default, an admin must supply it" (A-27).
 * They are still seeded, so the row exists and the settings screen has something to edit,
 * but they are called out in the run summary because launching without them is a mistake.
 */
const MUST_BE_CONFIGURED: readonly string[] = [
  SETTINGS_KEYS.BRAND_WHATSAPP_NUMBER,
  SETTINGS_KEYS.BRAND_INSTAGRAM_HANDLE,
  SETTINGS_KEYS.BRAND_CONTACT_EMAIL,
];

export const settingsSeeder: Seeder = {
  name: 'settings',

  async run(context: SeedContext): Promise<SeedOutcome> {
    const repository = context.manager.getRepository(Setting);

    // Matches `UQ_settings_key UNIQUE ("key") WHERE "deletedAt" IS NULL` (§4.28).
    const existing = await repository.find({
      select: { key: true },
      where: { key: In(SETTINGS_REGISTRY.map((definition) => definition.key)) },
    });
    const existingKeys = new Set(existing.map((row) => row.key));

    const missing = SETTINGS_REGISTRY.filter((definition) => !existingKeys.has(definition.key));

    if (missing.length > 0) {
      await repository.save(
        missing.map((definition) =>
          repository.create({
            key: definition.key,
            value: seedValueFor(definition, context.env),
            valueType: definition.valueType,
            description: definition.description,
            isPublic: definition.isPublic,
            // Seeded rows have no human author. `updatedBy` is set the first time an admin
            // edits the value through PATCH /api/v1/settings (A-3 audits the change).
            updatedBy: null,
          }),
        ),
      );
    }

    const unconfigured = missing
      .filter((definition) => MUST_BE_CONFIGURED.includes(definition.key))
      .map((definition) => definition.key);

    return {
      created: missing.length,
      skipped: existingKeys.size,
      notes:
        unconfigured.length > 0
          ? [`Seeded with no value and required before launch: ${unconfigured.join(', ')}.`]
          : undefined,
    };
  },
};
