import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';

import { RequestContext, createRequestContextStore } from '../logger/request-context';

/** The inbound and outbound request-id header (§2.3). */
export const REQUEST_ID_HEADER = 'X-Request-Id';

const REQUEST_ID_HEADER_LOWER = 'x-request-id';

/**
 * An accepted client-supplied id: uuid-ish, printable, bounded.
 *
 * The header is echoed into the response and into every log line, so an unbounded
 * or control-character-bearing value would be a log-injection vector. Anything that
 * does not match is discarded and replaced with a fresh v4 uuid.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

interface IdentifiableRequest {
  method?: string;
  path?: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface IdentifiableResponse {
  setHeader(name: string, value: string): unknown;
}

/**
 * Seeds the request context — PRD E-12.
 *
 * **Must be the first middleware registered.** It reads or mints the request id,
 * echoes it as `X-Request-Id`, and runs the remainder of the request inside a
 * `RequestContext`, so every log line, every response envelope and the
 * `X-Request-Id` header all carry the same value.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: IdentifiableRequest, response: IdentifiableResponse, next: () => void): void {
    const traceId = readIncomingId(request) ?? randomUUID();

    response.setHeader(REQUEST_ID_HEADER, traceId);

    const store = createRequestContextStore({
      traceId,
      method: (request.method ?? 'GET').toUpperCase(),
      // Path only — a query string can carry personal data (E-12).
      path: request.path ?? stripQuery(request.originalUrl ?? request.url ?? ''),
    });

    RequestContext.run(store, next);
  }
}

function readIncomingId(request: IdentifiableRequest): string | undefined {
  const value = request.headers[REQUEST_ID_HEADER_LOWER];
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === 'string' && SAFE_REQUEST_ID.test(single) ? single : undefined;
}

function stripQuery(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}
