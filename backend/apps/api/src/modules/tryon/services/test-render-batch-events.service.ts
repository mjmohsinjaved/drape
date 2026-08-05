import { Injectable, Logger, type MessageEvent } from '@nestjs/common';

import { Subject, concat, interval, map, merge, of, takeWhile, type Observable } from 'rxjs';

import type {
  TestRenderBatchItemDto,
  TestRenderBatchResponseDto,
} from '../dto/test-render-response.dto';

/** §5.11 — the event names of `GET /admin/tryon/batches/:batchId/stream`. */
export type BatchEventName = 'progress' | 'completed' | 'heartbeat';

/**
 * A `progress` frame: the whole batch summary, plus the one item that just changed.
 *
 * Both halves matter. The summary is what draws D-16's counters and cannot be derived
 * by a client that missed a frame; `item` is what lets the console update one row of
 * its table instead of re-rendering fifty.
 */
export interface BatchProgressEventData {
  readonly batchId: string;
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly pending: number;
  /** The item this frame is about. `null` on the snapshot sent when a client connects. */
  readonly item: TestRenderBatchItemDto | null;
}

/** The terminal frame: every item has reached a final state. */
export interface BatchCompletedEventData {
  readonly batchId: string;
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
}

/** §5.11 — a heartbeat every 15 s, so intermediaries do not close a quiet batch. */
const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * How long `completed` stays replayable after the batch ends.
 *
 * A batch of fifty renders at concurrency one runs for minutes, so an admin will
 * reconnect. Long enough to survive a tab switch or a sleeping laptop; short enough
 * that a process that has run a hundred batches is not holding a hundred frames.
 * Beyond it, `GET /admin/tryon/batches/:batchId` is the documented fallback and reads
 * the rows (§8.2 expects both, and the console polls it every three seconds).
 */
const TERMINAL_RETENTION_MS = 30 * 60 * 1000;

interface TerminalRecord {
  readonly event: MessageEvent;
  readonly at: number;
}

function isTerminalEvent(event: MessageEvent): boolean {
  return event.type === 'completed';
}

/**
 * **The A-12 batch SSE bus — ARCHITECTURE §5.11, PRD §8.2, D-16.**
 *
 * The catalogue-side twin of {@link TryOnEventsService}: same shape, same three
 * hazards, different vocabulary. A bulk test render runs at concurrency one (§8.2), so
 * a fifty-item batch is minutes of work and an admin watching it needs to be told what
 * happened rather than asked to poll for it.
 *
 * ### The three things that are easy to get wrong here
 *
 * **The envelope must not wrap it.** `ResponseTransformInterceptor` returns early for
 * any handler carrying Nest's `sse` metadata, which `@Sse()` sets, and for any response
 * that has already committed to `text/event-stream`. The controller therefore adds no
 * `@ResponseMessage()` and returns the raw observable.
 *
 * **A disconnect must not leak.** The stream is `merge(events, heartbeat)` piped
 * through `takeWhile(notTerminal, inclusive)`. When the client goes away Nest
 * unsubscribes, which tears down the heartbeat interval with it — there is no timer
 * owned by this service and no listener to remove by hand. `activeStreamCount` exists
 * so a test can assert exactly that.
 *
 * **A finished batch must still answer.** A client that connects after the last item
 * gets `completed` replayed from {@link TERMINAL_RETENTION_MS}-bounded memory rather
 * than an open connection that never emits.
 *
 * ### Why a client gets a snapshot the moment it connects
 *
 * A batch is long-running and the console typically opens the stream *after* queueing
 * it — sometimes seconds later, sometimes on a page reload halfway through. Without a
 * snapshot the first thing the screen would show is an empty table until the next item
 * finished, which for a slow render is fifteen seconds of looking broken (D-5). So
 * {@link stream} takes the current summary and emits it as a `progress` frame with
 * `item: null` before anything live arrives.
 */
@Injectable()
export class TestRenderBatchEventsService {
  private readonly logger = new Logger(TestRenderBatchEventsService.name);

  private readonly channels = new Map<string, Subject<MessageEvent>>();

  private readonly terminals = new Map<string, TerminalRecord>();

  /** Live subscriber count, for the leak test. */
  get activeStreamCount(): number {
    let total = 0;
    for (const subject of this.channels.values()) {
      total += subject.observed ? 1 : 0;
    }
    return total;
  }

  /** §5.11 `progress` — the batch summary plus the item that changed (D-16). */
  publishProgress(data: BatchProgressEventData): void {
    this.publish(data.batchId, { type: 'progress', id: data.batchId, data });
  }

  /** §5.11 `completed` — terminal. The stream closes after it. */
  publishCompleted(data: BatchCompletedEventData): void {
    this.publish(data.batchId, { type: 'completed', id: data.batchId, data });
  }

  /**
   * Publishes the right frame for a summary: `completed` once nothing is pending,
   * `progress` otherwise.
   *
   * One method rather than two call sites deciding for themselves, because "is this
   * batch finished?" must have exactly one definition — `pending === 0` — and a
   * processor that answered it differently would leave streams open forever.
   */
  publishSummary(summary: TestRenderBatchResponseDto, item: TestRenderBatchItemDto | null): void {
    if (summary.pending === 0) {
      this.publishCompleted({
        batchId: summary.batchId,
        total: summary.total,
        succeeded: summary.succeeded,
        failed: summary.failed,
      });
      return;
    }

    this.publishProgress({
      batchId: summary.batchId,
      total: summary.total,
      succeeded: summary.succeeded,
      failed: summary.failed,
      pending: summary.pending,
      item,
    });
  }

  /**
   * The stream for one batch.
   *
   * Authorisation is the caller's job and is done before this is reached — the route
   * is `@Roles(Role.ADMIN)` and the batch is resolved first, so an unknown id is a
   * masked `JOB_NOT_FOUND` rather than an open stream that never emits. This service
   * holds no authorisation logic and must not be given any.
   *
   * @param snapshot the batch as it stands right now, emitted first. See the note on
   * the class for why.
   */
  stream(batchId: string, snapshot: TestRenderBatchResponseDto): Observable<MessageEvent> {
    const opening = this.openingEvent(batchId, snapshot);

    // Already finished: say so and close, rather than hold a connection open for a
    // batch that will never emit again.
    if (snapshot.pending === 0) {
      return of(opening);
    }

    const replay = this.replayableTerminal(batchId);
    if (replay !== null) {
      return concat(of(opening), of(replay));
    }

    const channel = this.channelFor(batchId);
    const heartbeat: Observable<MessageEvent> = interval(HEARTBEAT_INTERVAL_MS).pipe(
      map((): MessageEvent => ({ type: 'heartbeat', data: {} })),
    );

    return concat(
      of(opening),
      merge(channel.asObservable(), heartbeat).pipe(
        // `inclusive` — emit the terminal event, then complete, which closes the
        // connection (§5.11: "the stream closes after a terminal event").
        takeWhile((event) => !isTerminalEvent(event), true),
      ),
    );
  }

  /** Drops a batch's channel and its replayable terminal. */
  forget(batchId: string): void {
    this.channels.get(batchId)?.complete();
    this.channels.delete(batchId);
    this.terminals.delete(batchId);
  }

  private openingEvent(batchId: string, snapshot: TestRenderBatchResponseDto): MessageEvent {
    const data: BatchProgressEventData = {
      batchId,
      total: snapshot.total,
      succeeded: snapshot.succeeded,
      failed: snapshot.failed,
      pending: snapshot.pending,
      // Nothing changed to produce this frame — it is the state as found.
      item: null,
    };
    return { type: 'progress', id: batchId, data };
  }

  private publish(batchId: string, event: MessageEvent): void {
    if (isTerminalEvent(event)) {
      this.sweepTerminals();
      this.terminals.set(batchId, { event, at: Date.now() });
    }

    const channel = this.channels.get(batchId);
    if (channel === undefined) {
      // Nobody is watching — normal for a batch queued from one tab and left to run.
      // The terminal record above is what a late subscriber will read.
      return;
    }

    channel.next(event);

    if (isTerminalEvent(event)) {
      channel.complete();
      this.channels.delete(batchId);
      this.logger.debug('Closed the stream for a finished batch.');
    }
  }

  private channelFor(batchId: string): Subject<MessageEvent> {
    const existing = this.channels.get(batchId);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Subject<MessageEvent>();
    this.channels.set(batchId, created);
    return created;
  }

  private replayableTerminal(batchId: string): MessageEvent | null {
    const record = this.terminals.get(batchId);
    if (record === undefined) {
      return null;
    }
    if (Date.now() - record.at > TERMINAL_RETENTION_MS) {
      this.terminals.delete(batchId);
      return null;
    }
    return record.event;
  }

  private sweepTerminals(): void {
    const cutoff = Date.now() - TERMINAL_RETENTION_MS;
    for (const [batchId, record] of this.terminals) {
      if (record.at < cutoff) {
        this.terminals.delete(batchId);
      }
    }
  }
}
