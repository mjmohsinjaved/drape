import Link from 'next/link';

import { getTranslations } from 'next-intl/server';

import { Button, Separator } from '@repo/ui';

import { DeniedState, ScreenError, SignedOutState } from '@/components/states';
import { DeleteMyDataLink } from '@/features/consent/components/DeleteMyDataLink';
import { listPhotosServer } from '@/features/photos/api/server';
import { PhotoGuidance } from '@/features/photos/components/PhotoGuidance';
import { PhotoUploader } from '@/features/photos/components/PhotoUploader';
import {
  isAuthenticationRequired,
  isPermissionDenied,
  isRetryableCode,
} from '@/features/tryon/lib/error-copy';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface AddPhotoScreenProps {
  locale: Locale;
  returnTo?: string;
}

/**
 * Add a photo — C-13, C-14, C-15.
 *
 * **The guidance comes first and the picker second**, which is the requirement rather than a
 * layout preference: C-13 says "guidance *before* the picker", and §10.3 asks for it to be clear
 * enough that a first attempt usually passes. Putting the button above the six drawings would
 * technically satisfy neither.
 *
 * The list read below answers one question — is this her first photo? — which decides whether
 * the new one silently becomes active, and whether she is already at the C-16 limit. Both are
 * facts about her account that the uploader acts on, so a failed read is not degraded away here:
 * guessing "not her first" would either hand her an inactive photo she expected to use, or walk
 * her through an upload that the API refuses at the end. The screen says it could not check and
 * offers the re-read instead.
 *
 * All six D-5 states are present: default (guidance and picker), loading (`loading.tsx`), empty
 * (there is nothing to be empty of — the guidance *is* the screen), error and permission-denied
 * below, and success (the uploader's own saved state).
 */
export async function AddPhotoScreen({ locale, returnTo }: AddPhotoScreenProps) {
  const t = await getTranslations({ locale, namespace: 'photos' });
  const existing = await listPhotosServer();

  if (!existing.ok) {
    // D-5: a session that ended under an open screen is not an authorisation refusal. Signing
    // in is what fixes it, and the return path brings her back to this exact screen.
    if (isAuthenticationRequired(existing.error.errorCode)) {
      return <SignedOutState />;
    }

    // S-9 / D-5: an authorisation refusal is the permission-denied state, never an error
    // state and never a raw 403.
    if (isPermissionDenied(existing.error.errorCode)) return <DeniedState locale={locale} />;

    const key = `errors.${existing.error.errorCode}`;
    return (
      <ScreenError
        title={t('errors.title')}
        description={t.has(key) ? t(key) : t('errors.description')}
        requestId={existing.error.requestId}
        retryable={isRetryableCode(existing.error.errorCode)}
        secondaryAction={
          <Button asChild variant="secondary">
            <Link href={routes.photos(locale)}>{t('meta.listTitle')}</Link>
          </Button>
        }
      />
    );
  }

  const isFirstPhoto = existing.data.length === 0;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl text-balance md:text-4xl">{t('meta.newTitle')}</h1>
        <p className="max-w-prose text-ink-muted">{t('meta.newDescription')}</p>
      </header>

      <PhotoGuidance />

      <Separator />

      <PhotoUploader locale={locale} isFirstPhoto={isFirstPhoto} returnTo={returnTo} />

      <DeleteMyDataLink locale={locale} />
    </div>
  );
}
