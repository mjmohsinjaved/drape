import Link from 'next/link';

import { ArrowRight, Bell, DatabaseBackup, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Card, CardContent, DirectionalIcon } from '@repo/ui';

import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';
import type { ComponentType } from 'react';

/**
 * The other account screens, reachable from the profile page — C-7 and C-40.
 *
 * C-40 asks for the data controls to be reachable from the account menu on every screen; the
 * consumer shell's user menu carries that link, and this panel is the second, plainer route to
 * it. A privacy control that is only in a dropdown is a privacy control most people never find.
 *
 * A Server Component: three links and no state.
 */
export interface AccountSectionsProps {
  locale: Locale;
}

interface SectionLink {
  key: 'security' | 'notifications' | 'data';
  href: string;
  Icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}

export function AccountSections({ locale }: AccountSectionsProps) {
  const t = useTranslations('account.sections');

  const links: SectionLink[] = [
    { key: 'security', href: routes.accountSecurity(locale), Icon: ShieldCheck },
    { key: 'notifications', href: routes.accountNotifications(locale), Icon: Bell },
    { key: 'data', href: routes.accountData(locale), Icon: DatabaseBackup },
  ];

  return (
    <nav aria-label={t('label')}>
      <ul className="grid gap-4 sm:grid-cols-2">
        {links.map(({ key, href, Icon }) => (
          <li key={key}>
            <Card className="h-full transition-colors hover:bg-surface-sunken">
              <CardContent className="py-4">
                <Link href={href} className="flex min-h-11 items-start gap-3">
                  <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand" />
                  <span className="flex flex-col gap-1">
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                      {t(`${key}.title`)}
                      <DirectionalIcon>
                        <ArrowRight aria-hidden="true" className="size-4" />
                      </DirectionalIcon>
                    </span>
                    <span className="text-sm text-ink-muted">{t(`${key}.description`)}</span>
                  </span>
                </Link>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </nav>
  );
}
