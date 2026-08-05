import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConsentsController } from './controllers/consents.controller';
import { PolicyAdminController } from './controllers/policy-admin.controller';
import { Consent } from './entities/consent.entity';
import { PolicyVersion } from './entities/policy-version.entity';
import { ConsentsService } from './services/consents.service';
import { PolicyService } from './services/policy.service';

/**
 * C-11 / C-12 — the consent gate and the policy versions it is measured against.
 *
 * Exports both services. `ConsentsService.assertConsentIsCurrent()` is steps 4 and 5
 * of the §8.1 guard chain, so `TryOnModule` will import this module in W3;
 * `PolicyService` is exported for the retention and export flows that quote the
 * version a consumer agreed to.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Consent, PolicyVersion])],
  controllers: [ConsentsController, PolicyAdminController],
  providers: [ConsentsService, PolicyService],
  exports: [ConsentsService, PolicyService],
})
export class ConsentsModule {}
