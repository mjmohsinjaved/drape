import Link from 'next/link';

import { ArrowRight, Inbox, Shirt, Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Card, CardContent, DirectionalIcon } from '@repo/ui';

import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';
import type { SessionUser } from '@/lib/session';
import type { ComponentType } from 'react';

export interface AdminHomeProps {
  locale: Locale;
  user: SessionUser;
}

interface ConsoleLink {
  key: 'enquiries' | 'catalog' | 'consumers';
  href: string;
  Icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}

export async function AdminHome({ locale, user }: AdminHomeProps) {
  const t = await getTranslations({ locale, namespace: 'account.dashboard.admin' });

  const links: ConsoleLink[] = [
    { key: 'enquiries', href: routes.admin.enquiries(locale), Icon: Inbox },
    { key: 'catalog', href: routes.admin.catalog(locale), Icon: Shirt },
    { key: 'consumers', href: routes.admin.consumers(locale), Icon: Users },
  ];

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold text-balance text-ink">
          {t('title', { name: user.name })}
        </h1>
        <p className="max-w-prose text-base text-ink-muted">{t('description')}</p>
      </header>


      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {links.map(({ key, href, Icon }) => (
          <li key={key}>
            <Card className="h-full transition-colors hover:bg-surface-sunken">
              <CardContent className="py-5">
                <Link href={href} className="flex min-h-11 flex-col gap-2">
                  <Icon aria-hidden="true" className="size-5 text-brand" />
                  <span className="flex items-center gap-2 text-base font-semibold text-ink">
                    {t(`links.${key}.title`)}
                    <DirectionalIcon>
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </DirectionalIcon>
                  </span>
                  <span className="text-sm text-ink-muted">{t(`links.${key}.description`)}</span>
                </Link>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
