import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardResponses,
  CurrentUser,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
} from '@library/common';

import { UpdateGarmentImageDto } from '../dto/garment-image-create.dto';
import { GarmentImageIdParamDto } from '../dto/garment-image-params.dto';
import {
  GarmentImageResponseDto,
  GarmentImageWithQualityResponseDto,
} from '../dto/garment-image-response.dto';
import { ImageQualityReportDto } from '../dto/image-quality-response.dto';
import { GarmentImagesService } from '../services/garment-images.service';

/**
 * ARCHITECTURE §5.7 — the image-scoped half of `garment-images`.
 *
 * Split from `GarmentImagesController` because the paths are: `/admin/garment-images/:imageId`
 * addresses one image directly, without naming its garment. The image id is a v4 uuid and
 * therefore unguessable, which §3.3 is explicit is **not** an authorisation check — every
 * handler here loads the row and its garment before it does anything.
 */
@ApiTags('Garment images')
@Controller('admin/garment-images')
export class GarmentImageController {
  constructor(private readonly images: GarmentImagesService) {}

  @Patch(':imageId')
  @Roles(Role.ADMIN)
  @ResponseMessage('Image updated successfully')
  @ApiOperation({ summary: 'Update alt text or gallery position (§5.7, D-20)' })
  @ApiOkResponse({ type: GarmentImageResponseDto })
  @ApiStandardResponses({ notFound: true })
  async update(
    @Param() params: GarmentImageIdParamDto,
    @Body() dto: UpdateGarmentImageDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<GarmentImageResponseDto> {
    return this.images.update(params.imageId, dto, actor);
  }

  @Post(':imageId/tryon-source')
  @Roles(Role.ADMIN)
  @ResponseMessage('Try-on source updated successfully')
  @ApiOperation({
    summary: 'Designate this image the try-on source (§5.7, A-9)',
    description:
      'Clears the previous source and resets `testRenderState` to NONE in one transaction, ' +
      'then re-runs the A-10 validator and writes the verdict to the garment.',
  })
  @ApiOkResponse({ type: GarmentImageWithQualityResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true, unprocessable: true })
  async setTryOnSource(
    @Param() params: GarmentImageIdParamDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<GarmentImageWithQualityResponseDto> {
    return this.images.setTryOnSource(params.imageId, actor);
  }

  @Post(':imageId/revalidate')
  @Roles(Role.ADMIN)
  @ResponseMessage('Image revalidated successfully')
  @ApiOperation({ summary: 'Re-run the A-10 quality validator (§5.7)' })
  @ApiOkResponse({ type: ImageQualityReportDto })
  @ApiStandardResponses({ notFound: true, unprocessable: true })
  async revalidate(
    @Param() params: GarmentImageIdParamDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<ImageQualityReportDto> {
    return this.images.revalidate(params.imageId, actor);
  }

  @Delete(':imageId')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an image and its file (§5.7)',
    description:
      'Refused when the image is the try-on source of a **published** garment: unpublishing as ' +
      'a side effect of an image edit would take a live piece off the catalogue without anybody ' +
      'asking for it (D-17). Unpublish the piece, or set another source, then delete.',
  })
  @ApiNoContentResponse({ description: 'The image and its stored objects are gone.' })
  @ApiStandardResponses({ notFound: true, conflict: true })
  async remove(
    @Param() params: GarmentImageIdParamDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<void> {
    await this.images.remove(params.imageId, actor);
  }
}
