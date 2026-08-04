import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

/**
 * Environment contract — ARCHITECTURE §7, the `web` rows.
 *
 * Validated at build time, so a missing variable fails the build rather than a request (E-2).
 * **No value here is a secret and none has a fallback default.** The web service holds no
 * TryOnCloud key, no database URL and no session secret (B-1, B-2, B-3) — anything that would
 * give this app a business decision or an upstream credential belongs in the API.
 */
export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /**
     * Server-side base for cookie-forwarded fetches from Server Components (B-9). Lets a
     * container reach the API over an internal name. Falls back to the public base URL.
     */
    API_INTERNAL_URL: z.string().url().optional(),
  },
  client: {
    NEXT_PUBLIC_API_BASE_URL: z.string().url(),
    NEXT_PUBLIC_SITE_URL: z.string().url(),
    NEXT_PUBLIC_APP_ENV: z.enum(['development', 'staging', 'production']),
    NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(['en', 'ur']).default('en'),
    NEXT_PUBLIC_ENABLE_QUERY_DEVTOOLS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    API_INTERNAL_URL: process.env.API_INTERNAL_URL,
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
    NEXT_PUBLIC_ENABLE_QUERY_DEVTOOLS: process.env.NEXT_PUBLIC_ENABLE_QUERY_DEVTOOLS,
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === 'true',
});

/** The base URL a Server Component should use. Never reaches the browser bundle. */
export function serverApiBaseUrl(): string {
  return env.API_INTERNAL_URL ?? env.NEXT_PUBLIC_API_BASE_URL;
}

export const isProductionEnv = env.NEXT_PUBLIC_APP_ENV === 'production';
