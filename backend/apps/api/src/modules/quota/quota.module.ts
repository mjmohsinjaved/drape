import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SettingsModule } from '@api/modules/settings';
import { ConsumerProfile } from '@api/modules/users/entities/consumer-profile.entity';
import { UsersModule } from '@api/modules/users/users.module';

import { AdminConsumerQuotaController } from './controllers/admin-consumer-quota.controller';
import { AdminUsageController } from './controllers/admin-usage.controller';
import { QuotaController } from './controllers/quota.controller';
import { QuotaLedgerEntry } from './entities/quota-ledger-entry.entity';
import { UsageLedgerEntry } from './entities/usage-ledger-entry.entity';
import { QuotaOverrideListener } from './listeners/quota-override.listener';
import { BudgetService } from './services/budget.service';
import { GenerationSpendService } from './services/generation-spend.service';
import { QuotaService } from './services/quota.service';

/**
 * `quota` — PRD C-5, C-6, A-18, A-28, A-29, A-33, §8.4 · ARCHITECTURE §4.26, §4.27, §5.16.
 *
 * ### The property the whole module is built around
 *
 * `quota_ledger` and `usage_ledger` are **append-only, and every balance is derived by
 * summing them** (§4.0 rule 10, CLAUDE.md). There is no balance column on any entity
 * here, no cached total on a service, and no field on any DTO fed from one. The
 * migration backs the rule at the database level with `no_update_*` and `no_delete_*`
 * rules, so even a mistake in this module cannot rewrite history — the worst it can do
 * is append a row that has to be compensated by another.
 *
 * ### Entities registered here
 *
 * `QuotaLedgerEntry` and `UsageLedgerEntry` are owned by this module (§4.33).
 * `ConsumerProfile` is a **read-only dependency**: §4.26 defines the monthly grant as
 * `consumer_profiles.monthlyQuotaOverride ?? settings['quota.defaultMonthly']`, so the
 * lazy grant has to read that column. `modules/users` owns and writes it, exports its
 * `TypeOrmModule`, and is imported here for exactly that repository — the same
 * accommodation, in the other direction, that `users.module.ts` documents for
 * `QuotaLedgerEntry`.
 *
 * The edge is one-way. `UsersModule` does not import this module; it emits
 * `user.quota_override_changed` and this module listens. No cycle, no `forwardRef`.
 *
 * ### What is exported, and who wants it
 *
 * | Export | Consumer | For |
 * | --- | --- | --- |
 * | `GenerationSpendService` | `tryon` | the three §8.4 verbs: check, charge, release |
 * | `QuotaService` | `tryon`, `users` | `GET /quota/me`, the A-16 "generations used this month" column |
 * | `BudgetService` | `analytics`, `health` | the A-33 figures and the E-14 budget alert |
 *
 * `modules/catalog` is deliberately **not** on that list and must never appear on it.
 * A-29: "on hard stop the catalog stays browsable". The budget check belongs in the
 * try-on guard chain and nowhere else — a browse path that could throw
 * `BUDGET_EXHAUSTED` would close the shop as well as the fitting room.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([QuotaLedgerEntry, UsageLedgerEntry, ConsumerProfile]),
    UsersModule,
    SettingsModule,
  ],
  controllers: [QuotaController, AdminUsageController, AdminConsumerQuotaController],
  providers: [QuotaService, BudgetService, GenerationSpendService, QuotaOverrideListener],
  exports: [QuotaService, BudgetService, GenerationSpendService],
})
export class QuotaModule {}
