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
  Query,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  ApiStandardResponses,
  CurrentUser,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';

import { CreateGarmentDto } from '../dto/create-garment.dto';
import { DeleteGarmentDto } from '../dto/delete-garment.dto';
import { GarmentBulkDto } from '../dto/garment-bulk.dto';
import { GarmentIdParamDto } from '../dto/garment-id-param.dto';
import { GarmentQualityOverrideDto } from '../dto/garment-quality-override.dto';
import { GarmentQueryDto } from '../dto/garment-query.dto';
import { GarmentBulkResultDto, GarmentResponseDto } from '../dto/garment-response.dto';
import { UpdateGarmentDto } from '../dto/update-garment.dto';
import { GarmentsService } from '../services/garments.service';

/**
 * Garment records — ARCHITECTURE §5.6, PRD A-8 … A-14.
 *
 * **Every handler is `@Roles(Role.ADMIN)`**, and the spec beside this file asserts a
 * consumer session and an anonymous caller are both refused on each one (S-11, E-7).
 * Nothing here is reachable signed out: the public surface is `modules/catalog`, and
 * it returns a different DTO from a query that cannot see a draft.
 *
 * Image upload, the try-on source designation and the A-10 validator are **not** on
 * this controller — §5.7 gives them their own routes, and they own the write path to
 * `garment_images` and the quality columns this module only reads.
 */
@ApiTags('Garments')
@Controller('admin/garments')
export class GarmentsController {
  constructor(private readonly garments: GarmentsService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ResponseMessage('Garments retrieved successfully')
  @ApiOperation({
    summary:
      'Catalog list with search, category filter, publish-state filter, and sort by ' +
      'newest / most tried / highest star rate (A-14)',
    description:
      '`sortBy=createdAt` is newest, `sortBy=tryOnCount` is most tried, ' +
      '`sortBy=starRate` is highest star rate. Paginated per §2.8.',
  })
  @ApiOkResponse({ type: [GarmentResponseDto] })
  @ApiStandardResponses()
  list(@Query() query: GarmentQueryDto): Promise<IPaginated<GarmentResponseDto>> {
    return this.garments.list(query);
  }

  /**
   * Declared before `:garmentId` so `bulk` is matched as a literal segment rather
   * than swallowed as an id.
   */
  @Post('bulk')
  @Roles(Role.ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ResponseMessage('Bulk action applied')
  @ApiOperation({
    summary:
      'Bulk publish / unpublish / archive / re-categorise with per-item results (A-12, D-16)',
    description:
      'Each item runs through the same service method the single-garment route uses, ' +
      'so a bulk publish is subject to the A-11 and A-10 gates item by item.',
  })
  @ApiOkResponse({ type: GarmentBulkResultDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  bulk(
    @Body() dto: GarmentBulkDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<GarmentBulkResultDto> {
    return this.garments.bulk(dto, actor);
  }

  @Get(':garmentId')
  @Roles(Role.ADMIN)
  @ResponseMessage('Garment retrieved successfully')
  @ApiOperation({ summary: 'Full garment record including the quality report (§5.6)' })
  @ApiOkResponse({ type: GarmentResponseDto })
  @ApiStandardResponses({ notFound: true })
  findOne(@Param() params: GarmentIdParamDto): Promise<GarmentResponseDto> {
    return this.garments.findOne(params.garmentId);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ResponseMessage('Garment created successfully')
  @ApiOperation({
    summary:
      'Create a garment: title, SKU, category, colors, fabric, embellishment weight, ' +
      'price, rental or sale, deposit if rental, description, sizes (A-8)',
  })
  @ApiOkResponse({ type: GarmentResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  create(
    @Body() dto: CreateGarmentDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<GarmentResponseDto> {
    return this.garments.create(dto, actor);
  }

  @Patch(':garmentId')
  @Roles(Role.ADMIN)
  @ResponseMessage('Garment updated successfully')
  @ApiOperation({ summary: 'Update garment fields (A-8)' })
  @ApiOkResponse({ type: GarmentResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  update(
    @Param() params: GarmentIdParamDto,
    @Body() dto: UpdateGarmentDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<GarmentResponseDto> {
    return this.garments.update(params.garmentId, dto, actor);
  }

  @Delete(':garmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN)
  @ResponseMessage('Garment deleted successfully')
  @ApiOperation({
    summary: 'Delete. Requires typing the title (D-17)',
    description:
      'A soft delete: the row survives so analytics history and the foreign keys ' +
      'pointing at it do too (A-13). SKU and slug become reusable immediately.',
  })
  @ApiNoContentResponse()
  @ApiStandardResponses({ notFound: true, conflict: true })
  remove(
    @Param() params: GarmentIdParamDto,
    @Body() dto: DeleteGarmentDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<void> {
    return this.garments.remove(params.garmentId, dto, actor);
  }

  @Post(':garmentId/publish')
  @Roles(Role.ADMIN)
  @ResponseMessage('Garment published successfully')
  @ApiOperation({
    summary: 'Publish. The A-10 and A-11 conditions are reported, never enforced',
    description:
      'Always publishes on a legal transition. Any unmet condition — no approved test ' +
      'render (A-11), no try-on source image (A-9), a score below `quality.minScore` ' +
      'with no override (A-10) — is logged and recorded on the GARMENT_PUBLISHED audit ' +
      'row as `metadata.unmetConditions`. The only refusal left is ' +
      'INVALID_PUBLISH_TRANSITION.',
  })
  @ApiOkResponse({ type: GarmentResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true, unprocessable: true })
  publish(
    @Param() params: GarmentIdParamDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<GarmentResponseDto> {
    return this.garments.publish(params.garmentId, actor);
  }

  @Post(':garmentId/unpublish')
  @Roles(Role.ADMIN)
  @ResponseMessage('Garment unpublished successfully')
  @ApiOperation({ summary: 'Back to draft (A-13)' })
  @ApiOkResponse({ type: GarmentResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  unpublish(
    @Param() params: GarmentIdParamDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<GarmentResponseDto> {
    return this.garments.unpublish(params.garmentId, actor);
  }

  @Post(':garmentId/archive')
  @Roles(Role.ADMIN)
  @ResponseMessage('Garment archived successfully')
  @ApiOperation({ summary: 'Archive; analytics history retained (A-13)' })
  @ApiOkResponse({ type: GarmentResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  archive(
    @Param() params: GarmentIdParamDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<GarmentResponseDto> {
    return this.garments.archive(params.garmentId, actor);
  }

  @Post(':garmentId/quality-override')
  @Roles(Role.ADMIN)
  @ResponseMessage('Quality override recorded')
  @ApiOperation({
    summary: 'Override a low quality score with a required reason; audit-logged (A-10)',
    description:
      'Records the waiver only. Publishing is still a separate call, and the A-11 ' +
      'test-render gate is unaffected.',
  })
  @ApiOkResponse({ type: GarmentResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  overrideQuality(
    @Param() params: GarmentIdParamDto,
    @Body() dto: GarmentQualityOverrideDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<GarmentResponseDto> {
    return this.garments.recordQualityOverride(params.garmentId, dto, actor);
  }
}
