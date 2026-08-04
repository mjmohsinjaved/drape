import { Readable } from 'node:stream';

import {
  Injectable,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { map, type Observable } from 'rxjs';

import {
  DEFAULT_RESPONSE_MESSAGE,
  RESPONSE_MESSAGE_KEY,
} from '../decorators/response-message.decorator';
import { isEnveloped, type ApiResponse } from '../interfaces/api-response.interface';
import { isPaginated } from '../interfaces/pagination.interface';
import { RequestContext } from '../logger/request-context';

/**
 * The metadata key `@Sse()` sets. NestJS exports it from a deep internal path
 * (`@nestjs/common/constants`), which the import rules discourage, so the literal
 * is pinned here with a name instead of being spelled inline.
 */
const NEST_SSE_METADATA = 'sse';

/** Response content types that must never be wrapped. */
const PASS_THROUGH_CONTENT_TYPES = ['text/event-stream', 'application/octet-stream'];

interface TransformableRequest {
  originalUrl?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
}

interface TransformableResponse {
  statusCode?: number;
  getHeader?(name: string): number | string | string[] | undefined;
}

/**
 * The success envelope — ARCHITECTURE.md §2.3.
 *
 * Wraps a handler's return value in `{ success, statusCode, message, data, meta?,
 * timestamp, path, requestId }`, honours `@ResponseMessage()`, and lifts `meta` out
 * of a service's `{ items, meta }` return value onto the envelope.
 *
 * ### Pass-through
 *
 * Four cases are returned untouched, because wrapping them would corrupt the
 * response body:
 *
 * 1. **SSE** — `GET /api/v1/tryon/jobs/:id/stream`. Detected from the `@Sse()`
 *    metadata and from a `text/event-stream` content type.
 * 2. **File and binary streams** — `GET /api/v1/files/:token`. `StreamableFile`,
 *    `Readable` and `Buffer` all pass.
 * 3. **Already enveloped** — anything with a `success` property (§2.3).
 * 4. **`204 No Content`** — there is no body to wrap.
 */
@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<T, unknown> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<unknown> {
    if (context.getType<string>() !== 'http') {
      return next.handle();
    }

    if (this.isSseRoute(context)) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<TransformableRequest>();
    const response = context.switchToHttp().getResponse<TransformableResponse>();

    const message =
      this.reflector.getAllAndOverride<string | undefined>(RESPONSE_MESSAGE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_RESPONSE_MESSAGE;

    return next.handle().pipe(
      map((data: T): unknown => {
        if (isPassThroughPayload(data) || isPassThroughResponse(response)) {
          return data;
        }

        const statusCode = response.statusCode ?? 200;
        if (statusCode === 204) {
          return data;
        }

        const envelope: ApiResponse<unknown> = {
          success: true,
          statusCode,
          message,
          data,
          timestamp: new Date().toISOString(),
          path: request.originalUrl ?? request.url ?? '',
          requestId: RequestContext.getTraceId() ?? readRequestIdHeader(request) ?? '',
        };

        if (isPaginated(data)) {
          envelope.data = data.items;
          envelope.meta = data.meta;
        }

        return envelope;
      }),
    );
  }

  private isSseRoute(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean | undefined>(NEST_SSE_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}

/** true when the handler produced something that must reach the client as-is. */
function isPassThroughPayload(data: unknown): boolean {
  if (data === undefined) {
    // A handler that returns nothing gets `{ …, data: undefined }`, which serialises
    // as an envelope with no `data` key — the correct shape for an accepted mutation.
    return false;
  }
  if (data instanceof StreamableFile || data instanceof Readable || Buffer.isBuffer(data)) {
    return true;
  }
  if (typeof data === 'object' && data !== null) {
    // Duck-typed stream check, for a Readable that crossed a realm boundary.
    const candidate = data as { pipe?: unknown; readable?: unknown };
    if (typeof candidate.pipe === 'function' && candidate.readable !== undefined) {
      return true;
    }
    if (isEnveloped(data)) {
      return true;
    }
  }
  return false;
}

/** true when the response has already committed to a non-JSON content type. */
function isPassThroughResponse(response: TransformableResponse): boolean {
  if (typeof response.getHeader !== 'function') {
    return false;
  }
  const header = response.getHeader('content-type');
  const contentType = Array.isArray(header) ? header[0] : header;
  if (typeof contentType !== 'string') {
    return false;
  }
  const lowered = contentType.toLowerCase();
  return PASS_THROUGH_CONTENT_TYPES.some((type) => lowered.includes(type));
}

function readRequestIdHeader(request: TransformableRequest): string | undefined {
  const value = request.headers?.['x-request-id'];
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === 'string' && single.length > 0 ? single : undefined;
}
