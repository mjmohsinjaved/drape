import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { VersioningType, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

import { buildSwaggerConfig, OPENAPI_EXPORT_PATH } from '@library/common';

import { ApiModule } from '@api/api.module';

import { loadEnvFile } from './load-env';

/**
 * `npm run openapi:generate` (alias `openapi:export`) — PRD B-4 / E-16.
 *
 * Writes `backend/openapi.json` from the NestJS decorator metadata. The web app generates
 * its typed client from that file and CI diffs it, so an undeclared contract change fails
 * the build instead of production.
 *
 * Three decisions worth knowing about:
 *
 *  - **The metadata comes from `buildSwaggerConfig()` in `@library/common`**, which is the
 *    same function `apps/api/src/bootstrap/swagger.config.ts` calls to serve `/api/docs`.
 *    The exported contract and the served docs are therefore byte-identical by construction,
 *    which is the only reason diffing one tells you anything about the other.
 *  - **Preview mode.** `NestFactory.create(..., { preview: true })` builds the module graph
 *    and registers controllers without instantiating providers — no database connection, no
 *    storage root, no SMTP, no cron. That is what lets this run in a contract-check CI job
 *    and on a developer machine with no local Postgres. If it ever yields an empty document
 *    the script says so and retries with a full boot, rather than writing a silently
 *    truncated contract.
 *  - **Sorted keys.** Key order out of the Swagger scanner follows module import order.
 *    Sorting recursively means a real contract change is the only thing that shows in a diff.
 *
 * Usage:
 *   ts-node -r tsconfig-paths/register scripts/export-openapi.ts            # write
 *   ts-node -r tsconfig-paths/register scripts/export-openapi.ts --check    # verify only
 *   ts-node -r tsconfig-paths/register scripts/export-openapi.ts --boot     # force full boot
 */

const BACKEND_ROOT = resolve(__dirname, '..');
const OUTPUT_PATH = resolve(BACKEND_ROOT, OPENAPI_EXPORT_PATH);

/**
 * Mirrors `GLOBAL_PREFIX` / `API_VERSION` in `apps/api/src/main.ts` (§5: base path
 * `/api/v1`, URI versioning).
 *
 * Copied rather than imported: `main.ts` ends with a bare `void bootstrap()`, so importing
 * it would start an HTTP listener as a side effect of running this script.
 */
const GLOBAL_PREFIX = 'api';
const API_VERSION = '1';

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function createApp(preview: boolean): Promise<INestApplication> {
  const app = await NestFactory.create(ApiModule, {
    logger: ['error'],
    abortOnError: false,
    preview,
  });

  // Applied here as well as in main.ts so the exported paths are the real ones — otherwise
  // the generated client would target `/garments` instead of `/api/v1/garments`.
  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });

  return app;
}

/**
 * Document metadata.
 *
 * `apiUrl` and `sessionCookieName` are read from the environment when present, but fall back
 * to the documented §7 examples: the exported contract must not differ between a developer's
 * machine and CI just because one of them has a `.env`. Anything genuinely
 * environment-specific — a real host name, a build timestamp — would defeat the diff.
 */
function documentConfig(): Omit<OpenAPIObject, 'paths'> {
  return buildSwaggerConfig({
    version: '1.0',
    apiUrl: process.env.APP_API_URL ?? 'http://localhost:4000',
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'drape.sid',
  });
}

async function documentFrom(preview: boolean): Promise<OpenAPIObject> {
  const app = await createApp(preview);
  try {
    return SwaggerModule.createDocument(app, documentConfig(), { ignoreGlobalPrefix: false });
  } finally {
    await app.close();
  }
}

async function buildDocument(forceBoot: boolean): Promise<OpenAPIObject> {
  if (forceBoot) {
    return documentFrom(false);
  }

  const document = await documentFrom(true);
  if (Object.keys(document.paths).length > 0) {
    return document;
  }

  write('Preview mode produced no paths — retrying with a full application boot.');
  write('(A full boot connects to the database and initialises storage.)');
  return documentFrom(false);
}

/** Recursively sorts object keys so the serialised document is byte-stable across runs. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeysDeep(source[key]);
    }
    return sorted;
  }
  return value;
}

function serialise(document: OpenAPIObject): string {
  return `${JSON.stringify(sortKeysDeep(document), null, 2)}\n`;
}

function countOperations(document: OpenAPIObject): number {
  return Object.values(document.paths).reduce<number>(
    (total, item) => total + Object.keys(item).length,
    0,
  );
}

export async function exportOpenApi(): Promise<void> {
  loadEnvFile();

  const checkOnly = process.argv.includes('--check');
  const document = await buildDocument(process.argv.includes('--boot'));
  const serialised = serialise(document);

  if (checkOnly) {
    if (!existsSync(OUTPUT_PATH)) {
      throw new Error(
        `${OUTPUT_PATH} does not exist. Run \`npm run openapi:generate\` and commit the result ` +
          'so the contract can be diffed (B-4).',
      );
    }
    if (readFileSync(OUTPUT_PATH, 'utf8') !== serialised) {
      throw new Error(
        'openapi.json is out of date with the NestJS decorators. The API surface changed without ' +
          'the contract being regenerated. Run `npm run openapi:generate` and review the diff — a ' +
          'change here is a change the web client must be regenerated against (B-4, E-16).',
      );
    }
    write(
      `openapi.json is up to date — ${Object.keys(document.paths).length} paths, ` +
        `${countOperations(document)} operations.`,
    );
    return;
  }

  writeFileSync(OUTPUT_PATH, serialised, 'utf8');
  write(`Wrote ${OUTPUT_PATH}`);
  write(`  paths       ${Object.keys(document.paths).length}`);
  write(`  operations  ${countOperations(document)}`);
  write(`  schemas     ${Object.keys(document.components?.schemas ?? {}).length}`);
}

if (require.main === module) {
  void exportOpenApi().catch((error: unknown) => {
    process.stderr.write(
      `\nexport-openapi: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
