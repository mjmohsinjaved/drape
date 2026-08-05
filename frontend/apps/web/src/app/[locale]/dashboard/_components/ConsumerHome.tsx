import Link from 'next/link';

import { ArrowRight, Heart, Images, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Button, Callout, Card, CardContent, DirectionalIcon } from '@repo/ui';

import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';
import type { SessionUser } from '@/lib/session';
import type { ComponentType } from 'react';

/**
 * The consumer landing behind `/dashboard` (S-2).
 *
 * A Server Component: everything on it comes from the session that the page already resolved,
 * so there is no second round trip and no client bundle for a screen made of links.
 *
 * The copy is shortlisting copy (§9.4). A try-on is something she *tries on* to help her
 * shortlist — never a preview of how a piece will look on her, never "see yourself in".
 */
export interface ConsumerHomeProps {
  locale: Locale;
  user: SessionUser;
}

interface NextStep {
  key: 'browse' | 'photos' | 'shortlist';
  href: string;
  Icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}

export async function ConsumerHome({ locale, user }: ConsumerHomeProps) {
  const t = await getTranslations({ locale, namespace: 'account.dashboard.consumer' });

  const steps: NextStep[] = [
    { key: 'browse', href: routes.browse(locale), Icon: Sparkles },
    { key: 'photos', href: routes.photos(locale), Icon: Images },
    { key: 'shortlist', href: routes.shortlist(locale), Icon: Heart },
  ];

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold text-balance text-ink">
          {t('title', { name: user.name })}
        </h1>
        <p className="max-w-prose text-base text-ink-muted">{t('description')}</p>
      </header>

      {/*
        C-3: confirming her email is what unlocks the first try-on. It is stated as the next
        step with the control beside it, not as a warning about something she got wrong.
      */}
      {user.emailVerifiedAt === null ? (
        <Callout
          tone="info"
          title={t('confirmEmailTitle')}
          action={
            <Button asChild variant="primary" size="sm">
              <Link href={routes.verifyEmail(locale)}>{t('confirmEmailAction')}</Link>
            </Button>
          }
        >
          {t('confirmEmailBody')}
        </Callout>
      ) : null}

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map(({ key, href, Icon }) => (
          <li key={key}>
            <Card className="h-full transition-colors hover:bg-surface-sunken">
              <CardContent className="py-5">
                <Link href={href} className="flex min-h-11 flex-col gap-2">
                  <Icon aria-hidden="true" className="size-5 text-brand" />
                  <span className="flex items-center gap-2 text-base font-semibold text-ink">
                    {t(`steps.${key}.title`)}
                    <DirectionalIcon>
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </DirectionalIcon>
                  </span>
                  <span className="text-sm text-ink-muted">{t(`steps.${key}.description`)}</span>
                </Link>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
