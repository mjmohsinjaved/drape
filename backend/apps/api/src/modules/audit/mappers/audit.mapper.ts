import { AuditLogResponseDto } from '../dto/audit-log-response.dto';

import type { AuditLogEntry } from '../entities/audit-log-entry.entity';

/**
 * `audit_log` row → response DTO. The only place that shape is decided (§2.9).
 *
 * `ip` and `userAgent` are deliberately dropped: they are recorded for forensics,
 * not for the list screen (E-12). `actor` — the joined `users` row — is dropped
 * too, so a relation loaded for a name can never leak an email address.
 */
export function toAuditLogResponse(entry: AuditLogEntry): AuditLogResponseDto {
  const dto = new AuditLogResponseDto();
  dto.id = entry.id;
  dto.actorId = entry.actorId;
  dto.actorRole = entry.actorRole;
  dto.action = entry.action;
  dto.targetType = entry.targetType;
  dto.targetId = entry.targetId;
  dto.targetLabel = entry.targetLabel;
  dto.metadata = entry.metadata ?? {};
  dto.requestId = entry.requestId;
  dto.createdAt = entry.createdAt;
  return dto;
}
