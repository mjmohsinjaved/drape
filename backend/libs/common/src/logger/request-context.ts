import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Per-request context carried through async boundaries — PRD E-12.
 *
 * `traceId` is the value echoed in the `X-Request-Id` response header, written to
 * `requestId` in every response envelope (§2.3) and stamped on every log line.
 * The three are always the same string; §2.3 names it `requestId` on the wire and
 * the logger names it `traceId` in the log record.
 *
 * Seeded by `RequestIdMiddleware`, which must be the **first** middleware registered
 * so that nothing downstream logs outside a context.
 */
export interface RequestContextStore {
  /** The request id. Same value as the `X-Request-Id` header and envelope `requestId`. */
  traceId: string;
  /** Set by `SessionAuthGuard` once the session resolves. Absent for anonymous callers. */
  userId?: string;
  method?: string;
  /** Path only — never the query string, which can carry personal data (E-12). */
  path?: string;
  /** `Date.now()` at request start, for `durationMs`. */
  startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/**
 * AsyncLocalStorage-backed request context.
 *
 * Static-only by design: injecting it would make every logging call site depend on
 * Nest's DI graph, and the structured logger has to work during bootstrap, before
 * the injector exists.
 */
export const RequestContext = {
  /** Runs `callback` inside a fresh context. */
  run<T>(store: RequestContextStore, callback: () => T): T {
    return storage.run(store, callback);
  },

  /**
   * Runs `callback` inside a fresh context built from `traceId`.
   * Generates a v4 id when none is supplied.
   */
  runWithTraceId<T>(traceId: string | undefined, callback: () => T): T {
    return storage.run({ traceId: traceId ?? randomUUID(), startedAt: Date.now() }, callback);
  },

  /** The active store, or `undefined` outside a request (cron jobs, bootstrap). */
  get(): RequestContextStore | undefined {
    return storage.getStore();
  },

  /** The active trace id, or `undefined` outside a request. */
  getTraceId(): string | undefined {
    return storage.getStore()?.traceId;
  },

  /** The active user id, or `undefined` when anonymous or outside a request. */
  getUserId(): string | undefined {
    return storage.getStore()?.userId;
  },

  /**
   * Attaches the resolved caller to the active context. Called by `SessionAuthGuard`.
   * A no-op outside a request rather than a throw — a guard must never fail because
   * of logging plumbing.
   */
  setUserId(userId: string): void {
    const store = storage.getStore();
    if (store !== undefined) {
      store.userId = userId;
    }
  },

  /** Records the route for log lines. Called by `RequestIdMiddleware`. */
  setRoute(method: string, path: string): void {
    const store = storage.getStore();
    if (store !== undefined) {
      store.method = method;
      store.path = path;
    }
  },

  /** Milliseconds since the request started, or `undefined` outside a request. */
  getDurationMs(): number | undefined {
    const store = storage.getStore();
    return store === undefined ? undefined : Date.now() - store.startedAt;
  },
} as const;

/** A fresh store. Exported so background processors can open their own context. */
export function createRequestContextStore(
  overrides: Partial<RequestContextStore> = {},
): RequestContextStore {
  return {
    traceId: overrides.traceId ?? randomUUID(),
    startedAt: overrides.startedAt ?? Date.now(),
    userId: overrides.userId,
    method: overrides.method,
    path: overrides.path,
  };
}
