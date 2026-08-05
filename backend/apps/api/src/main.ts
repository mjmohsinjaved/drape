import 'reflect-metadata';

import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { CustomValidationPipe, StructuredLoggerService } from '@library/common';

import { ApiModule } from '@api/api.module';
import { registerBodyParsers } from '@api/bootstrap/body-parser.config';
import { buildCorsOptions } from '@api/bootstrap/cors.config';
import { registerGracefulShutdown } from '@api/bootstrap/graceful-shutdown';
import { SWAGGER_PATH, setupSwagger, shouldExposeSwagger } from '@api/bootstrap/swagger.config';
import { validateRequiredEnvVars } from '@api/bootstrap/validate-env';
import type { EnvironmentVariables } from '@api/config/env.validation';

export const GLOBAL_PREFIX = 'api';
export const API_VERSION = '1';

/** Host and database name only — the connection string carries a password (E-12). */
function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return '(unparseable)';
  }
}

/**
 * The resolved runtime configuration, printed once at startup (E-1).
 * **Names and non-secret values only** — no connection strings, no keys, no
 * passwords, no token secrets.
 */
function describeEnvironment(env: EnvironmentVariables, url: string): string[] {
  return [
    `environment    ${env.NODE_ENV}`,
    `listening      ${url}`,
    `base path      /${GLOBAL_PREFIX}/v${API_VERSION}`,
    `log level      ${env.LOG_LEVEL}`,
    `database       ${describeDatabase(env.DATABASE_URL)} (ssl=${env.DATABASE_SSL}, pool=${env.DATABASE_POOL_MIN}-${env.DATABASE_POOL_MAX})`,
    `storage        driver=${env.STORAGE_DRIVER} root=${env.STORAGE_ROOT}`,
    `try-on         driver=${env.TRYON_DRIVER} apiVersion=${env.TRYON_API_VERSION} maxAttempts=${env.TRYON_MAX_ATTEMPTS}`,
    `notifications  email=${env.EMAIL_DRIVER} sms=${env.SMS_DRIVER}`,
    `cors           ${env.CORS_ORIGINS.join(', ')}`,
    `throttle       ${env.THROTTLE_LIMIT} req / ${env.THROTTLE_TTL_SECONDS}s`,
    `timezone       ${env.TIMEZONE}`,
  ];
}

async function bootstrap(): Promise<void> {
  // 1. Environment first. A missing variable fails here, never on a request (§7).
  const env = validateRequiredEnvVars();

  const app = await NestFactory.create<NestExpressApplication>(ApiModule, {
    bufferLogs: true,
    // CORS is configured explicitly below; never by the framework default.
    cors: false,
    // Nest's default pair includes `express.urlencoded()`, which is the transport a
    // cross-site auto-submitting form uses because it needs no preflight. Body parsing
    // is registered explicitly below — JSON only. See `body-parser.config.ts`.
    bodyParser: false,
  });

  // 1a. The one body parser the API accepts.
  registerBodyParsers(app);

  // 2. Structured logging (E-12). Buffered records are flushed into it.
  app.useLogger(app.get(StructuredLoggerService));

  // 3. Correct client IPs behind a reverse proxy — the throttler and auth_attempts
  //    both key on request.ip.
  app.set('trust proxy', env.TRUST_PROXY);

  const exposeSwagger = shouldExposeSwagger(env);

  // 4. Transport hardening.
  app.use(
    helmet({
      // Swagger UI needs inline scripts; the API itself serves no HTML.
      contentSecurityPolicy: exposeSwagger ? false : undefined,
      crossOriginEmbedderPolicy: false,
      // The web app runs on a different origin and loads signed file URLs from here.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  // 5. Routing surface: /api/v1/**  (§5).
  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });

  // 6. Input contract: whitelist, forbidNonWhitelisted, transform. The pipe fixes
  //    those options itself so every route validates identically — unknown
  //    properties are rejected, never silently dropped.
  app.useGlobalPipes(new CustomValidationPipe());

  // 7. CORS: the configured web origins only, credentials on, never '*' (B-7).
  app.enableCors(buildCorsOptions(env));

  // 8. Documentation.
  if (exposeSwagger) {
    setupSwagger(app, env);
  }

  // 9. Lifecycle: Nest hooks plus process-level draining.
  app.enableShutdownHooks();
  registerGracefulShutdown(app);

  await app.listen(env.API_PORT);

  const logger = new Logger('Bootstrap');
  const url = await app.getUrl();
  for (const line of describeEnvironment(env, url)) {
    logger.log(line);
  }
  if (exposeSwagger) {
    logger.log(`docs           ${url}/${SWAGGER_PATH}`);
  }
}

void bootstrap();
