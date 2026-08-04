import { DocumentBuilder, type OpenAPIObject } from '@nestjs/swagger';

/** Where the interactive docs are mounted. */
export const SWAGGER_PATH = 'api/docs';

/** Where `scripts/export-openapi.ts` writes the contract the web app checks (B-4). */
export const OPENAPI_EXPORT_PATH = 'openapi.json';

/** The API tag inventory. One `@ApiTags` per controller, drawn from this list. */
export const SWAGGER_TAGS = [
  { name: 'Health', description: 'Liveness and readiness.' },
  { name: 'Auth', description: 'Sessions, two-factor, verification, password reset.' },
  { name: 'Users', description: 'Account profile and preferences.' },
  { name: 'Invites', description: 'Admin invitations (S-5).' },
  { name: 'Settings', description: 'Platform settings (A-28 … A-30).' },
  { name: 'Consents', description: 'Photo-use consent and policy versions (C-12).' },
  { name: 'Categories', description: 'Catalog taxonomy.' },
  { name: 'Garments', description: 'Admin catalog management.' },
  { name: 'Catalog', description: 'Public read-only catalog projection.' },
  { name: 'Person Photos', description: 'Consumer photo library (C-14 … C-16).' },
  { name: 'Try-On', description: 'Generation, jobs and the SSE stream.' },
  { name: 'Results', description: 'Renders, verdicts and downloads.' },
  { name: 'Shortlist', description: 'Saved pieces.' },
  { name: 'Share', description: 'Share links and reactions.' },
  { name: 'Enquiries', description: 'Consumer enquiries and the admin pipeline.' },
  { name: 'Quota', description: 'Per-consumer monthly allowance (C-5).' },
  { name: 'Moderation', description: 'Blocked photos and review queue.' },
  { name: 'Analytics', description: 'Read-only admin aggregates.' },
  { name: 'Audit', description: 'Append-only action log (A-3).' },
  { name: 'Notifications', description: 'In-app notifications and the outbox.' },
  { name: 'Retention', description: 'Purge, deletion log and data export.' },
  { name: 'Files', description: 'Signed downloads and upload-ticket redemption.' },
] as const;

/** Inputs `buildSwaggerConfig` needs. Supplied by `apps/api` from validated env. */
export interface SwaggerConfigOptions {
  title?: string;
  description?: string;
  version?: string;
  /** `APP_API_URL`. Added as a server entry so the exported document is usable as-is. */
  apiUrl?: string;
  /** `SESSION_COOKIE_NAME`. Documents the cookie the client must carry. */
  sessionCookieName?: string;
}

const DEFAULT_DESCRIPTION = [
  'Drape — virtual fitting room API.',
  '',
  'Every `/api/v1/**` response uses the standard envelope (ARCHITECTURE.md §2.3):',
  'a success envelope with `data` (and `meta` for lists), or an error envelope with',
  '`errorCode` drawn from the closed `ErrorCode` set (§2.4). The only exceptions are',
  '`GET /api/v1/files/:token` (binary stream) and `GET /api/v1/tryon/jobs/:id/stream` (SSE).',
  '',
  'Authentication is a server-side session in an httpOnly `SameSite=Lax` cookie, with',
  'CSRF double-submit on every unsafe method. There is no bearer token.',
].join('\n');

/**
 * The shared OpenAPI document configuration.
 *
 * `apps/api/src/bootstrap/swagger.config.ts` calls this, then `SwaggerModule.createDocument`.
 * Keeping the builder here means `scripts/export-openapi.ts` produces byte-identical
 * metadata to the served docs, which is what makes the B-4 contract check meaningful.
 */
export function buildSwaggerConfig(
  options: SwaggerConfigOptions = {},
): Omit<OpenAPIObject, 'paths'> {
  const builder = new DocumentBuilder()
    .setTitle(options.title ?? 'Drape API')
    .setDescription(options.description ?? DEFAULT_DESCRIPTION)
    .setVersion(options.version ?? '1.0')
    .addCookieAuth(
      options.sessionCookieName ?? 'drape.sid',
      { type: 'apiKey', in: 'cookie', name: options.sessionCookieName ?? 'drape.sid' },
      'session',
    )
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token' }, 'csrf');

  if (options.apiUrl !== undefined && options.apiUrl.length > 0) {
    builder.addServer(options.apiUrl);
  }

  for (const tag of SWAGGER_TAGS) {
    builder.addTag(tag.name, tag.description);
  }

  return builder.build();
}
