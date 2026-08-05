import { Injectable, Logger, type MessageEvent } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository, type FindOptionsWhere } from 'typeorm';

import {
  ErrorCode,
  NotFoundException,
  OwnershipException,
  paginate,
  paginationSkip,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';
import { StorageService } from '@library/storage';

import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';

import { TryOnJob } from '../entities/tryon-job.entity';
import { JobStatus } from '../enums/job-status.enum';
import { toTryOnJobResponse } from '../mappers/tryon-job.mapper';

import { TryOnEventsService } from './tryon-events.service';

import type { TryOnJobQueryDto } from '../dto/tryon-job-query.dto';
import type { TryOnJobResponseDto } from '../dto/tryon-job-response.dto';
import type { Observable } from 'rxjs';

/**
 * The read and control surface over `tryon_jobs` — §5.11.
 *
 * Three routes and one rule: **a consumer only ever sees her own jobs.** Ownership is
 * checked once, in {@link loadOwned}, and the cross-account case throws the true
 * `JOB_NOT_OWNED`, which `GlobalExceptionFilter` masks to `JOB_NOT_FOUND` before it
 * reaches the client (§2.4, S-9, E-7). The SSE route goes through the same check
 * before a stream is ever opened.
 *
 * Cancelling is deliberately cheap and deliberately safe: §5.11 says "no quota is
 * consumed either way", and since quota is only ever charged from the `SUCCEEDED`
 * branch of the runner, cancelling costs nothing by construction rather than by
 * refund.
 */
@Injectable()
export class TryOnJobsService {
  private readonly logger = new Logger(TryOnJobsService.name);

  constructor(
    @InjectRepository(TryOnJob)
    private readonly jobs: Repository<TryOnJob>,
    @InjectRepository(TryOnResult)
    private readonly results: Repository<TryOnResult>,
    private readonly stream: TryOnEventsService,
    private readonly storage: StorageService,
  ) {}

  /** `GET /tryon/jobs` — the results tray (C-19). */
  async list(
    user: ICurrentUser,
    query: TryOnJobQueryDto,
  ): Promise<IPaginated<TryOnJobResponseDto>> {
    const where: FindOptionsWhere<TryOnJob> = { userId: user.id, isTestRender: false };
    if (query.status !== undefined) {
      where.status = query.status;
    }

    const [rows, total] = await this.jobs.findAndCount({
      where,
      order: { createdAt: query.sortOrder },
      skip: paginationSkip(query),
      take: query.limit,
    });

    const results = await this.resultsByJobId(rows);

    return paginate(
      rows.map((job) =>
        toTryOnJobResponse(job, results.get(job.id) ?? null, (key) =>
          this.storage.signedUrl(key, user.id),
        ),
      ),
      query,
      total,
    );
  }

  /**
   * `GET /tryon/jobs/:jobId` — **the documented SSE fallback** (§5.11).
   *
   * Every client can poll this instead of holding a stream: a corporate proxy that
   * buffers `text/event-stream`, a browser that has hit its connection ceiling, or a
   * reconnect that arrived after the terminal event aged out of memory. It reads the
   * row, so it is correct however long ago the job finished.
   */
  async findOne(user: ICurrentUser, jobId: string): Promise<TryOnJobResponseDto> {
    const job = await this.loadOwned(user.id, jobId);
    const result = await this.results.findOne({ where: { jobId: job.id } });

    return toTryOnJobResponse(job, result, (key) => this.storage.signedUrl(key, user.id));
  }

  /**
   * `GET /tryon/jobs/:jobId/stream` — SSE (§5.11).
   *
   * Ownership is asserted **before** the observable is built, so an unauthorised caller
   * gets a normal masked error response rather than an open stream that never emits.
   */
  async streamFor(user: ICurrentUser, jobId: string): Promise<Observable<MessageEvent>> {
    await this.loadOwned(user.id, jobId);
    return this.stream.stream(jobId);
  }

  /** `POST /tryon/jobs/:jobId/cancel` — give up on a job. No quota either way (§5.11). */
  async cancel(user: ICurrentUser, jobId: string): Promise<TryOnJobResponseDto> {
    const job = await this.loadOwned(user.id, jobId);

    if (job.status === JobStatus.QUEUED || job.status === JobStatus.RUNNING) {
      const finishedAt = new Date();
      await this.jobs.update(
        { id: job.id },
        {
          status: JobStatus.CANCELLED,
          finishedAt,
          durationMs: finishedAt.getTime() - (job.startedAt?.getTime() ?? finishedAt.getTime()),
        },
      );
      job.status = JobStatus.CANCELLED;
      job.finishedAt = finishedAt;

      // Close the stream so a client that was watching stops waiting. The upstream
      // call, if one is in flight, is not aborted — it may still land, and a landed
      // render is worth keeping since the budget was going to be spent regardless.
      this.stream.publishFailed({
        jobId: job.id,
        errorCode: JobStatus.CANCELLED,
        message: 'Cancelled.',
      });

      this.logger.debug('A consumer cancelled a job; nothing was charged.');
    }

    return toTryOnJobResponse(job, null, (key) => this.storage.signedUrl(key, user.id));
  }

  /**
   * The row, ownership-checked.
   *
   * Loaded by id first and compared after, rather than filtered by `(id, userId)`, so
   * that "somebody else's job" is *logged* as `JOB_NOT_OWNED` even though the client is
   * told `JOB_NOT_FOUND`. E-7 asserts both halves of that.
   */
  private async loadOwned(userId: string, jobId: string): Promise<TryOnJob> {
    const job = await this.jobs.findOne({ where: { id: jobId } });

    if (job === null) {
      throw new NotFoundException(ErrorCode.JOB_NOT_FOUND);
    }
    if (job.userId !== userId) {
      throw new OwnershipException(ErrorCode.JOB_NOT_OWNED);
    }
    return job;
  }

  private async resultsByJobId(jobs: readonly TryOnJob[]): Promise<Map<string, TryOnResult>> {
    const ids = jobs.map((job) => job.id);
    if (ids.length === 0) {
      return new Map();
    }

    const rows = await this.results.find({ where: { jobId: In(ids) } });

    return new Map(
      rows
        .filter((row): row is TryOnResult & { jobId: string } => row.jobId !== null)
        .map((row) => [row.jobId, row]),
    );
  }
}
