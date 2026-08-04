import Link from 'next/link';

import { Card, CardContent, CardDescription, CardHeader } from '@repo/ui';

import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { SkipLink, MAIN_CONTENT_ID } from '@/components/layout/SkipLink';
import { APP_NAME } from '@/lib/constants';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';
import type { ReactNode } from 'react';

export interface AuthShellProps {
  locale: Locale;
  /** The page's `<h1>`. */
  title: string;
  description: string;
  children: ReactNode;
  /** Secondary route out of this screen — "Create an account", "Back to sign in". */
  footer?: ReactNode;
}

/**
 * The shell every authentication screen shares — a centred card, no navigation (§6.6).
 *
 * There is one `/login` for both roles and the user is never asked which kind of account they
 * hold (S-1). Nothing on these screens hints at a role, and nothing distinguishes an unknown
 * email from a wrong password (S-6) — that is decided by the API's copy, not by this layout.
 *
 * The language switch stays available: someone who cannot read the current interface must
 * still be able to sign in.
 */
export function AuthShell({ locale, title, description, children, footer }: AuthShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <SkipLink />

      <header className="flex h-16 items-center justify-between px-5 md:px-8">
        <Link
          href={routes.home(locale)}
          className="inline-flex min-h-11 items-center text-xl font-semibold"
        >
          {APP_NAME}
        </Link>
        <LocaleSwitcher variant="icon" />
      </header>

      <main
        id={MAIN_CONTENT_ID}
        className="flex flex-1 items-start justify-center px-5 pb-16 pt-4 md:items-center md:pt-0"
      >
        <Card className="w-full max-w-md">
          <CardHeader>
            {/*
              The page's only <h1>, so it is written as one rather than composed from
              `CardTitle` — that atom's `as` is deliberately h2–h4, because a card title is
              normally a section heading inside a page that already has its <h1> (D-20). Here
              the card *is* the page, so the heading is authored directly with the same
              display-face treatment.
            */}
            <h1 className="font-display text-2xl font-semibold text-balance text-ink">{title}</h1>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {children}
            {footer && <div className="text-sm text-ink-muted">{footer}</div>}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
