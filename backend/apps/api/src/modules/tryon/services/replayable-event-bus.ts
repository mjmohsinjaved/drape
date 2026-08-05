import { type Logger, type MessageEvent } from '@nestjs/common';

import { Subject, interval, map, merge, takeWhile, type Observable } from 'rxjs';

/** A `MessageEvent` whose `type` is drawn from one bus's closed vocabulary. */
export type BusMessageEvent<TName extends string> = Omit<MessageEvent, 'type'> & {
  readonly type: TName;
};

export interface ReplayableEventBusOptions<TName extends string> {
  /**
   * Which events end a stream. **A parameter by design** — §5.11 gives the two buses different
   * terminal vocabularies (`succeeded`/`failed` for a job, `completed` for a batch) and they must
   * not be unified into one guess.
   */
  readonly isTerminal: (event: BusMessageEvent<TName>) => boolean;
  /**
   * How long a terminal event stays replayable. **Also a parameter by design**: a seven-second
   * try-on and a batch that runs for minutes have genuinely different reconnection windows.
   */
  readonly terminalRetentionMs: number;
  /** §5.11 — a heartbeat this often, so intermediaries do not close a quiet stream. */
  readonly heartbeatIntervalMs: number;
  /** The subclass's logger, so a closed stream is attributed to the bus that closed it. */
  readonly logger: Logger;
  /** What one stream is *of* — `'job'`, `'batch'` — used only in the debug line. */
  readonly subjectNoun: string;
}

interface TerminalRecord<TName extends string> {
  readonly event: BusMessageEvent<TName>;
  readonly at: number;
}

/**
 * **The SSE mechanism both §5.11 buses are made of.**
 *
 * `TryOnEventsService` and `TestRenderBatchEventsService` had this entire class each — `publish`,
 * `channelFor`, `replayableTerminal`, `sweepTerminals`, `forget`, the heartbeat interval, the
 * `takeWhile` completion and an identical `TerminalRecord` — method for method, about a hundred and
 * fifty lines of it. Two copies of a leak fix is one copy too many, and the copy that does not get
 * the fix is the one holding a thousand finished jobs in memory.
 *
 * What genuinely differs between the two is exactly two values, and they stay values: the terminal
 * predicate and the retention window. Everything a subclass adds on top — a batch's opening
 * snapshot, a job's replay-and-close — composes around {@link liveStream} rather than
 * reimplementing it.
 *
 * ### The three things that are easy to get wrong here
 *
 * **The envelope must not wrap it.** `ResponseTransformInterceptor` returns early for any handler
 * carrying Nest's `sse` metadata and for any response already committed to `text/event-stream`, so
 * an `@Sse()` route is never JSON-wrapped. The controller adds no `@ResponseMessage()` and returns
 * the raw observable.
 *
 * **A disconnect must not leak.** The stream is `merge(events, heartbeat)` piped through
 * `takeWhile(notTerminal, inclusive)`. When the client goes away Nest unsubscribes, which tears
 * down the heartbeat interval with it — no timer is owned by this class and no listener has to be
 * removed by hand. {@link activeStreamCount} exists so a test can assert exactly that.
 *
 * **A finished stream must still answer.** A client that reconnects after the terminal event gets
 * it replayed from retention-bounded memory rather than an open connection that never emits. Past
 * the window, the documented polling endpoint reads the row.
 */
export abstract class ReplayableEventBus<TName extends string> {
  private readonly channels = new Map<string, Subject<BusMessageEvent<TName>>>();

  private readonly terminals = new Map<string, TerminalRecord<TName>>();

  protected constructor(private readonly options: ReplayableEventBusOptions<TName>) {}

  /** Live subscriber count, for the leak test. */
  get activeStreamCount(): number {
    let total = 0;
    for (const subject of this.channels.values()) {
      total += subject.observed ? 1 : 0;
    }
    return total;
  }

  /** Drops a stream's channel and its replayable terminal. */
  forget(streamId: string): void {
    this.channels.get(streamId)?.complete();
    this.channels.delete(streamId);
    this.terminals.delete(streamId);
  }

  /**
   * Sends one event to whoever is listening, recording it first when it is terminal.
   *
   * Nobody listening is the normal case, not an error: a fast cache hit finishes before any
   * client opens a stream, and a batch is often queued from a tab that is then closed. The
   * terminal record is what a late subscriber reads.
   */
  protected publish(streamId: string, event: BusMessageEvent<TName>): void {
    const terminal = this.options.isTerminal(event);

    if (terminal) {
      this.sweepTerminals();
      this.terminals.set(streamId, { event, at: Date.now() });
    }

    const channel = this.channels.get(streamId);
    if (channel === undefined) {
      return;
    }

    channel.next(event);

    if (terminal) {
      channel.complete();
      this.channels.delete(streamId);
      this.options.logger.debug(`Closed the stream for a finished ${this.options.subjectNoun}.`);
    }
  }

  /**
   * The live half of a stream: this bus's events merged with the heartbeat, completing on the
   * terminal event.
   *
   * `inclusive` — emit the terminal event, *then* complete, which closes the connection (§5.11:
   * "the stream closes after a terminal event").
   */
  protected liveStream(streamId: string): Observable<BusMessageEvent<TName>> {
    const channel = this.channelFor(streamId);
    const heartbeat = interval(this.options.heartbeatIntervalMs).pipe(map(() => this.heartbeat()));

    return merge(channel.asObservable(), heartbeat).pipe(
      takeWhile((event) => !this.options.isTerminal(event), true),
    );
  }

  /** The terminal event still inside the retention window, or `null`. */
  protected replayableTerminal(streamId: string): BusMessageEvent<TName> | null {
    const record = this.terminals.get(streamId);
    if (record === undefined) {
      return null;
    }
    if (Date.now() - record.at > this.options.terminalRetentionMs) {
      this.terminals.delete(streamId);
      return null;
    }
    return record.event;
  }

  /** The `heartbeat` frame. Subclasses name it in their own event union; the shape is fixed. */
  protected abstract heartbeat(): BusMessageEvent<TName>;

  private channelFor(streamId: string): Subject<BusMessageEvent<TName>> {
    const existing = this.channels.get(streamId);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Subject<BusMessageEvent<TName>>();
    this.channels.set(streamId, created);
    return created;
  }

  private sweepTerminals(): void {
    const cutoff = Date.now() - this.options.terminalRetentionMs;
    for (const [streamId, record] of this.terminals) {
      if (record.at < cutoff) {
        this.terminals.delete(streamId);
      }
    }
  }
}
