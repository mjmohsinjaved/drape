import Link from 'next/link';

import { getFormatter, getTranslations } from 'next-intl/server';

import { Button, SuccessState } from '@repo/ui';

import { DeniedState, ScreenError } from '@/components/states';
import { getMyConsentServer, getPolicyServer } from '@/features/consent/api/server';
import { ConsentGate } from '@/features/consent/components/ConsentGate';
import { DeleteMyDataLink } from '@/features/consent/components/DeleteMyDataLink';
import { isPermissionDenied, isRetryableCode } from '@/features/tryon/lib/error-copy';
import { apiLocale ,type  Locale } from '@/i18n/config';
import { routes } from '@/lib/routes';


export interface ConsentScreenProps {
  locale: Locale;
  /** Where she was heading when the gate interrupted, carried through the `from` parameter. */
  returnTo?: string;
}

/**
 * The consent screen — C-11, C-12.
 *
 * Server-rendered so the policy text is in the first response (§10.3: this is a screen to be
 * read). The accept form below it is the only client island.
 *
 * Three states, decided by `GET /consents/me`:
 *
 * - `REQUIRED` — the first-time gate.
 * - `STALE` — she agreed to an older version and the policy has moved (C-12). Same gate, framed
 *   as what changed, with both version numbers named.
 * - `GRANTED` — already current. She sees what she agreed to and when, and the two things she
 *   might have come here for: add a photo, or delete what is stored. It is never a dead screen.
 */
export async function ConsentScreen({ locale, returnTo }: ConsentScreenProps) {
  const t = await getTranslations({ locale, namespace: 'consent' });
  const format = await getFormatter({ locale });

  const [policy, state] = await Promise.all([
    getPolicyServer(apiLocale[locale]),
    getMyConsentServer(),
  ]);

  const keepBrowsing = (
    <Button asChild variant="secondary">
      <Link href={routes.browse(locale)}>{t('gate.decline')}</Link>
    </Button>
  );

  if (!policy.ok) {
    // S-9 / D-5: an authorisation refusal is the permission-denied state, never an error
    // state and never a raw 403.
    if (isPermissionDenied(policy.error.errorCode)) return <DeniedState locale={locale} />;

    const key = `errors.${policy.error.errorCode}`;
    return (
      <ScreenError
        title={t('errors.title')}
        description={t.has(key) ? t(key) : t('errors.description')}
        requestId={policy.error.requestId}
        retryable={isRetryableCode(policy.error.errorCode)}
        secondaryAction={keepBrowsing}
      />
    );
  }

  // A failed consent read is NOT "nothing recorded". Falling through to the gate would ask a
  // woman who already agreed to agree again — misleading about what the studio holds, and a
  // second record written against the same policy version. So the two are kept distinct: we say
  // we could not check, and offer the re-read.
  if (!state.ok) {
    if (isPermissionDenied(state.error.errorCode)) return <DeniedState locale={locale} />;

    const key = `errors.${state.error.errorCode}`;
    return (
      <ScreenError
        title={t('errors.stateUnknownTitle')}
        description={t.has(key) ? t(key) : t('errors.stateUnknownDescription')}
        requestId={state.error.requestId}
        retryable={isRetryableCode(state.error.errorCode)}
        secondaryAction={keepBrowsing}
      />
    );
  }

  const consent = state.data;

  if (consent.status === 'GRANTED') {
    return (
      <div className="mx-auto flex w-full max-w-prose flex-col gap-8 py-4">
        <SuccessState
          title={t('gate.granted.title')}
          description={t('gate.granted.description', {
            date:
              consent.grantedAt === null
                ? ''
                : format.dateTime(new Date(consent.grantedAt), 'short'),
            version: consent.consentedPolicyVersion ?? consent.policyVersion,
          })}
          action={
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild variant="primary">
                <Link href={routes.photoNew(locale)}>{t('gate.granted.action')}</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href={routes.accountData(locale)}>{t('gate.granted.manage')}</Link>
              </Button>
            </div>
          }
        />
        <DeleteMyDataLink locale={locale} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <ConsentGate
        locale={locale}
        policy={policy.data}
        previousVersion={consent.status === 'STALE' ? consent.consentedPolicyVersion : null}
        returnTo={returnTo}
      />
      <div className="mx-auto w-full max-w-prose">
        <DeleteMyDataLink locale={locale} />
      </div>
    </div>
  );
}
