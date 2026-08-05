import createNextIntlPlugin from 'next-intl/plugin';

import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Every internal workspace package is source-first (no build step), so Next has to
 * transpile each one. ARCHITECTURE §1.2: "apps/web/next.config.ts must list every
 * internal package in transpilePackages."
 *
 * `@repo/config-eslint` and `@repo/config-typescript` are tooling-only — they are never
 * imported by application code and therefore never enter a bundle.
 */
const INTERNAL_PACKAGES = [
  '@repo/ui',
  '@repo/api-client',
  '@repo/store',
  '@repo/utils',
  '@repo/config-tailwind',
];

/**
 * The API lives on a sibling origin (B-6: `app.example.com` / `api.example.com`), so the
 * browser talks to it directly (B-9 — there is no proxy layer in the web service). Both
 * `connect-src` and `img-src` therefore have to name it explicitly.
 */
function apiOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';
  try {
    return new URL(raw).origin;
  } catch {
    return 'http://localhost:4000';
  }
}

const API_ORIGIN = apiOrigin();

/**
 * Content-Security-Policy.
 *
 * ### `script-src 'unsafe-inline'` — why it is still here
 *
 * Stated plainly, because a CSP that looks strict and is not is worse than one that is
 * honest: **this policy does not stop injected script.** `'unsafe-inline'` is present
 * because the App Router emits inline bootstrap and RSC-flight scripts, and `@repo/ui`'s
 * `ThemeScript` emits a third to set the mode class before first paint.
 *
 * The supported alternative is a per-request nonce: `middleware.ts` generates one, sets
 * `script-src 'nonce-…' 'strict-dynamic'` on the *request* headers, and Next stamps it onto
 * its own inline scripts. It was not taken here, and the reason is not effort:
 *
 *  - `'strict-dynamic'` discards `'self'`, so *every* script must carry the nonce. A page
 *    that renders without the middleware having run — anything statically prerendered —
 *    silently ships scripts the browser then refuses, and the failure is a blank page in
 *    production, not a failing test. This app prerenders the public catalog.
 *  - The middleware matcher deliberately excludes `/_next` and any path with a file
 *    extension, so moving the header there would drop the *whole* CSP from build output
 *    and static assets. Two places would then own one policy.
 *  - It cannot be verified in this environment: there is no live API and no browser, so a
 *    broken nonce chain would be discovered by a user, not by the gates.
 *
 * Taking it on means: nonce in the middleware, `ThemeScript` accepting a nonce prop, the
 * public routes moved to dynamic rendering (or `next.config` keeping a separate policy for
 * static output), and a smoke test that loads a rendered page and asserts zero CSP
 * violations. Until then the mitigation is that the app contains **no HTML or script
 * sink** for an injected string to reach — `src/lib/html-sinks.test.ts` enforces that, and
 * it is the check actually holding the line here.
 *
 * Everything else is locked down: no plugins, no framing, no base-tag hijack, forms may
 * only post to our own origin, and `object-src`/`frame-src` are `'none'`.
 */
const contentSecurityPolicy = [
  `default-src 'self'`,
  `base-uri 'self'`,
  `object-src 'none'`,
  `frame-ancestors 'none'`,
  `form-action 'self'`,
  `img-src 'self' data: blob: ${API_ORIGIN}`,
  `media-src 'self' blob:`,
  // next/font self-hosts the Google faces at build time, so no third-party font origin.
  `font-src 'self' data:`,
  `style-src 'self' 'unsafe-inline'`,
  isProduction ? `script-src 'self' 'unsafe-inline'` : `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
  isProduction
    ? `connect-src 'self' ${API_ORIGIN}`
    : `connect-src 'self' ${API_ORIGIN} ws: wss:`,
  `worker-src 'self' blob:`,
  `manifest-src 'self'`,
  `frame-src 'none'`,
  ...(isProduction ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  // The fitting room is never embedded. S-9 and B-7 both assume a single first-party origin.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    // `camera=(self)` only, so C-14 can offer "take a photo" on a phone. Everything else off.
    value:
      'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: INTERNAL_PACKAGES,

  images: {
    // Renders and catalog images are served by the API behind signed, expiring URLs (§3.4),
    // never from a public bucket. Only the API origin is allowed.
    remotePatterns: [
      {
        protocol: API_ORIGIN.startsWith('https') ? 'https' : 'http',
        hostname: new URL(API_ORIGIN).hostname,
        port: new URL(API_ORIGIN).port || undefined,
        pathname: '/**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    // 360 px is the floor (D-9); the widths above match the consumer grid and the render viewer.
    deviceSizes: [360, 480, 640, 768, 1024, 1200, 1440, 1920],
    imageSizes: [40, 64, 96, 128, 160, 256, 384],
    minimumCacheTTL: 300,
    dangerouslyAllowSVG: false,
  },

  experimental: {
    // Keeps the RSC payload small on the image-led consumer grid.
    optimizePackageImports: ['lucide-react', '@repo/ui'],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
