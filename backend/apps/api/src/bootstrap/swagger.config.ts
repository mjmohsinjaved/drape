import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';

import { SWAGGER_PATH, buildSwaggerConfig } from '@library/common';

import type { EnvironmentVariables } from '@api/config/env.validation';
import { NodeEnv } from '@api/config/env.validation';

export { SWAGGER_PATH };

/**
 * Mounts the interactive documentation at `/api/docs`.
 *
 * The document *metadata* — title, description, servers, security schemes and the
 * tag inventory — is built by `@library/common`'s `buildSwaggerConfig()`, so the
 * served docs and the `openapi.json` that `scripts/export-openapi.ts` writes are
 * byte-identical. That equality is what makes the B-4 contract check meaningful, so
 * this file supplies inputs and mounts the result; it never re-describes the API.
 *
 * The declared credentials are the two the API actually accepts: the httpOnly
 * session cookie (B-6) and its paired CSRF double-submit header (B-8). There is no
 * bearer token anywhere in Drape (§0: "no NextAuth, no JWT").
 */
export function setupSwagger(app: INestApplication, env: EnvironmentVariables): string {
  const document = SwaggerModule.createDocument(
    app,
    buildSwaggerConfig({
      version: '1.0',
      apiUrl: env.APP_API_URL,
      sessionCookieName: env.SESSION_COOKIE_NAME,
    }),
    { ignoreGlobalPrefix: false },
  );

  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    customSiteTitle: 'Drape API',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      withCredentials: true,
    },
  });

  return SWAGGER_PATH;
}

/**
 * Whether to mount the docs at all — **off unless `EXPOSE_API_DOCS` says otherwise**,
 * and never in production.
 *
 * `SwaggerModule.setup()` registers raw Express middleware. It is not a route handler,
 * so none of the four `APP_GUARD`s in §2.7 runs on it and `npm run check:guards`
 * cannot see it: whoever reaches the port reads the whole contract. Deriving this from
 * `NODE_ENV` alone — the previous rule — meant every non-production deployment,
 * staging included, published the entire API surface anonymously.
 *
 * Two conditions, both required:
 *
 * 1. `EXPOSE_API_DOCS` is explicitly true. Default false, so a deployment that never
 *    thought about it is closed.
 * 2. `NODE_ENV` is not `production`, unchanged and kept deliberately: nothing about
 *    the flag should make the production case reachable by a typo in an env file.
 *
 * **Any environment reachable over a network must put authentication in front of the
 * mount** — reverse-proxy basic auth, an IP allow-list, or a private network. The API
 * cannot do it, because the mount sits outside the guard chain by construction.
 */
export function shouldExposeSwagger(env: EnvironmentVariables): boolean {
  return env.EXPOSE_API_DOCS && env.NODE_ENV !== NodeEnv.PRODUCTION;
}
