'use client';

import { useTranslations } from 'next-intl';

import { useMyQuota } from '@/features/tryon/hooks/use-my-quota';

export function HeaderQuotaPill() {
  const t = useTranslations('common');
  const quota = useMyQuota(true);

  if (quota.data === undefined) return null;

  return (
    <span className="hidden items-center whitespace-nowrap rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink-muted md:inline-flex">
      {t('quotaPill', { remaining: quota.data.remaining })}
    </span>
  );
}
