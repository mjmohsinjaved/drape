import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardResponses,
  CurrentUser,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
} from '@library/common';

import { GarmentIdParamDto } from '../dto/garment-id-param.dto';
import { CreateGarmentImageDto, ReorderGarmentImagesDto } from '../dto/garment-image-create.dto';
import {
  GarmentImageResponseDto,
  GarmentImageWithQualityResponseDto,
} from '../dto/garment-image-response.dto';
import { GarmentImagesService } from '../services/garment-images.service';

/**
 * ARCHITECTURE §5.7 — the garment-scoped half of `garment-images`.
 *
 * Every route is `ADMIN`. The consumer catalogue reads images through `modules/catalog`, which
 * projects published, test-render-approved garments only (§5.8, E-10) — nothing here is
 * reachable without an admin session.
 *
 * A-9 asks for "per-file progress". That is a client concern, and it works because this
 * controller finalises **one** image per request: the browser opens as many independent
 * requests as the admin dropped files and draws a bar for each. A batch endpoint would give the
 * console a single opaque result to report, which is what D-16 exists to prevent.
 */
@ApiTags('Garment images')
@Controller('admin/garments')
export class GarmentImagesController {
  constructor(private readonly images: GarmentImagesService) {}

  @Get(':garmentId/images')
  @Roles(Role.ADMIN)
  @ResponseMessage('Images retrieved successfully')
  @ApiOperation({ summary: 'List a garment’s images in gallery order (§5.7)' })
  @ApiOkResponse({ type: [GarmentImageResponseDto] })
  @ApiStandardResponses({ notFound: true })
  async findAll(@Param() params: GarmentIdParamDto): Promise<GarmentImageResponseDto[]> {
    return this.images.findAll(params.garmentId);
  }

  @Post(':garmentId/images')
  @Roles(Role.ADMIN)
  @ResponseMessage('Image added successfully')
  @ApiOperation({
    summary: 'Finalise an uploaded image against a garment (§5.7, A-9)',
    description:
      'The bytes arrive through the §3.5 upload-ticket flow; this records the row. When the ' +
      'image is the try-on source the A-10 validator runs and its verdict is written to the ' +
      'garment, so the response carries the quality report alongside the image.',
  })
  @ApiCreatedResponse({ type: GarmentImageWithQualityResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true, unprocessable: true })
  async create(
    @Param() params: GarmentIdParamDto,
    @Body() dto: CreateGarmentImageDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<GarmentImageWithQualityResponseDto | GarmentImageResponseDto> {
    return this.images.create(params.garmentId, dto, actor);
  }

  @Post(':garmentId/images/reorder')
  @Roles(Role.ADMIN)
  @ResponseMessage('Gallery order saved successfully')
  @ApiOperation({ summary: 'Persist the gallery order (§5.7, A-9)' })
  @ApiOkResponse({ type: [GarmentImageResponseDto] })
  @ApiStandardResponses({ notFound: true })
  async reorder(
    @Param() params: GarmentIdParamDto,
    @Body() dto: ReorderGarmentImagesDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<GarmentImageResponseDto[]> {
    return this.images.reorder(params.garmentId, dto, actor);
  }
}
