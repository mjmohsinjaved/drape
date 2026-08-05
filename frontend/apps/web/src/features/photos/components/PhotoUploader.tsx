'use client';

import { useCallback, useId, useRef, useState } from 'react';

import Link from 'next/link';

import { AlertTriangle, Camera, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, Callout, Checkbox, Input, Label, ProgressBar, SuccessState } from '@repo/ui';

import { usePhotoUpload } from '@/features/photos/hooks/use-photo-upload';
import { ACCEPTED_MIME_TYPES ,type  PhotoCheckResult } from '@/features/photos/lib/validate-photo';
import { useErrorMessage } from '@/features/tryon/hooks/use-error-message';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface PhotoUploaderProps {
  locale: Locale;
  /** True when this is her first photo — it becomes the active one by default (C-16). */
  isFirstPhoto: boolean;
  /** Where to send her after saving, when she arrived mid-flow from a garment. */
  returnTo?: string;
}

/**
 * The picker, the C-14 review and the C-15 upload — the client island of `/photos/new`.
 *
 * Nothing here uploads before she has seen the verdict on her own photo. That is the whole
 * shape of the screen: choose, read what passed and what did not, then either fix it or send it.
 *
 * `capture` is deliberately absent from the input: on a phone, omitting it offers both the
 * camera and the gallery, and most people already have a photo they like.
 */
export function PhotoUploader({ locale, isFirstPhoto, returnTo }: PhotoUploaderProps) {
  const t = useTranslations('photos');
  const messageFor = useErrorMessage('photos');
  const upload = usePhotoUpload();

  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const activeId = useId();

  const [label, setLabel] = useState('');
  const [activate, setActivate] = useState(true);

  const choose = useCallback((): void => {
    inputRef.current?.click();
  }, []);

  const onFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0];
      // Clearing the value means picking the same file twice still fires a change event.
      event.target.value = '';
      if (file) upload.select(file);
    },
    [upload],
  );

  if (upload.phase === 'saved' && upload.saved !== null) {
    return (
      <SuccessState
        title={t('upload.saved.title')}
        description={t('upload.saved.description')}
        action={
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild variant="primary">
              <Link href={returnTo ?? routes.browse(locale)}>{t('upload.saved.browse')}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={routes.photos(locale)}>{t('upload.saved.photos')}</Link>
            </Button>
          </div>
        }
      />
    );
  }

  const busy =
    upload.phase === 'preparing' ||
    upload.phase === 'uploading' ||
    upload.phase === 'finalising';

  return (
    <section className="flex flex-col gap-6">
      <h2 className="font-display text-2xl text-balance">{t('upload.title')}</h2>

      {/*
        The file input is driven entirely by the visible "Choose a photo" button below, which is
        the control a user sees and the one that carries the name. `sr-only` hides it visually
        but leaves it in the tab order, so a keyboard user met an invisible first tab stop and
        then a second, visible one for the same action. `tabIndex={-1}` plus `aria-hidden` leaves
        exactly one control per action (D-20).
      */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_MIME_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFileChange}
      />

      {upload.previewUrl === null ? (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="primary"
            size="lg"
            fullWidth
            startIcon={<Camera aria-hidden="true" />}
            onClick={choose}
          >
            {t('upload.choose')}
          </Button>
          <p className="text-sm text-ink-muted">{t('upload.chooseHint')}</p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[minmax(0,18rem)_1fr]">
          <div className="flex flex-col gap-3">
            {/*
              A local object URL, not a remote asset: `next/image` cannot optimise a blob and
              would only add a proxy hop, so this is a plain <img> in a fixed 3:4 box. The box is
              what keeps the layout from shifting when the bitmap decodes (D-8).
            */}
            <div className="aspect-card w-full overflow-hidden rounded-xl bg-surface-sunken">
              {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL cannot go through next/image. */}
              <img
                src={upload.previewUrl}
                alt={t('upload.previewAlt')}
                className="size-full object-cover"
              />
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {upload.phase === 'checking' ? (
              <p role="status" aria-live="polite" className="text-sm text-ink-muted">
                {t('upload.checking')}
              </p>
            ) : null}

            {upload.validation !== null ? (
              <ValidationReport results={upload.validation.results} passed={upload.validation.passed} />
            ) : null}

            {upload.validation?.passed === true ? (
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={labelId}>{t('upload.labelField')}</Label>
                  <Input
                    id={labelId}
                    value={label}
                    maxLength={60}
                    placeholder={t('list.renamePlaceholder')}
                    onChange={(event) => {
                      setLabel(event.target.value);
                    }}
                  />
                  <p className="text-sm text-ink-subtle">{t('upload.labelHint')}</p>
                </div>

                {isFirstPhoto ? null : (
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={activeId}
                      checked={activate}
                      onCheckedChange={(next) => {
                        setActivate(next === true);
                      }}
                    />
                    <Label htmlFor={activeId} className="leading-normal">
                      {t('upload.setActive')}
                    </Label>
                  </div>
                )}

                {busy ? (
                  <div className="flex flex-col gap-2">
                    <ProgressBar
                      value={upload.phase === 'uploading' ? upload.progress : 100}
                      label={t('upload.progressLabel')}
                    />
                    <p role="status" aria-live="polite" className="text-sm text-ink-muted">
                      {upload.phase === 'preparing'
                        ? t('upload.preparing')
                        : upload.phase === 'uploading'
                          ? t('upload.uploading', { percent: upload.progress })
                          : t('upload.finalising')}
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    loading={busy}
                    loadingLabel={t('upload.finalising')}
                    onClick={() => {
                      upload.upload({ label, activate: isFirstPhoto || activate });
                    }}
                  >
                    {t('upload.submit')}
                  </Button>
                  <Button type="button" variant="secondary" size="lg" onClick={choose}>
                    {t('upload.tryAnother')}
                  </Button>
                </div>
              </div>
            ) : upload.validation !== null ? (
              <Button type="button" variant="primary" size="lg" onClick={choose}>
                {t('upload.tryAnother')}
              </Button>
            ) : null}

            {upload.errorCode !== null ? (
              <Callout tone="danger" title={t('errors.uploadTitle')}>
                {messageFor(upload.errorCode)}
              </Callout>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The verdict on her photo — C-14's "rejections are specific and actionable".
 *
 * Failures first, each with the instruction that fixes it. Passes are listed too, quietly: seeing
 * that five of six checks are fine is what makes the sixth feel fixable rather than arbitrary.
 */
function ValidationReport({
  results,
  passed,
}: {
  results: PhotoCheckResult[];
  passed: boolean;
}) {
  const t = useTranslations('photos');

  const failures = results.filter((result) => !result.passed);
  const passes = results.filter((result) => result.passed);

  return (
    <div className="flex flex-col gap-4" role="status" aria-live="polite">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-medium">
          {passed ? t('upload.passedTitle') : t('upload.failedTitle')}
        </h3>
        <p className="text-sm text-ink-muted">
          {passed ? t('upload.passedBody') : t('upload.failedBody')}
        </p>
      </div>

      {failures.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {failures.map((result) => (
            <li key={result.check} className="flex items-start gap-3">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium">{t(`checks.${result.check}.label`)}</p>
                <p className="text-sm text-pretty text-ink-muted">
                  {t(`checks.${result.check}.${result.messageKey}`, result.values ?? {})}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {passes.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          {passes.map((result) => (
            <li key={result.check} className="flex items-center gap-1.5 text-sm text-ink-subtle">
              <Check aria-hidden="true" className="size-4 text-success" />
              {t(`checks.${result.check}.label`)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
