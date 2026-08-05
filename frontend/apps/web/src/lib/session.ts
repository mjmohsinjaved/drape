import 'server-only';

import { cache } from 'react';

import { redirect } from 'next/navigation';

import { authPaths, type SessionUser } from '@repo/api-client';

import { Role, RETURN_TO_PARAM } from '@/lib/constants';
import { routes } from '@/lib/routes';
import { serverGetOrNull } from '@/lib/server-api';

import type { Locale } from '@/i18n/config';

/**
 * The one session read in the web app — `GET /api/v1/auth/me`, resolved server-side with the
 * incoming cookie forwarded (B-9, B-10).
 *
 * **This resolves which interface to render. It is never an authorisation decision** (S-3).
 * Every data operation is independently authorised by the API, and every protected page
 * re-verifies here rather than trusting the middleware that ran before it.
 */

/**
 * The `GET /auth/me` payload is {@link SessionUser} from `@repo/api-client` — the B-4 contract,
 * not a local restatement of it. This module re-exports it so the many callers that only need
 * "the signed-in person" keep importing from one place.
 */
export type { SessionUser };

/**
 * Cached per request, so a layout, its page and a nested layout resolving the same session
 * cost exactly one call to the API.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  return serverGetOrNull<SessionUser>(authPaths.me);
});

export async function isAuthenticated(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}

/**
 * For a segment that has no meaning without a session. Sends the user to `/login` carrying
 * where they were heading, so they land back there afterwards.
 */
export async function requireUser(locale: Locale, returnTo?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    const target = returnTo
      ? `${routes.login(locale)}?${RETURN_TO_PARAM}=${encodeURIComponent(returnTo)}`
      : routes.login(locale);
    redirect(target);
  }
  return user;
}

/**
 * Admin-only segments. A consumer here goes to the S-9 no-access screen — plain language and
 * a link back to the fitting room, never a raw 403. Every admin URL resolves to the same
 * screen, so nothing leaks about whether the resource exists.
 */
export async function requireAdmin(locale: Locale, returnTo?: string): Promise<SessionUser> {
  const user = await requireUser(locale, returnTo);
  if (user.role !== Role.ADMIN) {
    redirect(routes.noAccess(locale));
  }
  return user;
}

/** Consumer-only segments. An admin is sent back to the one dashboard URL (S-2). */
export async function requireConsumer(locale: Locale, returnTo?: string): Promise<SessionUser> {
  const user = await requireUser(locale, returnTo);
  if (user.role !== Role.CONSUMER) {
    redirect(routes.dashboard(locale));
  }
  return user;
}

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === Role.ADMIN;
}

export function isConsumer(user: SessionUser | null): boolean {
  return user?.role === Role.CONSUMER;
}

/** Her display initials for the avatar fallback — never an image we do not have. */
export function initialsOf(user: SessionUser): string {
  return user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase())
    .join('');
}

/** The minimal, serialisable slice a shell needs. Nothing sensitive crosses this boundary. */
export interface ShellUser {
  name: string;
  email: string;
  initials: string;
}

export function toShellUser(user: SessionUser): ShellUser {
  return { name: user.name, email: user.email, initials: initialsOf(user) };
}
