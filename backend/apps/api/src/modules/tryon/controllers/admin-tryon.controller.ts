import { Body, Controller, Get, Param, Post, Sse, type MessageEvent } from '@nestjs/common';
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
import { ReferenceModelsService } from '../services/reference-models.service';
import { TestRenderService } from '../services/test-render.service';

import type { Observable } from 'rxjs';

/**
 * The A-11 test-render gate and the A-12 bulk queue — ARCHITECTURE §5.11.
 *
 * **Every handler is `@Roles(Role.ADMIN)`.**
 *
 * The approve and reject routes are declared here rather than on `GarmentsController`
 * because they are the *test render's* state machine: they are what turns a rendered
 * image into an approved one, and `garments.testRenderState` is the column this module
 * writes. §5.11's route table puts them under `/admin/garments/:garmentId/test-render/*`
 * and this controller takes that prefix, so the URL still reads as a property of the
 * garment.
 */
@ApiTags('Try-on (admin)')
@Controller()
export class AdminTryOnController {
  constructor(
    private readonly testRenders: TestRenderService,
    private readonly referenceModels: ReferenceModelsService,
  ) {}

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

  /**
   * §5.11 — `text/event-stream`, **no envelope**.
   *
   * `ResponseTransformInterceptor` checks for Nest's `sse` metadata (which `@Sse()`
   * sets) and returns the handler's observable untouched, so nothing here ends up
   * inside `{ success, data, … }`. There is deliberately no `@ResponseMessage()` on
   * this route: it would be metadata for an envelope that is never built.
   *
   * Client disconnect is handled by RxJS: Nest unsubscribes, which tears down both the
   * batch channel subscription and the heartbeat interval inside it.
   */
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
