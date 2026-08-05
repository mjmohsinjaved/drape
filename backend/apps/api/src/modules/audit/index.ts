/**
 * The `audit` module's public surface.
 *
 * A feature module that wants to be audited needs exactly two of these — the event
 * name and the event class — and should **not** import `AuditService` (§2.9 rule 4).
 */
export { AuditModule } from './audit.module';
export { AuditService } from './services/audit.service';
export { AUDIT_RECORD_EVENT, AuditRecordEvent, type AuditRecordInput } from './events/audit.event';
export { AuditActionsResponseDto, AuditLogResponseDto } from './dto/audit-log-response.dto';
export {
  AUDIT_SORTABLE_COLUMNS,
  AUDIT_TARGET_TYPE_VALUES,
  AuditQueryDto,
} from './dto/audit-query.dto';
