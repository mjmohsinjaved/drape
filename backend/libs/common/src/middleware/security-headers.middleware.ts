import { Injectable, type NestMiddleware } from '@nestjs/common';

interface HeaderedResponse {
  setHeader(name: string, value: string): unknown;
  removeHeader(name: string): unknown;
}

interface SecureRequest {
  secure?: boolean;
}

/**
 * API response hardening.
 *
 * `helmet` is applied in `main.ts` and covers the browser-facing defaults. This
 * middleware adds the API-specific headers helmet leaves to the application and
 * pins the ones that matter for a JSON API serving a separate web origin:
 *
 * | Header | Why |
 * | --- | --- |
 * | `X-Content-Type-Options: nosniff` | An uploaded file must never be sniffed into a script. |
 * | `X-Frame-Options: DENY` | The API is never framed; a clickjacked JSON endpoint is still a CSRF surface. |
 * | `Content-Security-Policy` | `default-src 'none'` — an API response has no legitimate subresource. |
 * | `Referrer-Policy: no-referrer` | A signed file URL must never leak in a `Referer` (§3.4). |
 * | `Cross-Origin-Resource-Policy: same-site` | Stops a third-party page embedding a render. |
 * | `Permissions-Policy` | Denies camera, microphone and geolocation outright. |
 * | `Cache-Control: no-store` | Default for API JSON. `files` overrides it per §3.4. |
 * | `Strict-Transport-Security` | Only over TLS — never on a plain local request. |
 *
 * `X-Powered-By` is removed: it names the framework and version for free.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(request: SecureRequest, response: HeaderedResponse, next: () => void): void {
    response.removeHeader('X-Powered-By');

    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    response.setHeader('X-DNS-Prefetch-Control', 'off');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    );
    // Route handlers that legitimately cache — the signed-file reader (§3.4) —
    // overwrite this after the middleware chain has run.
    response.setHeader('Cache-Control', 'no-store');

    if (request.secure === true) {
      response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
  }
}
