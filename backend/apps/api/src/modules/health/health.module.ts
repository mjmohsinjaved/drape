import { Module } from '@nestjs/common';

import { HealthController } from './controllers/health.controller';
import { HealthService } from './services/health.service';

/**
 * ARCHITECTURE §5.21 — liveness and readiness.
 *
 * Owns no entities (§4.33) and exports nothing: no other module depends on health.
 * `DatabaseConnectionService` and `StorageService` are resolved from the global
 * `DatabaseModule` / `StorageModule` imported by the composition root.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
