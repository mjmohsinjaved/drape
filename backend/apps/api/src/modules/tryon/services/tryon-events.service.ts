import { Injectable, Logger } from '@nestjs/common';

import { of, type Observable } from 'rxjs';

import { ReplayableEventBus, type BusMessageEvent } from './replayable-event-bus';

/** §5.11 — the four stages that drive the C-19 staged microcopy. */
export type TryOnStage = 'QUEUED' | 'UPLOADING' | 'GENERATING' | 'FINISHING';

export interface StageEventData {
  readonly stage: TryOnStage;
  readonly jobId: string;
  readonly elapsedMs: number;
}

export interface SucceededEventData {
  readonly jobId: string;
  readonly resultId: string;
  readonly url: string;
  readonly thumbnailUrl: string | null;
  readonly width: number;
  readonly height: number;
  readonly cacheHit: boolean;
}

export interface FailedEventData {
  readonly jobId: string;
  readonly errorCode: string;
  /** The §8.3 consumer copy, from `ERROR_CODE_SPECS`. Never a raw upstream message. */
  readonly message: string;
}

/** The SSE event names §5.11 defines. `heartbeat` keeps intermediaries from closing. */
export type TryOnEventName = 'stage' | 'succeeded' | 'failed' | 'heartbeat';

/** §5.11 — at least one `stage` every 2 s. */
const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * How long a terminal event stays replayable after the job ends.
 *
 * The client reconnects with `Last-Event-ID` and expects the terminal state replayed
 * (§5.11). Long enough to survive a tab switch, a tunnel change or a sleeping laptop;
 * short enough that a process holding a thousand finished jobs is not a leak. Beyond
 * it, the client falls back to the polling endpoint, which reads the row.
 */
const TERMINAL_RETENTION_MS = 10 * 60 * 1000;

/** §5.11 — the two events that end a job's stream. */
function isTerminalEvent(event: BusMessageEvent<TryOnEventName>): boolean {
  return event.type === 'succeeded' || event.type === 'failed';
}

/**
 * **The SSE bus — ARCHITECTURE §5.11, PRD §8.2, C-19.**
 *
 * > "Result delivery is by SSE from the API service. Long-lived connections are a
 * > further reason the API must run on a persistent container."
 *
 * One `Subject` per in-flight job, created on first publish or first subscribe.
 * `TryOnService` publishes stages as it works; the controller hands the observable to
 * `@Sse()` and Nest serialises it.
 *
 * ### Where the mechanism lives
 *
 * The buffering, the heartbeat, the terminal replay and the leak-free teardown are
 * {@link ReplayableEventBus}'s — shared with the A-12 batch bus, which had a
 * line-for-line copy of all of it. What this class owns is the §5.11 *vocabulary*: four
 * event names, three payload shapes, and a terminal predicate and retention window that
 * are deliberately its own (a seven-second try-on and a minutes-long batch do not want
 * the same reconnection window).
 *
 * **A finished job must still answer.** A client that reconnects after the terminal
 * event gets it replayed from {@link TERMINAL_RETENTION_MS}-bounded memory rather than
 * an open connection that never emits. Past that, `GET /tryon/jobs/:jobId` is the
 * documented polling fallback and reads the row.
 */
@Injectable()
export class TryOnEventsService extends ReplayableEventBus<TryOnEventName> {
  constructor() {
    super({
      isTerminal: isTerminalEvent,
      terminalRetentionMs: TERMINAL_RETENTION_MS,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      logger: new Logger(TryOnEventsService.name),
      subjectNoun: 'job',
    });
  }

  /** §5.11 `stage` — drives the staged microcopy of the seven-second wait. */
  publishStage(data: StageEventData): void {
    this.publish(data.jobId, { type: 'stage', id: data.jobId, data });
  }

  /** §5.11 `succeeded` — terminal. */
  publishSucceeded(data: SucceededEventData): void {
    this.publish(data.jobId, { type: 'succeeded', id: data.jobId, data });
  }

  /** §5.11 `failed` — terminal. `message` is the §8.3 consumer copy. */
  publishFailed(data: FailedEventData): void {
    this.publish(data.jobId, { type: 'failed', id: data.jobId, data });
  }

  /**
   * The stream for one job.
   *
   * Ownership is checked by the caller before this is reached — a consumer may only
   * stream her own job, and the refusal is a masked `JOB_NOT_FOUND` (§5.11, §2.4).
   * This service holds no authorisation logic and must not be given any: it would be
   * the wrong place for it and would be reachable only after the check anyway.
   */
  stream(jobId: string): Observable<BusMessageEvent<TryOnEventName>> {
    const replay = this.replayableTerminal(jobId);

    return replay !== null ? of(replay) : this.liveStream(jobId);
  }

  protected heartbeat(): BusMessageEvent<TryOnEventName> {
    return { type: 'heartbeat', data: {} };
  }
}
