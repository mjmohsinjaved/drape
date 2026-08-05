'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useTranslations } from 'next-intl';

import { Button, Callout, EmptyState } from '@repo/ui';

import { FormErrorFeedback, FormSuccessFeedback } from '@/features/auth/components/FormFeedback';
import {
  useConfirmEmail,
  useRequestEmailVerification,
} from '@/features/auth/hooks/use-auth-mutations';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

/**
 * Email confirmation — C-3, in its two forms.
 *
 * The API splits the job across two routes and so does the UI: `/verify-email` asks for a fresh
 * link and needs a session; `/verify-email/[token]` consumes the emailed one and does not.
 */

export interface RequestEmailVerificationProps {
  locale: Locale;
  /** Resolved server-side. Presentation only — the API is the authority on the session (S-3). */
  isSignedIn: boolean;
  /** Already confirmed, so the screen has nothing to ask for. */
  alreadyVerified: boolean;
  /** Shown so she can check we have the right address before asking for another link. */
  email: string | null;
}

/**
 * The token-less `/verify-email` screen: "send me another link".
 *
 * ### The six D-5 states
 * - **default** — the address we would send to, and the send control.
 * - **loading** — the busy button, plus the segment's `loading.tsx`.
 * - **empty** — the signed-out case: nothing to send to, so the screen points at signing in.
 * - **error** — rate limits and transport failures.
 * - **permission denied** — a suspended account renders the S-9 shell.
 * - **success** — sent, with what to do next.
 */
export function RequestEmailVerification({
  locale,
  isSignedIn,
  alreadyVerified,
  email,
}: RequestEmailVerificationProps) {
  const t = useTranslations('auth.verifyEmail');
  const tc = useTranslations('auth.common');
  const request = useRequestEmailVerification();

  if (!isSignedIn) {
    return (
      <EmptyState
        size="inline"
        headingLevel="h2"
        title={t('signedOutTitle')}
        description={t('signedOutBody')}
        action={
          <Button asChild variant="primary">
            <Link href={routes.login(locale)}>{tc('signIn')}</Link>
          </Button>
        }
      />
    );
  }

  if (alreadyVerified) {
    return (
      <FormSuccessFeedback
        title={t('alreadyTitle')}
        description={t('alreadyBody')}
        action={
          <Button asChild variant="primary">
            <Link href={routes.dashboard(locale)}>{tc('goToFittingRoom')}</Link>
          </Button>
        }
      />
    );
  }

  if (request.isSuccess) {
    return (
      <FormSuccessFeedback
        title={t('sentTitle')}
        description={t('sentBody')}
        action={
          <Button asChild variant="secondary">
            <Link href={routes.dashboard(locale)}>{tc('goToFittingRoom')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {request.error ? (
        <FormErrorFeedback
          error={request.error}
          onRetry={
            request.error.isRetryable
              ? () => {
                  request.reset();
                }
              : undefined
          }
          deniedAction={
            <Button asChild variant="secondary">
              <Link href={routes.home(locale)}>{tc('backToFittingRoom')}</Link>
            </Button>
          }
        />
      ) : null}

      {email ? (
        <Callout tone="info" title={t('addressTitle')}>
          <span className="font-mono text-sm">{email}</span>
        </Callout>
      ) : null}

      <Button
        variant="primary"
        fullWidth
        loading={request.isPending}
        loadingLabel={tc('sending')}
        onClick={() => {
          if (request.isPending) return;
          request.mutate();
        }}
      >
        {t('submit')}
      </Button>
    </div>
  );
}

export interface ConfirmEmailTokenProps {
  locale: Locale;
  token: string;
}

/**
 * The `/verify-email/[token]` screen.
 *
 * **The token is confirmed on a press, not on page load.** Mail clients and link scanners
 * fetch every URL in a message; a token consumed by a render would be spent before the reader
 * ever saw the page, and it is single-use. One deliberate press is the difference between a
 * link that works and one that is already burnt on arrival.
 *
 * ### The six D-5 states
 * - **default** — the confirm control.
 * - **loading** — the busy button, plus the segment's `loading.tsx`.
 * - **empty** — not applicable.
 * - **error** — the three token codes, each offering a fresh link.
 * - **permission denied** — a deletion in progress renders the S-9 shell.
 * - **success** — confirmed, with the fitting room as the next step.
 */
export function ConfirmEmailToken({ locale, token }: ConfirmEmailTokenProps) {
  const t = useTranslations('auth.verifyEmailToken');
  const tc = useTranslations('auth.common');
  const router = useRouter();
  const confirm = useConfirmEmail();

  if (confirm.isSuccess) {
    return (
      <FormSuccessFeedback
        title={t('successTitle')}
        description={t('successBody')}
        action={
          <Button
            variant="primary"
            onClick={() => {
              router.replace(routes.dashboard(locale));
              router.refresh();
            }}
          >
            {tc('goToFittingRoom')}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {confirm.error ? (
        <FormErrorFeedback
          error={confirm.error}
          onRetry={
            confirm.error.isRetryable
              ? () => {
                  confirm.reset();
                }
              : undefined
          }
          secondaryAction={
            <Button asChild variant="secondary">
              <Link href={routes.verifyEmail(locale)}>{tc('sendNewLink')}</Link>
            </Button>
          }
          deniedAction={
            <Button asChild variant="secondary">
              <Link href={routes.home(locale)}>{tc('backToFittingRoom')}</Link>
            </Button>
          }
        />
      ) : null}

      <Button
        variant="primary"
        fullWidth
        loading={confirm.isPending}
        loadingLabel={tc('confirming')}
        onClick={() => {
          if (confirm.isPending) return;
          confirm.mutate({ token });
        }}
      >
        {t('submit')}
      </Button>
    </div>
  );
}
