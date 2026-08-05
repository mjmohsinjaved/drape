import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditController } from './controllers/audit.controller';
import { AuditLogEntry } from './entities/audit-log-entry.entity';
import { AuditListener } from './listeners/audit.listener';
import { AuditService } from './services/audit.service';

/**
 * A-3 / §5.19 — the append-only audit log.
 *
 * Owns `audit_log` (§4.33) and exports `AuditService` for the handful of callers that
 * genuinely need a synchronous write (A-34 audits a moderation-queue *read*, so the
 * row has to exist before the response goes out). Everything else emits
 * `AUDIT_RECORD_EVENT` and is served by `AuditListener` — no import required.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLogEntry])],
  controllers: [AuditController],
  providers: [AuditService, AuditListener],
  exports: [AuditService],
})
export class AuditModule {}
