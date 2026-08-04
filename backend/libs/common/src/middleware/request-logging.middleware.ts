import { Injectable, Optional, type NestMiddleware } from '@nestjs/common';

import { METRICS } from '../constants/metrics.constant';
import { RequestContext } from '../logger/request-context';
import { StructuredLoggerService } from '../logger/structured-logger.service';
import { MetricsService } from '../metrics/metrics.service';

/** Routes that would otherwise flood the log with health-check noise. */
const QUIET_PATHS: ReadonlySet<string> = new Set([
  '/api/v1/health',
  '/api/v1/health/live',
  '/api/v1/health/ready',
]);

interface LoggedRequest {
  method?: string;
  path?: string;
  originalUrl?: string;
  url?: string;
  route?: { path?: string };
}

interface LoggedResponse {
  statusCode?: number;
  on(event: string, listener: () => void): unknown;
}

/**
 * One structured line per completed request — PRD E-12, E-13.
 *
 * Registered **after** `RequestIdMiddleware`, so the line carries the trace id.
 * The path is logged without its query string and the body is never logged: a
 * request body can hold an email, a phone number or a photo key.
 */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger: StructuredLoggerService;

  constructor(
    @Optional() private readonly metrics?: MetricsService,
    @Optional() logger?: StructuredLoggerService,
  ) {
    this.logger = logger ?? new StructuredLoggerService({ context: 'Request' });
  }

  use(request: LoggedRequest, response: LoggedResponse, next: () => void): void {
    const startedAt = Date.now();
    const method = (request.method ?? 'GET').toUpperCase();
    const path = request.path ?? stripQuery(request.originalUrl ?? request.url ?? '');

    response.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const statusCode = response.statusCode ?? 0;
      // The Express route pattern, not the concrete path — keeps metric cardinality
      // bounded, since `/garments/:id` must not become one series per garment.
      const route = request.route?.path ?? path;

      this.metrics?.histogram(METRICS.HTTP_REQUEST_DURATION_MS, durationMs, {
        method,
        route,
        status: statusCode,
      });
      this.metrics?.increment(METRICS.HTTP_REQUESTS_TOTAL, {
        method,
        route,
        status: statusCode,
      });
      if (statusCode === 429) {
        this.metrics?.increment(METRICS.HTTP_RATE_LIMITED, { route });
      }

      if (QUIET_PATHS.has(path) && statusCode < 400) {
        return;
      }

      const meta = {
        statusCode,
        durationMs,
        userId: RequestContext.getUserId(),
      };
      const message = `${method} ${path} ${statusCode} ${durationMs}ms`;

      if (statusCode >= 500) {
        this.logger.error(message, meta);
      } else if (statusCode >= 400) {
        this.logger.warn(message, meta);
      } else {
        this.logger.log(message, meta);
      }
    });

    next();
  }
}

function stripQuery(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}
