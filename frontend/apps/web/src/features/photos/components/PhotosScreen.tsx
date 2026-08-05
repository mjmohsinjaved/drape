import Link from 'next/link';

import { Camera } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Button, EmptyState } from '@repo/ui';

import { DeniedState, ScreenError, SignedOutState } from '@/components/states';
import { DeleteMyDataLink } from '@/features/consent/components/DeleteMyDataLink';
import { listPhotosServer } from '@/features/photos/api/server';
import { FullBodyDiagram } from '@/features/photos/components/PhotoDiagrams';
import { PhotoList } from '@/features/photos/components/PhotoList';
import { TryOnTray } from '@/features/tryon/components/TryOnTray';
import {
  isAuthenticationRequired,
  isPermissionDenied,
  isRetryableCode,
} from '@/features/tryon/lib/error-copy';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface PhotosScreenProps {
  locale: Locale;
}

/**
 * Her saved photos — C-16, C-38.
 *
 * Server-rendered, because the signed image URLs live for five minutes and a server render is
 * what keeps them fresh on every visit.
 *
 * The empty state points at the first photo and shows the drawing that goes with it (D-6) — an
 * empty photo list that only says "no photos" is the exact failure D-6 exists to prevent.
 * `Delete my photo and results` sits at the foot of the screen, as C-11 requires everywhere.
 */
export async function PhotosScreen({ locale }: PhotosScreenProps) {
  const t = await getTranslations({ locale, namespace: 'photos' });
  const result = await listPhotosServer();

  if (!result.ok) {
    // D-5: a session that ended under an open screen is not an authorisation refusal. Signing
    // in is what fixes it, and the return path brings her back to this exact screen.
    if (isAuthenticationRequired(result.error.errorCode)) {
      return <SignedOutState />;
    }

    // S-9 / D-5: an authorisation refusal is the permission-denied state, never an error
    // state and never a raw 403.
    if (isPermissionDenied(result.error.errorCode)) return <DeniedState locale={locale} />;

    const key = `errors.${result.error.errorCode}`;
    return (
      <ScreenError
        title={t('errors.title')}
        description={t.has(key) ? t(key) : t('errors.description')}
        requestId={result.error.requestId}
        retryable={isRetryableCode(result.error.errorCode)}
        secondaryAction={
          <Button asChild variant="secondary">
            <Link href={routes.photoNew(locale)}>{t('list.add')}</Link>
          </Button>
        }
      />
    );
  }

  const photos = result.data;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl text-balance md:text-4xl">{t('list.title')}</h1>
        <p className="max-w-prose text-ink-muted">{t('list.subtitle')}</p>
      </header>

      {photos.length === 0 ? (
        <EmptyState
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            <Button asChild variant="primary" size="lg">
              <Link href={routes.photoNew(locale)}>{t('empty.action')}</Link>
            </Button>
          }
        >
          <FullBodyDiagram className="h-40 w-auto text-ink-subtle" />
        </EmptyState>
      ) : (
        <>
          <div>
            <Button
              asChild
              variant="primary"
              size="lg"
              startIcon={<Camera aria-hidden="true" />}
            >
              <Link href={routes.photoNew(locale)}>{t('list.add')}</Link>
            </Button>
          </div>

          <PhotoList photos={photos} />
        </>
      )}

      <DeleteMyDataLink locale={locale} />

      {/* C-19: a try-on started elsewhere finishes and reports itself here too. */}
      <TryOnTray locale={locale} />
    </div>
  );
}
