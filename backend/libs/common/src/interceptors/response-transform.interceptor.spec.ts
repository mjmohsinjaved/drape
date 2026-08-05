import { Readable } from 'node:stream';

import {
  Sse,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type MessageEvent,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { firstValueFrom, of, type Observable } from 'rxjs';

import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';
import { RequestContext } from '../logger/request-context';

import { ResponseTransformInterceptor } from './response-transform.interceptor';

import type { ApiResponse } from '../interfaces/api-response.interface';
import type { PaginationMeta } from '../interfaces/pagination.interface';

const TRACE_ID = '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c';

interface HarnessOptions {
  metadata?: Record<string, unknown>;
  statusCode?: number;
  contentType?: string;
  url?: string;
  contextType?: string;
}

function createReflector(metadata: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: jest.fn((key: string) => metadata[key]),
  } as unknown as Reflector;
}

function createContext(options: HarnessOptions = {}): ExecutionContext {
  const response = {
    statusCode: options.statusCode ?? 200,
    getHeader: (name: string): string | undefined =>
      name.toLowerCase() === 'content-type' ? options.contentType : undefined,
  };
  const request = {
    originalUrl: options.url ?? '/api/v1/catalog/garments',
    url: options.url ?? '/api/v1/catalog/garments',
    headers: {},
  };

  return {
    getType: <T>(): T => (options.contextType ?? 'http') as unknown as T,
    getHandler: () => function handler(): void {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: <T>(): T => request as unknown as T,
      getResponse: <T>(): T => response as unknown as T,
    }),
  } as unknown as ExecutionContext;
}

function createHandler<T>(value: T): CallHandler<T> {
  return { handle: (): Observable<T> => of(value) };
}

async function run<T>(value: T, options: HarnessOptions = {}): Promise<unknown> {
  const interceptor = new ResponseTransformInterceptor(createReflector(options.metadata ?? {}));
  return RequestContext.run({ traceId: TRACE_ID, startedAt: Date.now() }, async () =>
    firstValueFrom(interceptor.intercept(createContext(options), createHandler(value))),
  );
}

describe('ResponseTransformInterceptor — success envelope (§2.3)', () => {
  it('wraps a single resource', async () => {
    const result = (await run({ id: 'g1', title: 'Zarrin Bridal Lehenga' })) as ApiResponse<{
      id: string;
    }>;

    expect(result).toMatchObject({
      success: true,
      statusCode: 200,
      message: 'Success',
      data: { id: 'g1', title: 'Zarrin Bridal Lehenga' },
      path: '/api/v1/catalog/garments',
      requestId: TRACE_ID,
    });
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it('defaults the message to "Success"', async () => {
    const result = (await run({ id: 'g1' })) as ApiResponse<unknown>;
    expect(result.message).toBe('Success');
  });

  it('honours @ResponseMessage()', async () => {
    const result = (await run(
      { id: 'g1' },
      { metadata: { [RESPONSE_MESSAGE_KEY]: 'Garment retrieved successfully' } },
    )) as ApiResponse<unknown>;
    expect(result.message).toBe('Garment retrieved successfully');
  });

  it('takes statusCode from the response, so a 201 stays a 201', async () => {
    const result = (await run({ id: 'g1' }, { statusCode: 201 })) as ApiResponse<unknown>;
    expect(result.statusCode).toBe(201);
  });

  it('carries a null data payload rather than dropping the envelope', async () => {
    const result = (await run(null)) as ApiResponse<unknown>;
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });
});

describe('ResponseTransformInterceptor — pagination', () => {
  const meta: PaginationMeta = {
    page: 1,
    limit: 24,
    total: 137,
    totalPages: 6,
    sortBy: 'createdAt',
    sortOrder: 'DESC',
  };

  it('lifts meta onto the envelope and puts items in data', async () => {
    const result = (await run({ items: [{ id: 'a' }, { id: 'b' }], meta })) as ApiResponse<
      Array<{ id: string }>
    >;

    expect(result.data).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(result.meta).toEqual(meta);
  });

  it('omits meta for a non-paginated payload', async () => {
    const result = (await run({ id: 'g1' })) as ApiResponse<unknown>;
    expect(result.meta).toBeUndefined();
  });

  it('does not mistake a plain object with an items array for a page', async () => {
    const result = (await run({ items: [1, 2, 3] })) as ApiResponse<unknown>;
    expect(result.data).toEqual({ items: [1, 2, 3] });
    expect(result.meta).toBeUndefined();
  });
});

describe('ResponseTransformInterceptor — pass-through', () => {
  /**
   * Pinned against the **real** decorator and a **real** `Reflector`, not a hand-built
   * metadata bag.
   *
   * The interceptor has to spell Nest's `SSE_METADATA` key as a literal — it is only
   * exported from `@nestjs/common/constants`, a deep path the import rules discourage —
   * and a near-miss fails silently: `getAllAndOverride` returns `undefined`, the route is
   * not recognised, and every frame of a `text/event-stream` is wrapped in the §2.3
   * envelope. A test that supplied its own `{ sse: true }` would agree with whatever the
   * literal happened to say, which is how the key came to be wrong in the first place.
   */
  class SseFixtureController {
    @Sse('stream')
    stream(): Observable<MessageEvent> {
      return of({ data: { status: 'RUNNING' } });
    }

    poll(): { status: string } {
      return { status: 'RUNNING' };
    }
  }

  function contextFor(handler: (...args: never[]) => unknown): ExecutionContext {
    return {
      getType: <T>(): T => 'http' as unknown as T,
      getHandler: () => handler,
      getClass: () => SseFixtureController,
      switchToHttp: () => ({
        getRequest: <T>(): T => ({ originalUrl: '/api/v1/tryon', headers: {} }) as unknown as T,
        getResponse: <T>(): T => ({ statusCode: 200 }) as unknown as T,
      }),
    } as unknown as ExecutionContext;
  }

  async function runAgainst<T>(handler: (...args: never[]) => unknown, value: T): Promise<unknown> {
    const interceptor = new ResponseTransformInterceptor(new Reflector());
    return firstValueFrom(interceptor.intercept(contextFor(handler), createHandler(value)));
  }

  it('leaves an @Sse() route untouched, detected from the decorator’s own metadata', async () => {
    const event = { data: { status: 'RUNNING' } };

    expect(await runAgainst(SseFixtureController.prototype.stream, event)).toBe(event);
  });

  it('still envelopes the plain handler beside it, so the SSE check is not vacuous', async () => {
    const payload = { status: 'RUNNING' };

    const result = (await runAgainst(SseFixtureController.prototype.poll, payload)) as ApiResponse<
      typeof payload
    >;

    expect(result.success).toBe(true);
    expect(result.data).toEqual(payload);
  });

  it('leaves a response already committed to text/event-stream untouched', async () => {
    const event = { data: { status: 'RUNNING' } };
    const result = await run(event, { contentType: 'text/event-stream' });
    expect(result).toBe(event);
  });

  it('leaves a StreamableFile untouched — GET /api/v1/files/:token', async () => {
    const file = new StreamableFile(Buffer.from('binary'));
    expect(await run(file)).toBe(file);
  });

  it('leaves a Readable stream untouched', async () => {
    const stream = Readable.from(['chunk']);
    expect(await run(stream)).toBe(stream);
  });

  it('leaves a Buffer untouched', async () => {
    const buffer = Buffer.from('binary');
    expect(await run(buffer)).toBe(buffer);
  });

  it('leaves an application/octet-stream response untouched', async () => {
    const payload = { anything: true };
    expect(await run(payload, { contentType: 'application/octet-stream' })).toBe(payload);
  });

  it('does not double-wrap something that is already an envelope', async () => {
    const enveloped = {
      success: true,
      statusCode: 200,
      message: 'Already wrapped',
      data: { id: 'g1' },
      timestamp: '2026-08-05T09:14:22.113Z',
      path: '/api/v1/x',
      requestId: TRACE_ID,
    };
    expect(await run(enveloped)).toBe(enveloped);
  });

  it('does not wrap an error envelope produced by a handler', async () => {
    const errorEnvelope = { success: false, statusCode: 409, errorCode: 'RESOURCE_CONFLICT' };
    expect(await run(errorEnvelope)).toBe(errorEnvelope);
  });

  it('leaves a 204 No Content body alone', async () => {
    expect(await run(undefined, { statusCode: 204 })).toBeUndefined();
  });

  it('leaves a non-HTTP context alone', async () => {
    const payload = { id: 'g1' };
    expect(await run(payload, { contextType: 'rpc' })).toBe(payload);
  });
});

describe('ResponseTransformInterceptor — request id', () => {
  it('falls back to the X-Request-Id header outside a RequestContext', async () => {
    const interceptor = new ResponseTransformInterceptor(createReflector({}));
    const context = createContext();
    // Overwrite the request headers on the harness for this case only.
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    request.headers['x-request-id'] = 'header-supplied-id';

    const result = (await firstValueFrom(
      interceptor.intercept(context, createHandler({ id: 'g1' })),
    )) as ApiResponse<unknown>;

    expect(result.requestId).toBe('header-supplied-id');
  });
});
