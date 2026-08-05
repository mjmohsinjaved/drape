import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ChevronLeft } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';

import { Badge, Button, Callout, DirectionalIcon } from '@repo/ui';

import { DeniedState, ScreenError, SignedOutState } from '@/components/states';
import { getCatalogGarment } from '@/features/catalog-browse/api/endpoints';
import { formatMoney } from '@/features/catalog-browse/lib/format';
import { DeleteMyDataLink } from '@/features/consent/components/DeleteMyDataLink';
import { getResultServer } from '@/features/renders/api/server';
import { RenderViewer } from '@/features/renders/components/RenderViewer';
import { VerdictControls } from '@/features/renders/components/VerdictControls';
import { getShortlistServer } from '@/features/shortlist/api/server';
import {
  isAuthenticationRequired,
  isPermissionDenied,
  isRetryableCode,
} from '@/features/tryon/lib/error-copy';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface RenderDetailScreenProps {
  locale: Locale;
  resultId: string;
}

/**
 * One render, in full — PRD C-26, C-29, C-31.
 *
 * > "Viewing costs nothing: no regeneration, no quota consumed, no photo re-upload."
 *
 * `GET /results/:resultId` reads a stored row. Nothing on this path can start a generation, and
 * the screen says so plainly rather than leaving her to wonder.
 *
 * **C-29 is the load-bearing behaviour here.** When the garment has been unpublished, archived or
 * removed, the catalog read fails — and the render is displayed exactly as before, with the piece
 * labelled unavailable and the try-on action gone. Her render is never hidden because the studio
 * changed its mind about the piece.
 */
export async function RenderDetailScreen({ locale, resultId }: RenderDetailScreenProps) {
  const t = await getTranslations({ locale, namespace: 'renders' });
  const format = await getFormatter({ locale });

  // The shortlist read depends on nothing — it was sitting in the second leg behind the render,
  // which made it a third round trip on a screen that only needs two. Only the catalog read
  // genuinely has to wait: it needs the garment id off the render.
  const [result, shortlist] = await Promise.all([getResultServer(resultId), getShortlistServer()]);

  if (!result.ok) {
    // D-5: a session that ended under an open screen is not an authorisation refusal. Signing
    // in is what fixes it, and the return path brings her back to this exact screen.
    if (isAuthenticationRequired(result.error.errorCode)) {
      return <SignedOutState />;
    }

    // S-9 / D-5: an authorisation refusal is the permission-denied state, never an error
    // state and never a raw 403.
    if (isPermissionDenied(result.error.errorCode)) return <DeniedState locale={locale} />;

    if (result.error.statusCode === 404) notFound();

    const key = `errors.${result.error.errorCode}`;
    return (
      <ScreenError
        title={t('errors.detailTitle')}
        description={t.has(key) ? t(key) : t('errors.description')}
        requestId={result.error.requestId}
        retryable={isRetryableCode(result.error.errorCode)}
        secondaryAction={
          <Button asChild variant="secondary">
            <Link href={routes.renders(locale)}>{t('detail.back')}</Link>
          </Button>
        }
      />
    );
  }

  const render = result.data;

  // The compare image (C-20) is the studio photo of the piece. Fetched only when the garment is
  // still available — a withdrawn piece has nothing to compare against, and the viewer says so
  // rather than showing a broken frame.
  const garment =
    render.garmentId !== null && render.garmentAvailable
      ? await getCatalogGarment(render.garmentId)
      : null;

  const catalogUrl =
    garment !== null && garment.ok
      ? (garment.data.primaryImage?.url ?? garment.data.images[0]?.url ?? null)
      : null;

  const verdict =
    shortlist.ok && render.garmentId !== null
      ? shortlist.data.items.find((item) => item.garmentId === render.garmentId)?.verdict
      : undefined;

  const price = formatMoney(locale, render.garmentPrice, render.garmentCurrency);

  return (
    <div className="flex flex-col gap-8">
      <Link
        href={routes.renders(locale)}
        className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
      >
        <DirectionalIcon>
          <ChevronLeft aria-hidden="true" className="size-4" />
        </DirectionalIcon>
        {t('detail.back')}
      </Link>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
        <RenderViewer
          locale={locale}
          resultId={render.id}
          garmentTitle={render.garmentTitle}
          renderUrl={render.url}
          catalogUrl={catalogUrl}
        />

        <div className="flex flex-col gap-8">
          <header className="flex flex-col gap-2">
            <h1 className="font-display text-2xl text-balance md:text-3xl">
              {render.garmentTitle}
            </h1>
            <p className="text-sm text-ink-muted">{render.garmentCategory}</p>
            <p className="text-sm">{price ?? t('list.card.priceOnRequest')}</p>
            <p className="text-sm text-ink-subtle">
              {t('detail.triedOn', {
                date: format.dateTime(new Date(render.createdAt), 'short'),
              })}
            </p>
            <p className="text-sm text-ink-subtle">
              {render.personPhotoLabel === null
                ? t('detail.fromDeletedPhoto')
                : t('detail.fromPhoto', { label: render.personPhotoLabel })}
            </p>
          </header>

          {render.garmentAvailable ? (
            <div className="flex flex-col gap-3">
              {render.garmentId === null ? null : (
                <Button asChild variant="secondary">
                  <Link href={routes.garment(locale, render.garmentId)}>
                    {t('detail.viewGarment')}
                  </Link>
                </Button>
              )}
              <p className="text-sm text-ink-muted">{t('detail.tryAgainNote')}</p>
            </div>
          ) : (
            // C-29: the piece is labelled unavailable and the try-on action is gone. The render
            // above is untouched.
            <Callout tone="info">
              <span className="flex flex-col gap-1">
                <Badge variant="outline">{t('list.card.unavailable')}</Badge>
                {t('detail.unavailable')}
              </span>
            </Callout>
          )}

          <VerdictControls
            locale={locale}
            resultId={render.id}
            garmentId={render.garmentId}
            current={verdict === 'NOT_FOR_ME' ? undefined : verdict}
          />
        </div>
      </div>

      <DeleteMyDataLink locale={locale} />
    </div>
  );
}
