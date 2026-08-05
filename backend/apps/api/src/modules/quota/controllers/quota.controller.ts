import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardResponses,
  CurrentUser,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
} from '@library/common';

import { QuotaSnapshotResponseDto } from '../dto/quota-response.dto';
import { QuotaService } from '../services/quota.service';

/**
 * A consumer's own generation counter — PRD C-5, ARCHITECTURE §5.16.
 *
 * One route, `@Roles(Role.CONSUMER)`, scoped to the caller's own id. There is no
 * `GET /quota/:userId`: an id in the path would be an authorisation decision made from
 * a URL segment, and §9.2 says ownership is never inferred that way. The admin view of
 * somebody else's ledger is a separate, `@Roles(Role.ADMIN)` controller.
 */
@ApiTags('Quota')
@Controller('quota')
export class QuotaController {
  constructor(private readonly quota: QuotaService) {}

  @Get('me')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Quota retrieved successfully')
  @ApiOperation({
    summary: 'Her persistent generation counter for this period (C-5)',
    description:
      'Every number is derived by summing `quota_ledger` (§4.26) — there is no ' +
      'stored balance. The first read in a new period materialises the lazy ' +
      '`MONTHLY_GRANT` of `monthlyQuotaOverride ?? quota.defaultMonthly` (A-18, A-28).',
  })
  @ApiOkResponse({ type: QuotaSnapshotResponseDto })
  @ApiStandardResponses()
  me(@CurrentUser() actor: ICurrentUser): Promise<QuotaSnapshotResponseDto> {
    return this.quota.getSnapshotDto(actor.id);
  }
}
