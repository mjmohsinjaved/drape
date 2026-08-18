import { Body, Controller, Get, Param, Post, Put, Sse, type MessageEvent } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  ApiStandardResponses,
  CurrentUser,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
} from '@library/common';

import { GarmentIdParamDto } from '@api/modules/garments';

import {
  ReferenceModelResponseDto,
  TestRenderBatchResponseDto,
  TestRenderEstimateResponseDto,
  TestRenderResponseDto,
} from '../dto/test-render-response.dto';
import {
  BulkTestRenderDto,
  RejectTestRenderDto,
  RunTestRenderDto,
  TestRenderEstimateDto,
} from '../dto/test-render.dto';
import { BatchIdParamDto } from '../dto/tryon-params.dto';
import { SelectTryOnProviderDto, TryOnProviderStateDto } from '../dto/tryon-provider.dto';
import { ReferenceModelsService } from '../services/reference-models.service';
import { TestRenderService } from '../services/test-render.service';
import { TryOnProviderAdminService } from '../services/tryon-provider-admin.service';

import type { Observable } from 'rxjs';

@ApiTags('Try-on (admin)')
@Controller()
export class AdminTryOnController {
  constructor(
    private readonly testRenders: TestRenderService,
    private readonly referenceModels: ReferenceModelsService,
    private readonly providers: TryOnProviderAdminService,
  ) {}

  @Get('admin/tryon/providers')
  @Roles(Role.ADMIN)
  @ResponseMessage('Try-on providers retrieved successfully')
  @ApiOperation({
    summary: 'The try-on upstreams and which one is live (A-33)',
    description:
      'Every driver, whether this deployment holds its credentials, and which one is ' +
      'serving generations right now. An unconfigured driver is still listed — the screen ' +
      'shows it disabled with the reason, which is more useful than hiding it.',
  })
  @ApiOkResponse({ type: TryOnProviderStateDto })
  @ApiStandardResponses()
  listProviders(): Promise<TryOnProviderStateDto> {
    return this.providers.list();
  }

  @Put('admin/tryon/provider')
  @Roles(Role.ADMIN)
  @ResponseMessage('Try-on provider updated successfully')
  @ApiOperation({
    summary: 'Switch the live try-on upstream (A-33)',
    description:
      'Takes effect on the **next generation** — no restart and no deploy. Anything ' +
      'already in flight finishes on the driver it started on, because a job that has ' +
      'already been billed upstream cannot be moved to another vendor halfway through. ' +
      'A driver with no credentials on this deployment is refused rather than accepted ' +
      'and left to fail per-generation. Audited as `TRYON_DRIVER_CHANGED` (A-3).',
  })
  @ApiOkResponse({ type: TryOnProviderStateDto })
  @ApiStandardResponses({ unprocessable: true })
  selectProvider(
    @Body() dto: SelectTryOnProviderDto,
    @CurrentUser() admin: ICurrentUser,
  ): Promise<TryOnProviderStateDto> {
    return this.providers.select(dto, admin);
  }

  @Get('admin/reference-models')
  @Roles(Role.ADMIN)
  @ResponseMessage('Reference models retrieved successfully')
  @ApiOperation({
    summary: 'Reference model photos available for a test render (A-11, §4.15)',
    description:
      'These are the only person images an admin ever sends upstream. A consumer photo ' +
      'is never used for a test render (S-10).',
  })
  @ApiOkResponse({ type: [ReferenceModelResponseDto] })
  @ApiStandardResponses()
  listReferenceModels(): Promise<ReferenceModelResponseDto[]> {
    return this.referenceModels.list();
  }

  @Post('admin/tryon/test-render')
  @Roles(Role.ADMIN)
  @ResponseMessage('Test render complete')
  @ApiOperation({
    summary: 'Run one test render against a reference model (A-11)',
    description:
      'Spends platform budget under `TEST_RENDER` and **no** consumer quota (§8.4). ' +
      'Leaves the garment at `testRenderState = PENDING` — an admin still has to approve it.',
  })
  @ApiOkResponse({ type: TestRenderResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  run(
    @Body() dto: RunTestRenderDto,
    @CurrentUser() admin: ICurrentUser,
  ): Promise<TestRenderResponseDto> {
    return this.testRenders.run(dto, admin);
  }

  @Post('admin/tryon/test-render/bulk')
  @Roles(Role.ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ResponseMessage('Batch queued')
  @ApiOperation({
    summary: 'Queue a batch of test renders (A-12, §8.2)',
    description:
      'Returns a `batchId` immediately. Items are processed at **concurrency one**, so ' +
      'catalogue work never competes with a live consumer generation.',
  })
  @ApiOkResponse({ schema: { type: 'object', properties: { batchId: { type: 'string' } } } })
  @ApiStandardResponses({ notFound: true })
  queueBulk(
    @Body() dto: BulkTestRenderDto,
    @CurrentUser() admin: ICurrentUser,
  ): Promise<{ batchId: string }> {
    return this.testRenders.queueBulk(dto, admin);
  }

  @Post('admin/tryon/test-render/bulk/estimate')
  @Roles(Role.ADMIN)
  @ResponseMessage('Estimate calculated')
  @ApiOperation({
    summary: 'Cost estimate for a bulk selection, shown before confirming (A-12)',
    description:
      'Excludes garments that already carry an approved render, and compares the total ' +
      'against the remaining monthly budget (A-29).',
  })
  @ApiOkResponse({ type: TestRenderEstimateResponseDto })
  @ApiStandardResponses()
  estimate(@Body() dto: TestRenderEstimateDto): Promise<TestRenderEstimateResponseDto> {
    return this.testRenders.estimate(dto);
  }

  @Get('admin/tryon/batches/:batchId')
  @Roles(Role.ADMIN)
  @ResponseMessage('Batch retrieved successfully')
  @ApiOperation({
    summary: 'Per-item progress and a success/failure summary (D-16)',
    description:
      'The documented **fallback** for the SSE stream below, and PRD §8.2 expects both ' +
      'to exist. It reads the rows, so it is correct however long ago the batch ran and ' +
      'whatever happened to the stream in between.',
  })
  @ApiOkResponse({ type: TestRenderBatchResponseDto })
  @ApiStandardResponses({ notFound: true })
  batch(@Param() params: BatchIdParamDto): Promise<TestRenderBatchResponseDto> {
    return this.testRenders.batch(params.batchId);
  }

  @Sse('admin/tryon/batches/:batchId/stream')
  @Roles(Role.ADMIN)
  @ApiProduces('text/event-stream')
  @ApiOperation({
    summary: 'Live batch progress (§5.11, A-12, D-16)',
    description:
      'Events: `progress` (the batch summary plus the item that changed), `completed`, ' +
      'and a `heartbeat` every 15 s. A snapshot arrives the moment the stream opens, so ' +
      'a console that connects to a batch already under way draws the real state rather ' +
      'than an empty table (D-5). The stream closes after `completed`; ' +
      '`GET /admin/tryon/batches/:batchId` is correct forever after (§8.2).',
  })
  @ApiStandardResponses({ notFound: true })
  streamBatch(@Param() params: BatchIdParamDto): Promise<Observable<MessageEvent>> {
    return this.testRenders.streamBatch(params.batchId);
  }

  @Get('admin/garments/:garmentId/test-render')
  @Roles(Role.ADMIN)
  @ResponseMessage('Test render retrieved successfully')
  @ApiOperation({ summary: 'The render beside the source, for approval (A-11)' })
  @ApiOkResponse({ type: TestRenderResponseDto })
  @ApiStandardResponses({ notFound: true })
  describe(
    @Param() params: GarmentIdParamDto,
    @CurrentUser() admin: ICurrentUser,
  ): Promise<TestRenderResponseDto> {
    return this.testRenders.describe(params.garmentId, admin.id);
  }

  @Post('admin/garments/:garmentId/test-render/approve')
  @Roles(Role.ADMIN)
  @ResponseMessage('Test render approved')
  @ApiOperation({
    summary: 'Approve the stored test render and unblock publishing (A-11)',
    description:
      'Sets `testRenderState = APPROVED` **and** `testRenderApprovedAt`. The publish ' +
      'gate requires both columns, so a half-applied migration cannot let a piece ' +
      'through (E-10).',
  })
  @ApiOkResponse({ type: TestRenderResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true })
  approve(
    @Param() params: GarmentIdParamDto,
    @CurrentUser() admin: ICurrentUser,
  ): Promise<TestRenderResponseDto> {
    return this.testRenders.approve(params.garmentId, admin);
  }

  @Post('admin/garments/:garmentId/test-render/reject')
  @Roles(Role.ADMIN)
  @ResponseMessage('Test render rejected')
  @ApiOperation({ summary: 'Reject with a reason; the garment stays unpublishable (A-11)' })
  @ApiOkResponse({ type: TestRenderResponseDto })
  @ApiStandardResponses({ notFound: true })
  reject(
    @Param() params: GarmentIdParamDto,
    @Body() dto: RejectTestRenderDto,
    @CurrentUser() admin: ICurrentUser,
  ): Promise<TestRenderResponseDto> {
    return this.testRenders.reject(params.garmentId, dto, admin);
  }
}
