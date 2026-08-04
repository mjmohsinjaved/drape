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
 * `script-src` carries `'unsafe-inline'` because the App Router emits inline bootstrap
 * and RSC-flight scripts. Tightening this to a per-request nonce requires generating the
 * nonce in `middleware.ts` and threading it through the document — deliberately deferred so
 * that exactly one component owns the header. Everything else is locked down:
 * no plugins, no framing, no base-tag hijack, forms may only post to our own origin.
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
