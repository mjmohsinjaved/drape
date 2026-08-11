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

import { CreatePersonPhotoDto } from '../dto/create-person-photo.dto';
import { PersonPhotoIdParamDto } from '../dto/person-photo-id-param.dto';
import { PersonPhotoResponseDto } from '../dto/person-photo-response.dto';
import { UpdatePersonPhotoDto } from '../dto/update-person-photo.dto';
import { PersonPhotosService } from '../services/person-photos.service';

@ApiTags('Person photos')
@Controller('person-photos')
export class PersonPhotosController {
  constructor(private readonly photos: PersonPhotosService) {}

  @Get()
  @Roles(Role.CONSUMER)
  @ResponseMessage('Photos retrieved successfully')
  @ApiOperation({
    summary: 'Her saved photos with signed, owner-scoped URLs (C-16)',
    description:
      'Active photo first, then newest. Every `url` is an HMAC token scoped to her ' +
      'account with a 300-second TTL (§3.4); no storage key crosses the boundary.',
  })
  @ApiOkResponse({ type: [PersonPhotoResponseDto] })
  @ApiStandardResponses()
  list(@CurrentUser() actor: ICurrentUser): Promise<PersonPhotoResponseDto[]> {
    return this.photos.list(actor.id);
  }

  @Post()
  @Roles(Role.CONSUMER)
  @ResponseMessage('Photo saved successfully')
  @ApiOperation({
    summary: 'Finalise a redeemed upload ticket: probe, validate, thumbnail, hash (§5.9)',
    description:
      'Requires current consent (C-11, C-12) — CONSENT_REQUIRED or CONSENT_STALE ' +
      'otherwise. Dimensions, format, byte size and sha256 are re-derived from the ' +
      'stored bytes; the client-side C-14 pass is not the enforcement point. ' +
      'PHOTO_VALIDATION_FAILED carries every failed check in `details.checks[]`.',
  })
  @ApiOkResponse({ type: PersonPhotoResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true, unprocessable: true })
  create(
    @CurrentUser() actor: ICurrentUser,
    @Body() dto: CreatePersonPhotoDto,
  ): Promise<PersonPhotoResponseDto> {
    return this.photos.create(actor, dto);
  }

  @Post(':photoId/activate')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Photo activated successfully')
  @ApiOperation({
    summary: 'Make this the active photo (C-16)',
    description:
      'Exactly one photo is active per account. The demote/promote pair runs in one ' +
      'transaction behind the `UQ_person_photos_active` partial unique index, so ' +
      'two devices racing cannot leave two active photos or none.',
  })
  @ApiOkResponse({ type: PersonPhotoResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  activate(
    @CurrentUser() actor: ICurrentUser,
    @Param() params: PersonPhotoIdParamDto,
  ): Promise<PersonPhotoResponseDto> {
    return this.photos.activate(actor.id, params.photoId);
  }

  @Patch(':photoId')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Photo updated successfully')
  @ApiOperation({ summary: 'Rename the label (§5.9)' })
  @ApiOkResponse({ type: PersonPhotoResponseDto })
  @ApiStandardResponses({ notFound: true })
  rename(
    @CurrentUser() actor: ICurrentUser,
    @Param() params: PersonPhotoIdParamDto,
    @Body() dto: UpdatePersonPhotoDto,
  ): Promise<PersonPhotoResponseDto> {
    return this.photos.rename(actor.id, params.photoId, dto);
  }

  @Delete(':photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.CONSUMER)
  @ResponseMessage('Photo deleted successfully')
  @ApiOperation({
    summary: 'Delete the photo and its files, and retire its cache entries (C-16, C-28, C-38)',
    description:
      'Immediate from her view and complete in the backend before the response is ' +
      'written, with a `deletion_log` row recording the keys removed and a ' +
      'verification hash (§9.3). **Renders already produced stay in her history** — ' +
      '`tryon_results.personPhotoId` is `ON DELETE SET NULL` and nothing here touches ' +
      'that table (C-28).',
  })
  @ApiNoContentResponse()
  @ApiStandardResponses({ notFound: true })
  remove(
    @CurrentUser() actor: ICurrentUser,
    @Param() params: PersonPhotoIdParamDto,
  ): Promise<void> {
    return this.photos.remove(actor, params.photoId);
  }
}
