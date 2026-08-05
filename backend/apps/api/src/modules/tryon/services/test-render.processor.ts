import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Not, Repository } from 'typeorm';

import { TryOnConfig } from '../config/tryon.config';
import { TryOnJob } from '../entities/tryon-job.entity';
import { JobOrigin } from '../enums/job-origin.enum';
import { JobStatus } from '../enums/job-status.enum';

import { TestRenderService } from './test-render.service';
import { TryOnRunnerService } from './tryon-runner.service';

/** How often the queue is checked. Well under a generation, so a batch never idles. */
const TICK_MS = 2_000;

/**
 * **The A-12 bulk test-render processor — PRD §8.2.**
 *
 * > "Admin bulk test renders run through a NestJS task processor at concurrency one,
 * > so catalog work never competes with a live consumer generation."
 *
 * That sentence is the whole design. A consumer waiting seven seconds for her render
 * (C-19) and an admin queueing fifty catalogue renders are competing for the same
 * ten-image-a-day upstream and the same monthly budget, and the consumer must win. So
 * this processor takes **one** queued job at a time and holds it until it finishes.
 *
 * ### Why an in-process interval and not a queue
 *
 * PRD §8.2 rules a queue out for V1: the API is a persistent NestJS process, the job
 * row carries the state, and `ScheduleModule` is already wired in the composition root.
 * `TRYON_TEST_RENDER_CONCURRENCY` exists so the ceiling is configuration rather than a
 * constant, but it is `1` and there is no reason for it to be anything else while there
 * is one API process.
 *
 * ### Re-entrancy
 *
 * `@Interval` fires on a timer regardless of whether the previous tick finished, so the
 * `active` counter — not the timer — is what enforces the limit. A tick that finds the
 * limit reached returns immediately and costs one comparison.
 */
@Injectable()
export class TestRenderProcessor {
  private readonly logger = new Logger(TestRenderProcessor.name);

  /** Jobs currently executing. The §8.2 concurrency ceiling is enforced against this. */
  private active = 0;

  constructor(
    @InjectRepository(TryOnJob)
    private readonly jobs: Repository<TryOnJob>,
    private readonly testRenders: TestRenderService,
    private readonly runner: TryOnRunnerService,
    private readonly config: TryOnConfig,
  ) {}

  /** How many batch renders are in flight. Exposed so a test can assert the ceiling. */
  get activeCount(): number {
    return this.active;
  }

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    await this.drainOnce();
  }

  /**
   * Claims and runs at most one queued batch render.
   *
   * Separated from {@link tick} so a test can drive it deterministically without
   * waiting on a timer, and so the scheduled entry point has nothing in it but the
   * schedule.
   */
  async drainOnce(): Promise<void> {
    if (this.active >= this.config.testRenderConcurrency) {
      return;
    }

    const job = await this.jobs.findOne({
      where: {
        status: JobStatus.QUEUED,
        origin: JobOrigin.TEST_RENDER,
        // Only batch work is drained here; a single interactive test render runs
        // inline on the admin's request and never reaches the queue.
        batchId: Not(IsNull()),
      },
      order: { createdAt: 'ASC' },
    });

    if (job === null || job.garmentId === null) {
      return;
    }

    this.active += 1;
    const batchId = job.batchId;

    try {
      const request = await this.testRenders.buildRequest(
        job.garmentId,
        job.userId,
        job.referenceModelId ?? undefined,
        { batchId: batchId ?? undefined, existingJobId: job.id },
      );

      await this.runner.run(request);
    } catch (error: unknown) {
      // The runner has already marked the row `FAILED` with its §8.3 code and, where
      // the taxonomy asks for it, flagged the garment. There is nobody to return an
      // exception to — the admin reads the outcome from the batch endpoint — so it is
      // logged and the next tick moves on. Swallowing here is what stops one bad
      // garment from stalling a fifty-item batch.
      this.logger.warn(
        `A batch test render failed and the batch continues. ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.active -= 1;
      await this.announce(batchId, job.id);
    }
  }

  /**
   * Tells anyone watching the batch stream that one item has reached a final state
   * (§5.11, D-16).
   *
   * In `finally`, so a failed render moves the counters exactly as a successful one
   * does — a batch whose stream only advanced on success would sit at "3 of 50" while
   * the other forty-seven failed.
   *
   * Its own try/catch, because publishing is not the work. A batch must not stall
   * because nobody was listening, or because reading the summary raced a deletion; the
   * polling endpoint (§8.2's other half) is correct either way.
   */
  private async announce(batchId: string | null, jobId: string): Promise<void> {
    if (batchId === null) {
      return;
    }
    try {
      await this.testRenders.publishBatchProgress(batchId, jobId);
    } catch (error: unknown) {
      this.logger.warn(
        `Batch progress could not be published; the polling endpoint still reports it. ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
