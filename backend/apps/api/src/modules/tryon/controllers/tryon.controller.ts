import { Body, Controller, Get, Param, Post, Query, Req, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
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

import { CreateTryOnDto } from '../dto/create-tryon.dto';
import { TryOnJobQueryDto } from '../dto/tryon-job-query.dto';
import { TryOnJobResponseDto } from '../dto/tryon-job-response.dto';
import { JobIdParamDto } from '../dto/tryon-params.dto';
import { TryOnJobsService } from '../services/tryon-jobs.service';
import { TryOnService } from '../services/tryon.service';

import type { Request } from 'express';
import type { Observable } from 'rxjs';

/**
 * The consumer try-on surface — ARCHITECTURE §5.11, PRD §8.1.
 *
 * **Every handler is `@Roles(Role.CONSUMER)`.** An admin has no route in here: A-11
 * test renders live on the admin controller and spend budget under their own reason
 * (§8.4), and A-31 preview mode is handled inside `TryOnService` before the guard chain
 * so an admin browsing the consumer experience never spends a generation.
 *
 * The `POST` throttle is the §5.22 override: 6 per 60 s. It is a burst guard, not the
 * cost control — the hour-long per-account and per-IP ceilings (C-6) and the monthly
 * quota are guard-chain steps 6 and 7, inside the spend decision where they belong.
 */
@ApiTags('Try-on')
@Controller('tryon')
export class TryOnController {
  constructor(
    private readonly tryOn: TryOnService,
    private readonly jobs: TryOnJobsService,
  ) {}

  @Post()
  @Roles(Role.CONSUMER)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ResponseMessage('Try-on started')
  @ApiOperation({
    summary: 'Start a try-on (§8.1)',
    description:
      'Runs the full §8.1 step-3 guard chain **before any spend**, then the §3.7 cache ' +
      'lookup, then the upstream call. A cache hit returns the render in this response ' +
      'and consumes no quota (C-22). A miss returns the job; hold the SSE stream or ' +
      'poll `GET /tryon/jobs/:jobId`.',
  })
  @ApiOkResponse({ type: TryOnJobResponseDto })
  @ApiStandardResponses({ notFound: true, conflict: true, unprocessable: true })
  create(
    @Body() dto: CreateTryOnDto,
    @CurrentUser() user: ICurrentUser,
    @Req() request: Request,
  ): Promise<TryOnJobResponseDto> {
    // Express has already applied `TRUST_PROXY`, so this is the client address and not
    // the proxy's. It is used for the C-6 per-IP ceiling and is never stored (§9.3).
    return this.tryOn.create(dto, user, request.ip);
  }

  @Get('jobs')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Jobs retrieved successfully')
  @ApiOperation({ summary: 'Recent and in-flight jobs — the results tray (C-19)' })
  @ApiOkResponse({ type: [TryOnJobResponseDto] })
  @ApiStandardResponses()
  list(
    @Query() query: TryOnJobQueryDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<IPaginated<TryOnJobResponseDto>> {
    return this.jobs.list(user, query);
  }

  @Get('jobs/:jobId')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Job retrieved successfully')
  @ApiOperation({
    summary: 'Poll one job — the SSE fallback (§5.11)',
    description:
      'Reads the row, so it is correct however long ago the job finished and whatever ' +
      'happened to the stream in between.',
  })
  @ApiOkResponse({ type: TryOnJobResponseDto })
  @ApiStandardResponses({ notFound: true })
  findOne(
    @Param() params: JobIdParamDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<TryOnJobResponseDto> {
    return this.jobs.findOne(user, params.jobId);
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
   * job channel subscription and the heartbeat interval inside it.
   */
  @Sse('jobs/:jobId/stream')
  @Roles(Role.CONSUMER)
  @ApiProduces('text/event-stream')
  @ApiOperation({
    summary: 'Live job progress (§5.11)',
    description:
      'Events: `stage` (QUEUED | UPLOADING | GENERATING | FINISHING), `succeeded`, ' +
      '`failed`, and a `heartbeat` every 15 s. The stream closes after a terminal ' +
      'event; reconnecting replays it while it is still retained, and ' +
      '`GET /tryon/jobs/:jobId` is correct forever after.',
  })
  @ApiStandardResponses({ notFound: true })
  stream(
    @Param() params: JobIdParamDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<Observable<MessageEvent>> {
    return this.jobs.streamFor(user, params.jobId);
  }

  @Post('jobs/:jobId/cancel')
  @Roles(Role.CONSUMER)
  @ResponseMessage('Try-on cancelled')
  @ApiOperation({
    summary: 'Give up on a job (§5.11)',
    description:
      'No quota is consumed either way — quota is only ever charged from the SUCCEEDED ' +
      'branch of the runner, so cancelling costs nothing by construction.',
  })
  @ApiOkResponse({ type: TryOnJobResponseDto })
  @ApiStandardResponses({ notFound: true })
  cancel(
    @Param() params: JobIdParamDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<TryOnJobResponseDto> {
    return this.jobs.cancel(user, params.jobId);
  }
}
