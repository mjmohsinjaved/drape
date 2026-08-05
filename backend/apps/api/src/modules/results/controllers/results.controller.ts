import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardResponses,
  CurrentUser,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';

import { ShortlistItemResponseDto } from '@api/modules/shortlist/dto/shortlist-response.dto';

import { MarketingOptInDto } from '../dto/marketing-opt-in.dto';
import { MAX_DOWNLOAD_RESULTS, ResultDownloadDto } from '../dto/result-download.dto';
import { ResultIdParamDto } from '../dto/result-id-param.dto';
import { ResultQueryDto } from '../dto/result-query.dto';
import { ResultGroupDto, ResultResponseDto } from '../dto/result-response.dto';
import { ResultVerdictDto } from '../dto/result-verdict.dto';
import { ResultDownloadService } from '../services/result-download.service';
import { ResultsService } from '../services/results.service';

import type { Response } from 'express';

/**
 * Try-on history — ARCHITECTURE §5.12, PRD C-24 … C-31.
 *
 * **Every handler is `@Roles(Role.CONSUMER)`.** An admin has no route into a
 * consumer's renders here at all: S-10 allows an admin to see a render only where she
 * has attached it to an enquiry, and that projection belongs to `enquiries` through
 * `enquiry_items` (§4.24), not to this controller.
 *
 * Ownership is enforced in the service on every route, and a cross-account request
 * receives the masked `RESULT_NOT_FOUND` (§2.4, S-9).
 */
@ApiTags('Results')
@Controller('results')
export class ResultsController {
  constructor(
    private readonly results: ResultsService,
    private readonly downloads: ResultDownloadService,
  ) {}

  @Get()
  @Roles(Role.CONSUMER)
  @ResponseMessage('History retrieved successfully')
  @ApiOperation({
    summary: 'Try-on history, newest first (C-24, C-25)',
    description:
      'Thumbnails only, paginated per §2.8 — full renders are fetched on open (§9.1). ' +
      'Rendered entirely from the `tryon_results` snapshot columns, so an entry survives ' +
      'the photo being deleted (C-28) and the garment being removed (C-29).',
  })
  @ApiOkResponse({ type: [ResultResponseDto] })
  @ApiStandardResponses()
  list(
    @Query() query: ResultQueryDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<IPaginated<ResultResponseDto>> {
    return this.results.list(user, query);
  }

  /**
   * C-23 / §5.12 — a zip of a selected set, each render watermarked at download time.
   *
   * Declared before the `:resultId` routes so `download` is matched as a literal
   * segment. Returns a `StreamableFile` wrapping the archive stream, which
   * `ResponseTransformInterceptor` passes through untouched — and the archive is
   * produced as it is read, so nothing is held in memory but the render currently
   * being marked.
   *
   * Every id in the body is ownership-checked individually. A foreign id is refused
   * with `RESULT_NOT_FOUND` — the same answer a nonexistent one gets, so the refusal
   * discloses nothing about whether it exists (§9.2).
   */
  @Post('download')
  @Roles(Role.CONSUMER)
  @ApiOperation({
    summary: 'Download a selected set of renders as a watermarked zip (C-23, §5.12)',
    description:
      `At most ${MAX_DOWNLOAD_RESULTS} renders, all of them hers. Each carries the ` +
      'same brand mark the single-render download applies (C-23); the stored files ' +
      'stay clean (§3.6).',
  })
  @ApiOkResponse({
    description: 'The zip archive.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiStandardResponses({ notFound: true })
  async downloadMany(
    @Body() dto: ResultDownloadDto,
    @CurrentUser() user: ICurrentUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const archive = await this.downloads.downloadMany(user, dto.resultIds);

    // No Content-Length: the archive's size is not known until it has been written,
    // and a wrong one is worse than none — the response is chunked instead.
    response.setHeader('Content-Type', archive.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${archive.filename}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    return new StreamableFile(archive.stream);
  }

  /** Declared before `:resultId` so `groups` is matched as a literal segment. */
  @Get('groups/by-photo')
  @Roles(Role.CONSUMER)
  @ResponseMessage('History retrieved successfully')
  @ApiOperation({ summary: 'History grouped by the photo it was generated from (C-30)' })
  @ApiOkResponse({ type: [ResultGroupDto] })
  @ApiStandardResponses()
  groups(
    @Query() query: ResultQueryDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<ResultGroupDto[]> {
    return this.results.groupsByPhoto(user, query);
  }

  @Get(':resultId')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Result retrieved successfully')
  @ApiOperation({
    summary: 'One render in full (C-26)',
    description: 'Costs nothing — re-opening a past result never triggers a generation.',
  })
  @ApiOkResponse({ type: ResultResponseDto })
  @ApiStandardResponses({ notFound: true })
  findOne(
    @Param() params: ResultIdParamDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<ResultResponseDto> {
    return this.results.findOne(user, params.resultId);
  }

  /**
   * C-23. Returns a `StreamableFile`, which `ResponseTransformInterceptor` passes
   * through untouched — the bytes never end up inside a JSON envelope.
   */
  @Get(':resultId/download')
  @Roles(Role.CONSUMER)
  @ApiOperation({ summary: 'Download the render with the brand watermark (C-23)' })
  @ApiOkResponse({
    description: 'The watermarked PNG.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiStandardResponses({ notFound: true })
  async download(
    @Param() params: ResultIdParamDto,
    @CurrentUser() user: ICurrentUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.downloads.download(user, params.resultId);

    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', file.bytes.byteLength);
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    return new StreamableFile(file.bytes);
  }

  @Post(':resultId/verdict')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Verdict saved')
  @ApiOperation({
    summary: 'Record Love it / Maybe / Not for me on the piece in this render (C-20, C-21)',
    description:
      'The verdict she reaches from the render she is looking at. It writes the same single ' +
      '`(userId, garmentId)` row as `POST /shortlist` (§4.20) — this route exists so the ' +
      'result view does not have to know the garment id, not so there can be a second ' +
      'verdict. The piece is read from the render, so a client cannot record a verdict ' +
      'against a piece she never saw. Refused with `GARMENT_NOT_FOUND` once the garment is ' +
      'gone (C-29): the render survives, the decision has nowhere to live.',
  })
  @ApiOkResponse({ type: ShortlistItemResponseDto })
  @ApiStandardResponses({ notFound: true })
  verdict(
    @Param() params: ResultIdParamDto,
    @Body() dto: ResultVerdictDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<ShortlistItemResponseDto> {
    return this.results.recordVerdict(user, params.resultId, dto);
  }

  @Post(':resultId/marketing-opt-in')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Preference saved')
  @ApiOperation({
    summary: 'Explicit, per-render opt-in for brand marketing use (§9.3)',
    description: 'Never defaulted on, and revocable by posting `{ "optIn": false }`.',
  })
  @ApiOkResponse({ type: ResultResponseDto })
  @ApiStandardResponses({ notFound: true })
  marketingOptIn(
    @Param() params: ResultIdParamDto,
    @Body() dto: MarketingOptInDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<ResultResponseDto> {
    return this.results.setMarketingOptIn(user, params.resultId, dto.optIn);
  }

  @Delete(':resultId')
  @Roles(Role.CONSUMER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Permanently delete one render and its file (C-31)',
    description:
      'The row is soft-deleted so its id can never be reused; the image and its ' +
      'thumbnail are hard-deleted immediately. The confirmation copy says the deletion ' +
      'is permanent, and it is.',
  })
  @ApiNoContentResponse()
  @ApiStandardResponses({ notFound: true })
  remove(@Param() params: ResultIdParamDto, @CurrentUser() user: ICurrentUser): Promise<void> {
    return this.results.remove(user, params.resultId);
  }
}
