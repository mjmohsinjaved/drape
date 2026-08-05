import Link from 'next/link';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface DeleteMyDataLinkProps {
  locale: Locale;
  /** `inline` sits at the foot of a screen; `prominent` is used on the gate itself. */
  variant?: 'inline' | 'prominent';
}

/**
 * **Delete my photo and results** — C-11's last bullet, and C-40.
 *
 * > "a **Delete my photo and results** control, reachable from every screen afterwards"
 *
 * It is rendered at the foot of every consumer screen this workstream owns, alongside the
 * account menu entry that carries it everywhere else. Named for what she controls, not for how
 * the system stores it (D-14): "Delete my photo and results", never "Manage data retention".
 *
 * The control is a link to the data screen rather than a button that deletes on the spot —
 * deletion is permanent and belongs behind the screen that shows her exactly what will go.
 */
export function DeleteMyDataLink({ locale, variant = 'inline' }: DeleteMyDataLinkProps) {
  const t = useTranslations('consent.deleteControl');

  return (
    <div className={variant === 'prominent' ? 'flex flex-col gap-1' : 'flex flex-col gap-1 pt-4'}>
      <Link
        href={routes.accountData(locale)}
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md text-sm text-ink-muted underline underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
      >
        <Trash2 aria-hidden="true" className="size-4" />
        {t('label')}
      </Link>
      <p className="text-xs text-ink-subtle">{t('hint')}</p>
    </div>
  );
}
