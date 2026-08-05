import { Injectable, Logger, type MessageEvent } from '@nestjs/common';

import { Subject, interval, map, merge, of, takeWhile, type Observable } from 'rxjs';

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

interface TerminalRecord {
  readonly event: MessageEvent;
  readonly at: number;
}

function isTerminalEvent(event: MessageEvent): boolean {
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
 * ### The three things that are easy to get wrong here
 *
 * **The envelope must not wrap it.** `ResponseTransformInterceptor` returns early for
 * any handler carrying Nest's `sse` metadata and for any response that has already
 * committed to `text/event-stream`, so an `@Sse()` route is never JSON-wrapped. The
 * controller therefore adds no `@ResponseMessage()` and returns the raw observable.
 *
 * **A disconnect must not leak.** The stream is `merge(events, heartbeat)` piped
 * through `takeWhile(notTerminal, inclusive)`. When the client goes away Nest
 * unsubscribes, which tears down the heartbeat interval with it — there is no timer
 * owned by this service and no listener to remove by hand. `activeStreamCount` exists
 * so a test can assert exactly that.
 *
 * **A finished job must still answer.** A client that reconnects after the terminal
 * event gets it replayed from {@link TERMINAL_RETENTION_MS}-bounded memory rather than
 * an open connection that never emits. Past that, `GET /tryon/jobs/:jobId` is the
 * documented polling fallback and reads the row.
 */
@Injectable()
export class TryOnEventsService {
  private readonly logger = new Logger(TryOnEventsService.name);

  private readonly channels = new Map<string, Subject<MessageEvent>>();

  private readonly terminals = new Map<string, TerminalRecord>();

  /** Live subscriber count, for the leak test and for `tryon.in_flight`. */
  get activeStreamCount(): number {
    let total = 0;
    for (const subject of this.channels.values()) {
      total += subject.observed ? 1 : 0;
    }
    return total;
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
  stream(jobId: string): Observable<MessageEvent> {
    const replay = this.replayableTerminal(jobId);
    if (replay !== null) {
      return of(replay);
    }

    const channel = this.channelFor(jobId);
    const heartbeat: Observable<MessageEvent> = interval(HEARTBEAT_INTERVAL_MS).pipe(
      map((): MessageEvent => ({ type: 'heartbeat', data: {} })),
    );

    return merge(channel.asObservable(), heartbeat).pipe(
      // `inclusive` — emit the terminal event, then complete, which closes the
      // connection (§5.11: "the stream closes after a terminal event").
      takeWhile((event) => !isTerminalEvent(event), true),
    );
  }

  /** Drops a job's channel and its replayable terminal. Called when a job is pruned. */
  forget(jobId: string): void {
    this.channels.get(jobId)?.complete();
    this.channels.delete(jobId);
    this.terminals.delete(jobId);
  }

  private publish(jobId: string, event: MessageEvent): void {
    if (isTerminalEvent(event)) {
      this.sweepTerminals();
      this.terminals.set(jobId, { event, at: Date.now() });
    }

    const channel = this.channels.get(jobId);
    if (channel === undefined) {
      // Nobody is listening yet — normal for a fast cache hit, where the result is in
      // the POST response before any client opens a stream. The terminal record above
      // is what a late subscriber will read.
      return;
    }

    channel.next(event);

    if (isTerminalEvent(event)) {
      channel.complete();
      this.channels.delete(jobId);
      this.logger.debug(`Closed the stream for a finished job.`);
    }
  }

  private channelFor(jobId: string): Subject<MessageEvent> {
    const existing = this.channels.get(jobId);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Subject<MessageEvent>();
    this.channels.set(jobId, created);
    return created;
  }

  private replayableTerminal(jobId: string): MessageEvent | null {
    const record = this.terminals.get(jobId);
    if (record === undefined) {
      return null;
    }
    if (Date.now() - record.at > TERMINAL_RETENTION_MS) {
      this.terminals.delete(jobId);
      return null;
    }
    return record.event;
  }

  private sweepTerminals(): void {
    const cutoff = Date.now() - TERMINAL_RETENTION_MS;
    for (const [jobId, record] of this.terminals) {
      if (record.at < cutoff) {
        this.terminals.delete(jobId);
      }
    }
  }
}
