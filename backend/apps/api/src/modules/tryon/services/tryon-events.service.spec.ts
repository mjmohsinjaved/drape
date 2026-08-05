import { firstValueFrom, lastValueFrom, toArray } from 'rxjs';

import { TryOnEventsService } from './tryon-events.service';

/**
 * The SSE bus — ARCHITECTURE §5.11, PRD §8.2, C-19.
 *
 * Three things are easy to get wrong in an SSE implementation and expensive when they
 * are: a stream that never closes, a subscription that leaks when the client walks
 * away, and a reconnect that hangs because the terminal event has already been sent.
 * One test each.
 */
describe('TryOnEventsService', () => {
  const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  function succeeded(): Parameters<TryOnEventsService['publishSucceeded']>[0] {
    return {
      jobId,
      resultId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      url: 'https://api.test/render',
      thumbnailUrl: null,
      width: 768,
      height: 1152,
      cacheHit: false,
    };
  }

  it('delivers stage events to a live subscriber (C-19 staged microcopy)', async () => {
    const events = new TryOnEventsService();
    const stream = events.stream(jobId);
    const collected = lastValueFrom(stream.pipe(toArray()));

    events.publishStage({ stage: 'UPLOADING', jobId, elapsedMs: 10 });
    events.publishStage({ stage: 'GENERATING', jobId, elapsedMs: 200 });
    events.publishSucceeded(succeeded());

    const received = await collected;
    expect(received.map((event) => event.type)).toEqual(['stage', 'stage', 'succeeded']);
  });

  it('closes the stream after a terminal event (§5.11)', async () => {
    const events = new TryOnEventsService();
    const completed = jest.fn();

    const subscription = events.stream(jobId).subscribe({ complete: completed });
    events.publishSucceeded(succeeded());

    expect(completed).toHaveBeenCalled();
    expect(subscription.closed).toBe(true);
  });

  it('closes on a failure event too, carrying the §8.3 consumer copy', async () => {
    const events = new TryOnEventsService();
    const stream = events.stream(jobId);
    const collected = lastValueFrom(stream.pipe(toArray()));

    events.publishFailed({
      jobId,
      errorCode: 'UPSTREAM_TIMEOUT',
      message: 'Taking longer than usual — hang tight.',
    });

    const received = await collected;
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: 'failed',
      data: { message: 'Taking longer than usual — hang tight.' },
    });
  });

  it('replays the terminal state to a client that reconnects after the job finished', async () => {
    const events = new TryOnEventsService();
    events.publishSucceeded(succeeded());

    // The client's connection dropped and it came back with Last-Event-ID. It must get
    // the answer, not an open stream that never emits.
    const replayed = await firstValueFrom(events.stream(jobId));

    expect(replayed.type).toBe('succeeded');
  });

  it('leaks nothing when a client disconnects mid-generation', () => {
    const events = new TryOnEventsService();

    const subscription = events.stream(jobId).subscribe();
    expect(events.activeStreamCount).toBe(1);

    // Nest unsubscribes on disconnect; the heartbeat interval goes with it, because it
    // is part of the merged observable rather than a timer this service owns.
    subscription.unsubscribe();

    expect(events.activeStreamCount).toBe(0);
  });

  it('publishing to nobody is not an error — a fast cache hit beats the client to it', () => {
    const events = new TryOnEventsService();

    expect(() => {
      events.publishStage({ stage: 'FINISHING', jobId, elapsedMs: 5 });
      events.publishSucceeded(succeeded());
    }).not.toThrow();
  });

  it('forgets a job on demand, so a pruned job stops being replayable', async () => {
    const events = new TryOnEventsService();
    events.publishSucceeded(succeeded());

    events.forget(jobId);

    const emitted = jest.fn();
    const subscription = events.stream(jobId).subscribe({ next: emitted });

    expect(emitted).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it('keeps the streams of two jobs apart', async () => {
    const events = new TryOnEventsService();
    const otherJobId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    const first = lastValueFrom(events.stream(jobId).pipe(toArray()));
    const secondEmitted = jest.fn();
    const second = events.stream(otherJobId).subscribe({ next: secondEmitted });

    events.publishSucceeded(succeeded());

    expect((await first).length).toBe(1);
    expect(secondEmitted).not.toHaveBeenCalled();
    second.unsubscribe();
  });
});
