import type { CallHandler, ExecutionContext, MessageEvent } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { firstValueFrom, lastValueFrom, of, toArray, type Observable } from 'rxjs';

import { ResponseTransformInterceptor } from '@library/common';

import { AdminTryOnController } from '../controllers/admin-tryon.controller';
import { JobStatus } from '../enums/job-status.enum';

import { TestRenderBatchEventsService } from './test-render-batch-events.service';

import type {
  TestRenderBatchItemDto,
  TestRenderBatchResponseDto,
} from '../dto/test-render-response.dto';

/**
 * The A-12 batch SSE bus — ARCHITECTURE §5.11, PRD §8.2, D-16.
 *
 * Four properties, one test each, and they are the four that are expensive to get wrong:
 *
 *  - **the envelope must not wrap it** — a `text/event-stream` inside `{ success, data }`
 *    is not an event stream, and the browser's `EventSource` simply never fires;
 *  - **a disconnect must not leak** — a bulk batch runs for minutes and an admin who
 *    closes the tab must take the heartbeat interval with her;
 *  - **`progress` carries both halves** — the summary D-16's counters need *and* the one
 *    item that changed, so the console updates one row instead of fifty;
 *  - **the stream ends on `completed`** — a connection held open after the last item is a
 *    socket nobody will ever close.
 */

const BATCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GARMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const JOB_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function item(overrides: Partial<TestRenderBatchItemDto> = {}): TestRenderBatchItemDto {
  return {
    garmentId: GARMENT_ID,
    jobId: JOB_ID,
    status: JobStatus.SUCCEEDED,
    errorCode: null,
    ...overrides,
  };
}

function summary(overrides: Partial<TestRenderBatchResponseDto> = {}): TestRenderBatchResponseDto {
  return {
    batchId: BATCH_ID,
    total: 3,
    succeeded: 1,
    failed: 0,
    pending: 2,
    items: [item()],
    ...overrides,
  };
}

/** The data half of a frame, typed — `MessageEvent.data` is `unknown` by declaration. */
function dataOf(event: MessageEvent): Record<string, unknown> {
  return event.data as Record<string, unknown>;
}

describe('TestRenderBatchEventsService — the A-12 batch stream (§5.11, D-16)', () => {
  describe('the frame the console draws from', () => {
    it('opens with a snapshot so a console joining a running batch is not blank (D-5)', async () => {
      const events = new TestRenderBatchEventsService();

      const opening = await firstValueFrom(events.stream(BATCH_ID, summary()));

      expect(opening.type).toBe('progress');
      expect(dataOf(opening)).toEqual({
        batchId: BATCH_ID,
        total: 3,
        succeeded: 1,
        failed: 0,
        pending: 2,
        // Nothing changed to produce this frame — it is the state as found.
        item: null,
      });
    });

    it('carries the batch summary *and* the item that changed on every progress frame', async () => {
      const events = new TestRenderBatchEventsService();
      const frames: MessageEvent[] = [];
      const subscription = events.stream(BATCH_ID, summary()).subscribe({
        next: (event) => frames.push(event),
      });

      const changed = item({ status: JobStatus.FAILED, errorCode: 'UPSTREAM_TIMEOUT' });
      events.publishSummary(
        summary({ succeeded: 1, failed: 1, pending: 1, items: [changed] }),
        changed,
      );

      // [0] is the opening snapshot; [1] is the live frame.
      const live = frames[1];
      expect(live).toBeDefined();
      expect(live.type).toBe('progress');
      expect(dataOf(live)).toEqual({
        batchId: BATCH_ID,
        total: 3,
        succeeded: 1,
        failed: 1,
        pending: 1,
        item: changed,
      });

      subscription.unsubscribe();
    });

    it('publishes `completed` — not `progress` — the moment nothing is pending', async () => {
      const events = new TestRenderBatchEventsService();
      const collected = lastValueFrom(events.stream(BATCH_ID, summary()).pipe(toArray()));

      events.publishSummary(summary({ succeeded: 2, failed: 1, pending: 0 }), item());

      const received = await collected;
      expect(received.map((event) => event.type)).toEqual(['progress', 'completed']);
      expect(dataOf(received[1])).toEqual({
        batchId: BATCH_ID,
        total: 3,
        succeeded: 2,
        failed: 1,
      });
    });
  });

  describe('termination', () => {
    it('closes the stream after `completed` (§5.11)', () => {
      const events = new TestRenderBatchEventsService();
      const completed = jest.fn();

      const subscription = events.stream(BATCH_ID, summary()).subscribe({ complete: completed });

      events.publishCompleted({ batchId: BATCH_ID, total: 3, succeeded: 3, failed: 0 });

      expect(completed).toHaveBeenCalled();
      expect(subscription.closed).toBe(true);
    });

    it('does not hold a connection open for a batch that already finished', async () => {
      const events = new TestRenderBatchEventsService();

      const received = await lastValueFrom(
        events.stream(BATCH_ID, summary({ succeeded: 3, failed: 0, pending: 0 })).pipe(toArray()),
      );

      // One snapshot, then complete. A batch with nothing pending will never emit again.
      expect(received).toHaveLength(1);
      expect(received[0]?.type).toBe('progress');
    });

    it('replays `completed` to a client that reconnects after the batch ended', async () => {
      const events = new TestRenderBatchEventsService();
      events.publishCompleted({ batchId: BATCH_ID, total: 3, succeeded: 3, failed: 0 });

      // The snapshot is stale — the poll route is the source of truth — but the stream
      // must still answer rather than hang.
      const received = await lastValueFrom(events.stream(BATCH_ID, summary()).pipe(toArray()));

      expect(received.map((event) => event.type)).toEqual(['progress', 'completed']);
    });

    it('publishing to nobody is not an error — a batch is usually queued and left', () => {
      const events = new TestRenderBatchEventsService();

      expect(() => {
        events.publishProgress({
          batchId: BATCH_ID,
          total: 3,
          succeeded: 1,
          failed: 0,
          pending: 2,
          item: item(),
        });
        events.publishCompleted({ batchId: BATCH_ID, total: 3, succeeded: 3, failed: 0 });
      }).not.toThrow();
    });
  });

  describe('leaks', () => {
    it('unsubscribes cleanly when the client disconnects mid-batch', () => {
      const events = new TestRenderBatchEventsService();

      const subscription = events.stream(BATCH_ID, summary()).subscribe();
      expect(events.activeStreamCount).toBe(1);

      // Nest unsubscribes on disconnect. The heartbeat interval is inside the merged
      // observable rather than a timer this service owns, so it goes with it — which is
      // what jest's "open handle" detection would otherwise report.
      subscription.unsubscribe();

      expect(events.activeStreamCount).toBe(0);
    });

    it('leaves nothing behind once the batch completes', () => {
      const events = new TestRenderBatchEventsService();

      const subscription = events.stream(BATCH_ID, summary()).subscribe();
      events.publishCompleted({ batchId: BATCH_ID, total: 3, succeeded: 3, failed: 0 });

      expect(events.activeStreamCount).toBe(0);
      expect(subscription.closed).toBe(true);
    });

    it('forgets a batch on demand, so a pruned batch stops being replayable', () => {
      const events = new TestRenderBatchEventsService();
      events.publishCompleted({ batchId: BATCH_ID, total: 3, succeeded: 3, failed: 0 });

      events.forget(BATCH_ID);

      const received: MessageEvent[] = [];
      const subscription = events
        .stream(BATCH_ID, summary())
        .subscribe({ next: (event) => received.push(event) });

      // Only the snapshot: the terminal record is gone, so there is nothing to replay
      // and the stream is left open for a batch that is still, as far as it knows, live.
      expect(received.map((event) => event.type)).toEqual(['progress']);

      subscription.unsubscribe();
    });

    it('keeps two batches apart', () => {
      const events = new TestRenderBatchEventsService();
      const otherBatchId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

      const first = jest.fn();
      const second = jest.fn();
      const a = events.stream(BATCH_ID, summary()).subscribe({ next: first });
      const b = events.stream(otherBatchId, summary({ batchId: otherBatchId })).subscribe({
        next: second,
      });

      events.publishProgress({
        batchId: BATCH_ID,
        total: 3,
        succeeded: 2,
        failed: 0,
        pending: 1,
        item: item(),
      });

      // One snapshot each, plus the live frame for the first batch only.
      expect(first).toHaveBeenCalledTimes(2);
      expect(second).toHaveBeenCalledTimes(1);

      a.unsubscribe();
      b.unsubscribe();
    });
  });
});

/**
 * §2.3 pass-through, asserted against the real controller and a real `Reflector`.
 *
 * The interceptor detects an SSE route from the metadata `@Sse()` sets. A test that
 * asserted on a hand-built metadata object would still pass if the decorator were
 * removed from the handler — and would still pass if the interceptor spelled the
 * metadata key wrong, which is exactly the defect this pair of tests caught. So this
 * reads the metadata off `AdminTryOnController.prototype.streamBatch` itself.
 */
describe('the batch stream is never wrapped in the §2.3 envelope', () => {
  function contextFor(handler: (...args: never[]) => unknown): ExecutionContext {
    return {
      getType: <T>(): T => 'http' as unknown as T,
      getHandler: () => handler,
      getClass: () => class AdminTryOnControllerStub {},
      switchToHttp: () => ({
        getRequest: <T>(): T =>
          ({ originalUrl: '/api/v1/admin/tryon', headers: {} }) as unknown as T,
        getResponse: <T>(): T => ({ statusCode: 200 }) as unknown as T,
      }),
    } as unknown as ExecutionContext;
  }

  function handlerFor<T>(value: T): CallHandler<T> {
    return { handle: (): Observable<T> => of(value) };
  }

  it('returns the handler observable untouched for the @Sse() batch route', async () => {
    const interceptor = new ResponseTransformInterceptor(new Reflector());
    const frame: MessageEvent = { type: 'progress', id: BATCH_ID, data: { batchId: BATCH_ID } };

    const emitted = await firstValueFrom(
      interceptor.intercept(
        contextFor(AdminTryOnController.prototype.streamBatch),
        handlerFor(frame),
      ),
    );

    // Identity, not merely shape: nothing was re-wrapped, re-created or annotated.
    expect(emitted).toBe(frame);
  });

  it('the same interceptor *does* envelope the poll route beside it, so the check is real', async () => {
    const interceptor = new ResponseTransformInterceptor(new Reflector());

    const emitted = (await firstValueFrom(
      interceptor.intercept(
        contextFor(AdminTryOnController.prototype.batch),
        handlerFor(summary()),
      ),
    )) as { success?: boolean; data?: unknown };

    expect(emitted.success).toBe(true);
    expect(emitted.data).toEqual(summary());
  });
});
