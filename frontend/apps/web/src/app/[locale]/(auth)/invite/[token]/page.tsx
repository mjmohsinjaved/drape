import Link from 'next/link';

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { authPaths ,type  InviteTokenPreview } from '@repo/api-client';
import { Button, EmptyState, ErrorState } from '@repo/ui';

import { AuthShell } from '@/components/layout/AuthShell';
import { InviteAcceptanceForm } from '@/features/auth/components/InviteAcceptanceForm';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { serverGet } from '@/lib/server-api';

import type { LocaleParamsWith } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParamsWith<{ token: string }>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, token } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.invite' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.invite(locale, token),
    noIndex: true,
  });
}

/** The three ways an invitation can be no good. Each gets the same next step: ask for a new one. */
const DEAD_INVITE_CODES = ['INVITE_NOT_FOUND', 'INVITE_EXPIRED', 'INVITE_ALREADY_CONSUMED'];

/**
 * `/invite/[token]` — S-5.
 *
 * The token is validated **server-side** by `GET /invites/token/:token` before anything is
 * drawn, so the reader sees the address and the role they are accepting rather than typing a
 * password into a form that may be pointing at nothing. That route is read-only and consumes
 * nothing, so previewing costs the invitation nothing.
 *
 * The role shown here comes from the invite row. It is never a form field, and the acceptance
 * body has no field that could carry one (S-4, S-5).
 *
 * ### The six D-5 states
 * - **default** — the preview and the acceptance form.
 * - **loading** — `loading.tsx` beside this file.
 * - **empty** — the three dead-token cases: what happened, and who to ask for a new invitation.
 * - **error** — a transport failure, with a retry.
 * - **permission denied** — not applicable; whoever holds the link has no account yet.
 * - **success** — the form hands over to two-factor enrolment, which S-8 makes mandatory next.
 */
export default async function AuthInviteTokenPage({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'auth.invite' });
  const result = await serverGet<InviteTokenPreview>(authPaths.invitePreview(token));

  return (
    <AuthShell
      locale={locale}
      title={t('title')}
      description={t('description')}
      footer={<Link href={routes.login(locale)}>{t('footerLogin')}</Link>}
    >
      {result.ok ? (
        <InviteAcceptanceForm locale={locale} token={token} preview={result.data} />
      ) : DEAD_INVITE_CODES.includes(result.error.errorCode) ? (
        <EmptyState
          size="inline"
          headingLevel="h2"
          title={t('deadTitle')}
          description={t('deadBody')}
          action={
            <Button asChild variant="secondary">
              <Link href={routes.home(locale)}>{t('deadAction')}</Link>
            </Button>
          }
        />
      ) : (
        <ErrorState
          size="inline"
          headingLevel="h2"
          title={t('previewErrorTitle')}
          description={t('previewErrorBody')}
          secondaryAction={
            <Button asChild variant="secondary">
              <Link href={routes.login(locale)}>{t('footerLogin')}</Link>
            </Button>
          }
        />
      )}
    </AuthShell>
  );
}
