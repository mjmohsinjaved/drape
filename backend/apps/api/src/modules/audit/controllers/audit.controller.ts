import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardResponses,
  ResponseMessage,
  Role,
  Roles,
  type IPaginated,
} from '@library/common';

import { AuditActionsResponseDto, AuditLogResponseDto } from '../dto/audit-log-response.dto';
import { AuditQueryDto } from '../dto/audit-query.dto';
import { AuditService } from '../services/audit.service';

/**
 * ARCHITECTURE §5.19 — the A-3 audit log.
 *
 * Admin-only, both routes, with no consumer-reachable projection anywhere in this
 * module: the log records who did what to whose data, so a consumer being able to
 * read it would defeat the point of having it.
 *
 * There is no write route. Rows arrive through {@link AUDIT_RECORD_EVENT} or
 * `AuditService.record()`, never over HTTP.
 */
@ApiTags('Audit')
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ResponseMessage('Audit log retrieved successfully')
  @ApiOperation({ summary: 'Append-only audit log, filterable by actor, action and date (A-3)' })
  @ApiOkResponse({ type: [AuditLogResponseDto] })
  @ApiStandardResponses()
  async list(@Query() query: AuditQueryDto): Promise<IPaginated<AuditLogResponseDto>> {
    return this.audit.query(query);
  }

  @Get('actions')
  @Roles(Role.ADMIN)
  @ResponseMessage('Audit action registry retrieved successfully')
  @ApiOperation({ summary: 'The closed action registry, for the filter dropdown' })
  @ApiOkResponse({ type: AuditActionsResponseDto })
  @ApiStandardResponses()
  listActions(): AuditActionsResponseDto {
    return this.audit.listActions();
  }
}
