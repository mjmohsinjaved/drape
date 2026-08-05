import { Body, Controller, Get, Post, Query } from '@nestjs/common';
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
import { LedgerQueryDto } from '../dto/ledger-query.dto';
import {
  AdminUsageResponseDto,
  BudgetSnapshotResponseDto,
  UsageLedgerEntryResponseDto,
} from '../dto/usage-response.dto';
import { BudgetService } from '../services/budget.service';

/**
 * The A-33 usage dashboard and the A-29 budget ledger — ARCHITECTURE §5.16.
 *
 * **Every handler is `@Roles(Role.ADMIN)`.** These routes read platform-wide spend and
 * write the ledger an admin reconciles against; none of them can see a consumer's
 * photo or render, and `usage_ledger` holds no such reference — only a `userId`, so
 * A-33 can split consumer demand from admin test renders.
 */
@ApiTags('Usage and budget')
@Controller('admin/usage')
export class AdminUsageController {
  constructor(private readonly budget: BudgetService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ResponseMessage('Usage retrieved successfully')
  @ApiOperation({
    summary:
      'Generations this month, remaining budget, 7-day trailing rate, projected ' +
      'exhaustion, and the consumer-vs-test-render split (A-33)',
    description:
      'Derived by summing `usage_ledger` (§4.27). Cache hits write no ledger row in ' +
      'either table (C-22), so the cache-hit ratio is reported beside these numbers ' +
      'by `TryOnModule`, which owns `tryon_cache` (§4.33).',
  })
  @ApiOkResponse({ type: AdminUsageResponseDto })
  @ApiStandardResponses()
  overview(): Promise<AdminUsageResponseDto> {
    return this.budget.overview();
  }

  @Get('ledger')
  @Roles(Role.ADMIN)
  @ResponseMessage('Ledger retrieved successfully')
  @ApiOperation({
    summary: 'Paginated `usage_ledger` for reconciliation (§5.16)',
    description:
      'Append-only: rows are inserted and read, never edited (§2.1). A correction is ' +
      'a further row, appended through `POST /admin/usage/adjust`.',
  })
  @ApiOkResponse({ type: [UsageLedgerEntryResponseDto] })
  @ApiStandardResponses()
  ledger(@Query() query: LedgerQueryDto): Promise<IPaginated<UsageLedgerEntryResponseDto>> {
    return this.budget.listLedger(query);
  }

  @Post('adjust')
  @Roles(Role.ADMIN)
  @ResponseMessage('Budget adjusted successfully')
  @ApiOperation({
    summary: 'Append an `ADMIN_ADJUSTMENT` row to the budget ledger, with a note (§5.16)',
    description:
      'Takes a **delta**, never a new total — the ledger is append-only and a ' +
      'correction is a compensating row. An adjustment that would drive the derived ' +
      'remaining budget below zero is refused with `QUOTA_ADJUSTMENT_INVALID`.',
  })
  @ApiOkResponse({ type: BudgetSnapshotResponseDto })
  @ApiStandardResponses()
  adjust(
    @Body() dto: AdjustLedgerDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<BudgetSnapshotResponseDto> {
    return this.budget.adjust(actor, dto);
  }
}
