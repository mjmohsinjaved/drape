import { NextResponse ,type  NextRequest } from 'next/server';

import createIntlMiddleware from 'next-intl/middleware';

import { routing } from '@/i18n/routing';
import { RETURN_TO_PARAM, Role } from '@/lib/constants';
import { apiPaths, isAuthOnlyPath, isProtectedPath, routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

/* ═══════════════════════════════════════════════════════════════════════════════════════
 *  THIS MIDDLEWARE IS PRESENTATION ROUTING. IT IS NEVER THE AUTHORISATION DECISION.
 *  ═══════════════════════════════════════════════════════════════════════════════════
 *
 *  PRD B-10 and S-3, ARCHITECTURE §6.6:
 *
 *    - The role for *rendering* purposes comes from one `GET /api/v1/auth/me` call resolved
 *      server-side. It decides which shell renders. It decides nothing else.
 *    - Every protected page re-verifies the session server-side by calling `/auth/me` again
 *      through `@/lib/session`. A page must never assume the middleware ran.
 *    - Every data operation is independently authorised by the API, which is the sole
 *      authority. Nothing the browser can influence — a header, a query string, a cookie
 *      value read here — is ever trusted as a permission.
 *    - Middleware can be bypassed (CVE-2025-29927 is the reminder). Treating it as a security
 *      boundary would be a defect, not a shortcut.
 *
 *  What it is actually for: sending a signed-out visitor to `/login` before a protected page
 *  paints, keeping a signed-in user off `/login`, and negotiating the locale — convenience,
 *  and nothing more.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

const intlMiddleware = createIntlMiddleware(routing);

/** The shape of `/auth/me` this file cares about. Nothing else is read here. */
interface SessionProbe {
  role: Role;
}

/**
 * Probes the session by calling the API with the incoming cookie forwarded (B-9). Returns
 * `null` for "no usable session" — including every failure mode, because a settings or
 * network blip must degrade to "signed out for routing purposes", never to a hard error page.
 */
async function probeSession(request: NextRequest): Promise<SessionProbe | null> {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;

  // Read directly rather than through `@/lib/env`: this runs on the Edge runtime, where the
  // validated env module is not available. The value is validated at build time regardless.
  const baseUrl = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) return null;

  try {
    const response = await fetch(`${baseUrl}${apiPaths.authMe}`, {
      headers: {
        cookie: cookieHeader,
        accept: 'application/json',
        'x-request-id': request.headers.get('x-request-id') ?? crypto.randomUUID(),
      },
      // A session read is never cached: it is per-user and changes on logout.
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    });

    if (!response.ok) return null;

    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'data' in body &&
      typeof body.data === 'object' &&
      body.data !== null &&
      'role' in body.data &&
      (body.data.role === Role.ADMIN || body.data.role === Role.CONSUMER)
    ) {
      return { role: body.data.role };
    }
    return null;
  } catch {
    // Timeout, DNS failure, API down. Fall through as "unknown" and let the page decide —
    // the page re-verifies server-side anyway, so nothing is lost but a redirect hint.
    return null;
  }
}

function localeOf(pathname: string): Locale {
  const first = pathname.split('/').filter(Boolean)[0];
  return (routing.locales as readonly string[]).includes(first ?? '')
    ? (first as Locale)
    : routing.defaultLocale;
}

export default async function middleware(request: NextRequest) {
  // 1. Locale negotiation first: cookie → Accept-Language → default. If the path has no
  //    locale prefix this returns a redirect, and there is nothing further to decide.
  const response = intlMiddleware(request);
  if (response.headers.has('location')) return response;

  const { pathname, search } = request.nextUrl;
  const locale = localeOf(pathname);

  const wantsProtected = isProtectedPath(pathname);
  const wantsAuthOnly = isAuthOnlyPath(pathname);

  // 2. Public browsing is genuinely public (C-1). Skip the probe entirely — no session call
  //    on the catalog, the garment detail or a shared link.
  if (!wantsProtected && !wantsAuthOnly) return response;

  const session = await probeSession(request);

  // 3. Signed out on a protected segment → `/login`, carrying where they were going so they
  //    land back there. Presentation only; the page below still checks for itself.
  if (wantsProtected && !session) {
    const url = request.nextUrl.clone();
    url.pathname = routes.login(locale);
    url.search = '';
    url.searchParams.set(RETURN_TO_PARAM, `${pathname}${search}`);
    return NextResponse.redirect(url, 307);
  }

  // 4. Already signed in on `/login` or `/signup` → the one dashboard URL (S-2). The role is
  //    resolved again inside `/dashboard`; this does not pre-empt it.
  if (wantsAuthOnly && session) {
    const url = request.nextUrl.clone();
    url.pathname = routes.dashboard(locale);
    url.search = '';
    return NextResponse.redirect(url, 307);
  }

  // Deliberately absent: any admin/consumer split. A consumer reaching an admin URL is
  // handled by the segment's own server-side check, which renders the S-9 no-access screen.
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *  - `/api`      (this app exposes no API routes; there is no proxy layer, B-9)
     *  - `/_next`    (build output)
     *  - `/_vercel`  (platform internals)
     *  - static assets, identified by a file extension
     */
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};
