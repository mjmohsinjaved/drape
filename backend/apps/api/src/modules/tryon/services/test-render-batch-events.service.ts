import { Injectable, Logger } from '@nestjs/common';

import { concat, of, type Observable } from 'rxjs';

import { ReplayableEventBus, type BusMessageEvent } from './replayable-event-bus';

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

/** §5.11 — the one event that ends a batch's stream. */
function isTerminalEvent(event: BusMessageEvent<BatchEventName>): boolean {
  return event.type === 'completed';
}

/**
 * **The A-12 batch SSE bus — ARCHITECTURE §5.11, PRD §8.2, D-16.**
 *
 * The catalogue-side twin of `TryOnEventsService`: same mechanism, different vocabulary.
 * A bulk test render runs at concurrency one (§8.2), so
 * a fifty-item batch is minutes of work and an admin watching it needs to be told what
 * happened rather than asked to poll for it.
 *
 * ### Where the mechanism lives
 *
 * The buffering, the heartbeat, the terminal replay and the leak-free teardown are
 * {@link ReplayableEventBus}'s, shared with `TryOnEventsService`. What this class owns is
 * the batch *vocabulary* and the opening snapshot below — plus the two values that
 * genuinely differ and stay parameters: `completed` is the only terminal event here, and
 * a batch that runs for minutes keeps its terminal frame three times as long as a job.
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
export class TestRenderBatchEventsService extends ReplayableEventBus<BatchEventName> {
  constructor() {
    super({
      isTerminal: isTerminalEvent,
      terminalRetentionMs: TERMINAL_RETENTION_MS,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      logger: new Logger(TestRenderBatchEventsService.name),
      subjectNoun: 'batch',
    });
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
  stream(
    batchId: string,
    snapshot: TestRenderBatchResponseDto,
  ): Observable<BusMessageEvent<BatchEventName>> {
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

    return concat(of(opening), this.liveStream(batchId));
  }

  protected heartbeat(): BusMessageEvent<BatchEventName> {
    return { type: 'heartbeat', data: {} };
  }

  private openingEvent(
    batchId: string,
    snapshot: TestRenderBatchResponseDto,
  ): BusMessageEvent<BatchEventName> {
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
}
