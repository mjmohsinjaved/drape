import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PagePlaceholder } from '@/components/states';
import { Role } from '@/lib/constants';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { getCurrentUser } from '@/lib/session';

import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common.dashboard' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.dashboard(locale),
  });
}

/**
 * The role-appropriate landing (S-2). The shell is already chosen by the layout above; this
 * chooses what fills it.
 *
 * TODO(W1/W3): replace both branches with `<AdminHome/>` and `<ConsumerHome/>` —
 *   admin: today's enquiries, the stale-24h highlight (A-25), budget burn (A-33), catalog health (A-15)
 *   consumer: try-ons left this month (C-5), the shortlist, recent try-ons, the next step
 */
export default async function DashboardPage({ params }: LocaleParams) {
  const { locale } = await params;
  setRequestLocale(locale);

  // The layout already required a session; this read is served from the same request cache.
  const user = await getCurrentUser();
  const isAdmin = user?.role === Role.ADMIN;

  const t = await getTranslations({
    locale,
    namespace: isAdmin ? 'admin.home' : 'common.dashboard',
  });

  return (
    <PagePlaceholder
      title={t('title')}
      description={t('description')}
      workstream={isAdmin ? 'W3' : 'W2'}
      notes={[t('next1'), t('next2')]}
    />
  );
}
