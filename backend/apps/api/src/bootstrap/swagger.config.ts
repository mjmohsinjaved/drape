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
 * Production hides the docs. Everywhere else they are served, because a contract you
 * cannot read is a contract nobody checks.
 */
export function shouldExposeSwagger(env: EnvironmentVariables): boolean {
  return env.NODE_ENV !== NodeEnv.PRODUCTION;
}
