'use client';

/**
 * SSE hook for the try-on job stream — PRD §8.2, ARCHITECTURE.md §5.11.
 *
 * `GET /tryon/jobs/:jobId/stream` is `text/event-stream` with **no envelope**, so it never goes
 * through axios. This hook owns the transport concerns that go with that:
 *
 * - **Reconnect with exponential backoff.** The native `EventSource` reconnects on its own and
 *   sends `Last-Event-ID`, so while it is still trying (`readyState === CONNECTING`) we let it —
 *   but we count the attempts, because otherwise a browser that retries forever means we never
 *   fall back. Once it gives up (`readyState === CLOSED`), or once its own attempts have used up
 *   `maxRetries`, we take over and back off rather than hammering.
 * - **A polling fallback.** §6.4: "try-on job status is driven by SSE, not polling, with a 3 s
 *   polling fallback when `EventSource` fails." The fallback also covers the case where
 *   `EventSource` does not exist at all — an old runtime, or a render on the server.
 * - **Full cleanup on unmount.** The connection is closed and every timer cleared, so a consumer
 *   who navigates away mid-generation leaves nothing behind. The job keeps running server-side and
 *   lands in her tray (C-19); the socket does not.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type EventSourceStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'polling'
  | 'closed';

export interface StreamEvent {
  /** The SSE `event:` name — `stage`, `succeeded`, `failed`, `heartbeat` (§5.11). */
  name: string;
  /** The parsed `data:` payload, or the raw string when it was not JSON. */
  data: unknown;
  lastEventId: string | null;
}

export interface UseEventSourceOptions {
  /** Absolute stream URL. `null` disables the hook — use it while the job id is unknown. */
  url: string | null;
  /** Named events to subscribe to. Anonymous `message` events are always delivered. */
  events?: readonly string[];
  enabled?: boolean;
  /** Sends the session cookie. Required for `/tryon/jobs/:jobId/stream`, which is CONSUMER-only. */
  withCredentials?: boolean;
  onEvent: (event: StreamEvent) => void;
  /**
   * Returns true for a terminal event (`succeeded`, `failed`). The hook then closes the stream and
   * stops reconnecting — §5.11 says the server closes after a terminal event, and reconnecting
   * would only replay it.
   */
  isTerminal?: (event: StreamEvent) => boolean;
  /** Reconnect attempts before falling back to polling. */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /**
   * The fallback. Called every `pollIntervalMs` once SSE is unavailable; resolve `true` when the
   * job has reached a terminal state and polling should stop. Wire it to
   * `GET /tryon/jobs/:jobId` — §5.11 calls that route "the SSE fallback".
   */
  poll?: () => Promise<boolean | void>;
  /** §6.4 — 3 s. */
  pollIntervalMs?: number;
  onStatusChange?: (status: EventSourceStatus) => void;
}

export interface UseEventSourceResult {
  status: EventSourceStatus;
  /** How many reconnect attempts this hook has made since the last successful open. */
  retryCount: number;
  lastEventId: string | null;
  /** Closes the stream and stops all polling. Idempotent. */
  close: () => void;
  /** Drops the current connection and reconnects immediately, resetting the backoff. */
  reconnect: () => void;
}

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;

function parseEventData(raw: string): unknown {
  if (raw === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // A heartbeat comment frame, or a server that sent plain text. Neither is an error.
    return raw;
  }
}

/**
 * Appends the last seen event id so a *fresh* `EventSource` can still be replayed from where it
 * left off. The browser only sends the `Last-Event-ID` header on its own internal reconnect, and
 * `EventSource` cannot carry custom headers — so when we recreate the connection ourselves, the
 * query parameter is the only channel available.
 */
function withLastEventId(url: string, lastEventId: string | null): string {
  if (lastEventId === null) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}lastEventId=${encodeURIComponent(lastEventId)}`;
}

export function useEventSource(options: UseEventSourceOptions): UseEventSourceResult {
  const {
    url,
    enabled = true,
    withCredentials = true,
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  } = options;

  const [status, setStatus] = useState<EventSourceStatus>('idle');
  const [retryCount, setRetryCount] = useState(0);
  const [lastEventId, setLastEventId] = useState<string | null>(null);

  // Handlers change on every render of the consuming component; holding them in a ref keeps the
  // connection effect from tearing down and rebuilding the socket each time.
  const handlersRef = useRef(options);
  handlersRef.current = options;

  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptRef = useRef(0);
  const lastEventIdRef = useRef<string | null>(null);
  const terminatedRef = useRef(false);
  /** Lets the reconnect timer call `connect` without `connect` depending on itself. */
  const connectRef = useRef<() => void>(() => undefined);

  const updateStatus = useCallback((next: EventSourceStatus) => {
    setStatus(next);
    handlersRef.current.onStatusChange?.(next);
  }, []);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const closeSource = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const close = useCallback(() => {
    terminatedRef.current = true;
    clearTimers();
    closeSource();
    updateStatus('closed');
  }, [clearTimers, closeSource, updateStatus]);

  /** The 3 s fallback. Runs only when SSE is unavailable or has exhausted its retries. */
  const startPolling = useCallback(() => {
    const { poll } = handlersRef.current;
    if (!poll || pollTimerRef.current !== null || terminatedRef.current) return;

    updateStatus('polling');

    const tick = () => {
      void Promise.resolve(handlersRef.current.poll?.())
        .then((done) => {
          if (done === true) close();
        })
        .catch(() => {
          // A failed poll is not fatal — the next tick tries again. The error has already been
          // normalised into an ApiError and surfaced by whatever query owns the poll call.
        });
    };

    tick();
    pollTimerRef.current = setInterval(tick, pollIntervalMs);
  }, [close, pollIntervalMs, updateStatus]);

  const connect = useCallback(() => {
    if (terminatedRef.current) return;
    if (url === null || !enabled) return;

    if (typeof EventSource === 'undefined') {
      // No SSE in this runtime (or we are on the server). Straight to the fallback.
      if (handlersRef.current.poll) {
        startPolling();
      } else {
        close();
      }
      return;
    }

    closeSource();
    updateStatus(attemptRef.current === 0 ? 'connecting' : 'reconnecting');

    const source = new EventSource(withLastEventId(url, lastEventIdRef.current), {
      withCredentials,
    });
    sourceRef.current = source;

    const deliver = (event: MessageEvent<string>, name: string) => {
      if (event.lastEventId) {
        lastEventIdRef.current = event.lastEventId;
        setLastEventId(event.lastEventId);
      }

      const payload: StreamEvent = {
        name,
        data: parseEventData(event.data),
        lastEventId: event.lastEventId || null,
      };

      handlersRef.current.onEvent(payload);

      if (handlersRef.current.isTerminal?.(payload) === true) {
        close();
      }
    };

    source.onopen = () => {
      attemptRef.current = 0;
      setRetryCount(0);
      updateStatus('open');
    };

    source.onmessage = (event: MessageEvent<string>) => {
      deliver(event, 'message');
    };

    for (const name of handlersRef.current.events ?? []) {
      source.addEventListener(name, (event) => {
        deliver(event as MessageEvent<string>, name);
      });
    }

    /** Out of reconnects: hand over to the §6.4 poll, or admit the stream is dead. */
    const giveUp = () => {
      closeSource();
      if (handlersRef.current.poll) {
        startPolling();
      } else {
        // Pretending otherwise would leave a spinner up forever.
        close();
      }
    };

    source.onerror = () => {
      if (terminatedRef.current) return;

      /*
        `CONNECTING` means the browser is retrying by itself and will send `Last-Event-ID` for us,
        so we leave the socket alone and let it — but we **count** the attempt.

        This used to return early without touching `attemptRef`, and that made the documented
        fallback unreachable for the commonest failure there is. Per the spec an ordinary
        transport drop — a server restart, a phone losing its radio — sets `readyState` back to
        `CONNECTING` *before* firing `error`; only a fatal non-2xx handshake reaches `CLOSED`. So
        a plain network drop looped here forever: status stuck on `reconnecting`, `isPolling`
        never true, and `GET /tryon/jobs/:jobId` never called. Counting these gives the browser
        `maxRetries` goes at its own reconnect and then takes over.
      */
      if (source.readyState === EventSource.CONNECTING) {
        attemptRef.current += 1;
        setRetryCount(attemptRef.current);

        if (attemptRef.current >= maxRetries) {
          giveUp();
          return;
        }

        updateStatus('reconnecting');
        return;
      }

      closeSource();

      if (attemptRef.current >= maxRetries) {
        giveUp();
        return;
      }

      const delay = Math.min(baseDelayMs * 2 ** attemptRef.current, maxDelayMs);
      attemptRef.current += 1;
      setRetryCount(attemptRef.current);
      updateStatus('reconnecting');

      reconnectTimerRef.current = setTimeout(() => {
        connectRef.current();
      }, delay);
    };
  }, [
    baseDelayMs,
    close,
    closeSource,
    enabled,
    maxDelayMs,
    maxRetries,
    startPolling,
    updateStatus,
    url,
    withCredentials,
  ]);

  const reconnect = useCallback(() => {
    terminatedRef.current = false;
    attemptRef.current = 0;
    setRetryCount(0);
    clearTimers();
    connect();
  }, [clearTimers, connect]);

  useEffect(() => {
    connectRef.current = connect;

    if (url === null || !enabled) {
      updateStatus('idle');
      return;
    }

    terminatedRef.current = false;
    attemptRef.current = 0;
    lastEventIdRef.current = null;
    connect();

    return () => {
      // Full cleanup: socket closed, reconnect timer cancelled, poll interval cleared.
      terminatedRef.current = true;
      clearTimers();
      closeSource();
    };
  }, [clearTimers, closeSource, connect, enabled, updateStatus, url]);

  return { status, retryCount, lastEventId, close, reconnect };
}
