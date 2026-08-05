import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Body parsing — deliberately **JSON only**.
 *
 * Nest registers `express.json()` *and* `express.urlencoded({ extended: true })` by
 * default. The second one is what makes a cross-site request forgery cheap: a form
 * posted from an attacker's page with
 * `enctype="application/x-www-form-urlencoded"` is a **simple request** by the CORS
 * definition, so the browser sends it — cookies included — with no preflight, and
 * `enableCors()` never gets a vote. A DTO with two string fields is satisfied by two
 * hidden inputs.
 *
 * `application/json` cannot be produced by a plain `<form>`, so a cross-site JSON POST
 * is always preflighted and always stopped by the B-7 origin allow-list. Refusing to
 * parse urlencoded bodies therefore removes the forgeable transport altogether — a
 * defence in depth behind `CsrfGuard`, not a replacement for it.
 *
 * `main.ts` passes `bodyParser: false` to `NestFactory.create` and calls this instead.
 * The streaming upload route (`PUT /files/upload/:ticket`, §3.5 step 2) is unaffected:
 * it consumes `image/*` and `application/octet-stream`, which no body parser matches.
 */

/** Matches the §2.3 envelope sizes; file bytes never travel in a JSON body (§3.5). */
export const JSON_BODY_LIMIT = '1mb';

/**
 * Registers the one body parser the API accepts.
 *
 * Exported rather than inlined into `bootstrap()` so the property that matters — a
 * urlencoded body never reaches a handler — can be asserted by a test that boots a
 * real Nest application.
 */
export function registerBodyParsers(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
}
