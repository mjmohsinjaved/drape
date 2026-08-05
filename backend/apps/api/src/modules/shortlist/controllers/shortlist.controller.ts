import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardResponses,
  CurrentUser,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
} from '@library/common';

import { RecordVerdictDto } from '../dto/record-verdict.dto';
import { ReorderShortlistDto } from '../dto/reorder-shortlist.dto';
import { ShortlistItemParamDto } from '../dto/shortlist-item-param.dto';
import { ShortlistItemResponseDto, ShortlistResponseDto } from '../dto/shortlist-response.dto';
import { UpdateShortlistItemDto } from '../dto/update-shortlist-item.dto';
import { ShortlistService } from '../services/shortlist.service';

/**
 * The shortlist — ARCHITECTURE §5.13, PRD C-20, C-21, C-32.
 *
 * **Every handler is `@Roles(Role.CONSUMER)`.** There is no admin route into a
 * consumer's shortlist in this file and there is not meant to be: an admin sees her
 * pieces only where she has sent an enquiry, and that projection belongs to
 * `enquiries` through `enquiry_items` (§4.24, S-10).
 *
 * Ownership is enforced in the service on every route, and a cross-account request
 * receives the masked `SHORTLIST_ITEM_NOT_FOUND` (§2.4, S-9, E-7).
 */
@ApiTags('Shortlist')
@Controller('shortlist')
export class ShortlistController {
  constructor(private readonly shortlist: ShortlistService) {}

  @Get()
  @Roles(Role.CONSUMER)
  @ResponseMessage('Shortlist retrieved successfully')
  @ApiOperation({
    summary: 'Love it and Maybe, in rank order, with the running total (C-32)',
    description:
      '"Not for me" pieces are never here: they are kept only for the A-38 rejection ' +
      'rollup, and they never count toward the budget total (§4.20).',
  })
  @ApiOkResponse({ type: ShortlistResponseDto })
  @ApiStandardResponses()
  list(@CurrentUser() user: ICurrentUser): Promise<ShortlistResponseDto> {
    return this.shortlist.list(user);
  }

  @Post()
  @Roles(Role.CONSUMER)
  @ResponseMessage('Verdict saved')
  @ApiOperation({
    summary: 'Record Love it / Maybe / Not for me on a piece (C-20, C-21)',
    description:
      'Upserts the single `(userId, garmentId)` row (§4.20) — posting twice for the ' +
      'same piece moves it rather than duplicating it, and keeps the rank it already had.',
  })
  @ApiOkResponse({ type: ShortlistItemResponseDto })
  @ApiStandardResponses({ notFound: true })
  record(
    @Body() dto: RecordVerdictDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<ShortlistItemResponseDto> {
    return this.shortlist.recordVerdict(user, dto);
  }

  /** Declared before `:itemId` so `reorder` is matched as a literal segment. */
  @Post('reorder')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Shortlist reordered')
  @ApiOperation({
    summary: 'Persist a drag-to-rank order (C-32)',
    description:
      'Send the complete shortlist in the intended order. Ranks are renumbered 1…n ' +
      'inside one transaction, so a partial payload is refused rather than merged.',
  })
  @ApiOkResponse({ type: ShortlistResponseDto })
  @ApiStandardResponses()
  reorder(
    @Body() dto: ReorderShortlistDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<ShortlistResponseDto> {
    return this.shortlist.reorder(user, dto);
  }

  @Patch(':itemId')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Shortlist item updated')
  @ApiOperation({ summary: 'Update the note or the verdict (§5.13)' })
  @ApiOkResponse({ type: ShortlistItemResponseDto })
  @ApiStandardResponses({ notFound: true })
  update(
    @Param() params: ShortlistItemParamDto,
    @Body() dto: UpdateShortlistItemDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<ShortlistItemResponseDto> {
    return this.shortlist.update(user, params.itemId, dto);
  }

  @Delete(':itemId')
  @Roles(Role.CONSUMER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a piece from the shortlist (§5.13)',
    description:
      'Removing is not rejecting: no reason is recorded and nothing reaches the A-38 ' +
      'rollup. The remaining pieces are renumbered in the same transaction.',
  })
  @ApiNoContentResponse()
  @ApiStandardResponses({ notFound: true })
  remove(@Param() params: ShortlistItemParamDto, @CurrentUser() user: ICurrentUser): Promise<void> {
    return this.shortlist.remove(user, params.itemId);
  }
}
