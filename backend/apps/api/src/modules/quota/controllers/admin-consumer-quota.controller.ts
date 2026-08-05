import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardResponses,
  CurrentUser,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';

import { AdjustLedgerDto } from '../dto/adjust-ledger.dto';
import { ConsumerIdParamDto } from '../dto/consumer-id-param.dto';
import { LedgerQueryDto } from '../dto/ledger-query.dto';
import { QuotaLedgerEntryResponseDto, QuotaSnapshotResponseDto } from '../dto/quota-response.dto';
import { QuotaService } from '../services/quota.service';

/**
 * A consumer's quota ledger, as an admin sees it — PRD A-18, ARCHITECTURE §5.16.
 *
 * **Every handler is `@Roles(Role.ADMIN)`.** What an admin can reach through this
 * controller is a list of integers with reasons and timestamps: how much allowance a
 * consumer was granted, how much she spent, and who changed it. Nothing here joins to
 * `person_photos` or `tryon_results`, and `quota_ledger` holds no key into either
 * (§4.26) — S-10 is preserved by the shape of the table, not by remembering not to
 * select a column.
 *
 * Setting `consumer_profiles.monthlyQuotaOverride` itself lives on
 * `PATCH /admin/consumers/:userId/quota` in `modules/users`, which owns that table.
 * This module hears about the change through `user.quota_override_changed` and appends
 * the matching grant — see `QuotaOverrideListener`.
 */
@ApiTags('Quota')
@Controller('admin/consumers')
export class AdminConsumerQuotaController {
  constructor(private readonly quota: QuotaService) {}

  @Get(':userId/quota-ledger')
  @Roles(Role.ADMIN)
  @ResponseMessage('Quota ledger retrieved successfully')
  @ApiOperation({
    summary: "That consumer's quota ledger (§5.16)",
    description:
      'Append-only (§4.26). Every row is a grant or a consumption; the remaining ' +
      'balance is their sum, not a column.',
  })
  @ApiOkResponse({ type: [QuotaLedgerEntryResponseDto] })
  @ApiStandardResponses({ notFound: true })
  ledger(
    @Param() params: ConsumerIdParamDto,
    @Query() query: LedgerQueryDto,
  ): Promise<IPaginated<QuotaLedgerEntryResponseDto>> {
    return this.quota.listLedger(params.userId, query);
  }

  @Post(':userId/quota-adjust')
  @Roles(Role.ADMIN)
  @ResponseMessage('Quota adjusted successfully')
  @ApiOperation({
    summary: 'Append a quota adjustment for this consumer (A-18)',
    description:
      'Takes a **delta**, never a new total. Applies immediately — the balance is ' +
      'derived, so the next `GET /quota/me` reflects it without any cache to ' +
      'invalidate. A delta that would take her below zero is refused.',
  })
  @ApiOkResponse({ type: QuotaSnapshotResponseDto })
  @ApiStandardResponses({ notFound: true })
  adjust(
    @Param() params: ConsumerIdParamDto,
    @Body() dto: AdjustLedgerDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<QuotaSnapshotResponseDto> {
    return this.quota.adjust(actor, params.userId, dto);
  }
}
