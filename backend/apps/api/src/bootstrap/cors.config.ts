import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

import type { EnvironmentVariables } from '@api/config/env.validation';

/**
 * ARCHITECTURE §7 / B-7 — CORS is an explicit allow-list of the configured web
 * origins.
 *
 * The origin is an **array**, never `'*'` and never a reflecting callback: the cors
 * middleware echoes back only an origin that appears in this list, and omits the
 * header entirely for anything else, in every environment. `credentials` is always
 * true because the session travels in an httpOnly cookie (B-6) — and `credentials`
 * with a wildcard origin is rejected by browsers anyway, which is one more reason
 * the wildcard can never creep in.
 *
 * `validateEnv()` has already rejected a `CORS_ORIGINS` containing `*`, so this
 * function only has to normalise.
 */
export function buildCorsOptions(env: EnvironmentVariables): CorsOptions {
  const origins = env.CORS_ORIGINS.map((origin) => origin.replace(/\/+$/, ''));

  return {
    origin: origins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Accept-Language',
      'X-CSRF-Token',
      'X-Request-Id',
      'Idempotency-Key',
    ],
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'Content-Disposition'],
    maxAge: 600,
    optionsSuccessStatus: 204,
  };
}
