import Link from 'next/link';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, DirectionalIcon, EmptyState } from '@repo/ui';

import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface DeniedStateProps {
  locale: Locale;
}

/**
 * Permission denied — PRD S-9, D-5.
 *
 * Plain language and a link back to the fitting room. Never a raw 403, never a stack of
 * technical detail, and never a redirect that reveals whether the resource exists: every admin
 * URL a consumer reaches resolves to this same screen, so nothing can be probed by watching
 * where the browser lands.
 *
 * It does not tell her she did something wrong, because she did not — she followed a link.
 */
export function DeniedState({ locale }: DeniedStateProps) {
  const t = useTranslations('errors.noAccess');

  return (
    <EmptyState
      tone="neutral"
      title={t('title')}
      description={t('body')}
      action={
        <Button asChild variant="primary">
          <Link href={routes.home(locale)}>
            {t('action')}
            <DirectionalIcon>
              <ArrowRight aria-hidden="true" className="size-4" />
            </DirectionalIcon>
          </Link>
        </Button>
      }
    />
  );
}
