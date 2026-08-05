'use client';

import { useCallback, useState } from 'react';

import { Download, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Callout,
  CompareToggle,
  ConfirmDialog,
  ShortlistingCaption,
  Zoomable,
  type CompareView,
} from '@repo/ui';

import { deleteResult, downloadResult } from '@/features/renders/api/endpoints';
import { useErrorMessage } from '@/features/tryon/hooks/use-error-message';
import { resolveErrorCode } from '@/features/tryon/lib/error-copy';
import { useRouter } from '@/i18n/navigation';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface RenderViewerProps {
  locale: Locale;
  resultId: string;
  garmentTitle: string;
  /** The signed render URL (§3.4). */
  renderUrl: string;
  /** The studio photo of the piece, for the compare toggle. Null when the garment is gone. */
  catalogUrl: string | null;
}

/**
 * The render, full-bleed, with compare and zoom — PRD C-20, C-26, §10.3.
 *
 * > "A composed presentation of the render with the compare control immediately available and
 * > the shortlisting caption always visible."
 *
 * Three things this screen must never do, and does not:
 *
 * - **The caption is not dismissible.** There is no close button on it, no `onDismiss`, and no
 *   state that can hide it. It is rendered outside every conditional on this screen.
 * - **Nothing is laid over the render** except that caption (§6.2). Compare and zoom sit below
 *   the image, where a thumb reaches them and where they do not cover the thing being examined.
 * - **Deletion says it is permanent, because it is.** The file and its thumbnail are
 *   hard-deleted; trying the piece on again would cost her a try-on from the monthly allowance,
 *   and the confirmation says exactly that (C-31).
 */
export function RenderViewer({
  locale,
  resultId,
  garmentTitle,
  renderUrl,
  catalogUrl,
}: RenderViewerProps) {
  const t = useTranslations('renders');
  const messageFor = useErrorMessage('renders');
  const router = useRouter();

  const [view, setView] = useState<CompareView>('tryon');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const showingCatalog = view === 'catalog' && catalogUrl !== null;
  const source = showingCatalog ? catalogUrl : renderUrl;
  const alt = showingCatalog
    ? t('detail.catalogAlt', { garment: garmentTitle })
    : t('detail.renderAlt', { garment: garmentTitle });

  const download = useCallback((): void => {
    setIsDownloading(true);
    setErrorCode(null);

    void downloadResult(resultId)
      .then(({ url, filename }) => {
        // A programmatic anchor, because the route streams bytes behind the session cookie and
        // an href alone would not carry it.
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      })
      .catch((error: unknown) => {
        setErrorCode(resolveErrorCode(error));
      })
      .finally(() => {
        setIsDownloading(false);
      });
  }, [resultId]);

  const remove = useCallback((): void => {
    setIsDeleting(true);
    setErrorCode(null);

    void deleteResult(resultId)
      .then(() => {
        router.replace(routes.renders(locale));
      })
      .catch((error: unknown) => {
        setErrorCode(resolveErrorCode(error));
        setIsDeleting(false);
        setConfirmingDelete(false);
      });
  }, [locale, resultId, router]);

  return (
    <div className="flex flex-col gap-6">
      <Zoomable label={t('detail.zoomLabel')} zoomInLabel={t('detail.zoomIn')} zoomOutLabel={t('detail.zoomOut')} resetLabel={t('detail.zoomReset')}>
        {/*
          A fixed 4:5 frame so the layout is settled before the render decodes (D-8), and a plain
          <img> because the URL is signed and expires within minutes — the image optimiser would
          cache it and serve a 403 on her next visit.
        */}
        <div className="aspect-render w-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, must not be cached by the image optimiser. */}
          <img src={source} alt={alt} className="size-full object-contain" />
        </div>
      </Zoomable>

      {/* Non-dismissible, and outside every conditional on this screen (C-20). */}
      <ShortlistingCaption>{t('caption')}</ShortlistingCaption>

      {catalogUrl === null ? (
        <p className="text-sm text-ink-muted">{t('detail.noCompareImage')}</p>
      ) : (
        <CompareToggle
          value={view}
          onValueChange={setView}
          label={t('detail.compareLabel')}
          catalogLabel={t('detail.compareCatalog')}
          tryonLabel={t('detail.compareTryOn')}
        />
      )}

      <p className="text-sm text-ink-subtle">{t('detail.free')}</p>

      {errorCode !== null ? <Callout tone="warning">{messageFor(errorCode)}</Callout> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          startIcon={<Download aria-hidden="true" />}
          loading={isDownloading}
          loadingLabel={t('detail.downloading')}
          onClick={download}
        >
          {t('detail.download')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          startIcon={<Trash2 aria-hidden="true" />}
          onClick={() => {
            setConfirmingDelete(true);
          }}
        >
          {t('delete.action')}
        </Button>
      </div>

      <p className="text-xs text-ink-subtle">{t('detail.downloadNote')}</p>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t('delete.title')}
        description={t('delete.body')}
        confirmLabel={t('delete.confirm')}
        cancelLabel={t('delete.cancel')}
        tone="danger"
        loading={isDeleting}
        onConfirm={remove}
      />
    </div>
  );
}
