'use client';

import { useCallback, useId, useRef, useState } from 'react';

import Link from 'next/link';

import { AlertTriangle, Camera, Check, Crop } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Callout,
  Checkbox,
  ImageCropperDialog,
  Input,
  Label,
  ProgressBar,
  SuccessState,
} from '@repo/ui';

import { usePhotoUpload } from '@/features/photos/hooks/use-photo-upload';
import { ACCEPTED_MIME_TYPES ,type  PhotoCheckResult } from '@/features/photos/lib/validate-photo';
import { useErrorMessage } from '@/features/tryon/hooks/use-error-message';
import {
  PERSON_ASPECT,
  PERSON_PHOTO_MAX_EDGE,
  PERSON_PHOTO_MIN_LONG_EDGE,
  PERSON_PHOTO_OUTPUT_TYPE,
  PERSON_RATIO_LABEL,
} from '@/lib/image-frame';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface PhotoUploaderProps {
  locale: Locale;
  isFirstPhoto: boolean;
  returnTo?: string;
}

export function PhotoUploader({ locale, isFirstPhoto, returnTo }: PhotoUploaderProps) {
  const t = useTranslations('photos');
  const messageFor = useErrorMessage('photos');
  const upload = usePhotoUpload();

  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const activeId = useId();

  const [label, setLabel] = useState('');
  const [activate, setActivate] = useState(true);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [cropping, setCropping] = useState(false);

  const choose = useCallback((): void => {
    inputRef.current?.click();
  }, []);

  const onFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      setSourceFile(file);
      setCropping(true);
    },
    [],
  );

  const onCropConfirmed = useCallback(
    (result: { file: File }): void => {
      setCropping(false);
      upload.select(result.file);
    },
    [upload],
  );

  const onCropDismissed = useCallback((): void => {
    setCropping(false);
    if (upload.previewUrl === null) setSourceFile(null);
  }, [upload.previewUrl]);

  const recrop = useCallback((): void => {
    if (sourceFile !== null) setCropping(true);
  }, [sourceFile]);

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
      <ImageCropperDialog
        open={cropping}
        onOpenChange={onCropDismissed}
        file={sourceFile}
        aspect={PERSON_ASPECT}
        maxEdge={PERSON_PHOTO_MAX_EDGE}
        recommendedMinEdge={PERSON_PHOTO_MIN_LONG_EDGE}
        outputType={PERSON_PHOTO_OUTPUT_TYPE}
        outputBaseName="photo"
        onConfirm={onCropConfirmed}
        title={t('crop.title')}
        description={t('crop.description')}
        aspectLabel={t('crop.aspect', { ratio: PERSON_RATIO_LABEL })}
        confirmLabel={t('crop.confirm')}
        cancelLabel={t('crop.cancel')}
        stageLabel={t('crop.stage')}
        zoomLabel={t('crop.zoom')}
        zoomInLabel={t('crop.zoomIn')}
        zoomOutLabel={t('crop.zoomOut')}
        rotateLeftLabel={t('crop.rotateLeft')}
        rotateRightLabel={t('crop.rotateRight')}
        resetLabel={t('crop.reset')}
        hint={t('crop.hint')}
        loadingLabel={t('crop.loading')}
        workingLabel={t('crop.working')}
        formatOutput={(width, height) => t('crop.output', { width, height })}
        belowMinTitle={t('crop.belowMinTitle')}
        belowMinBody={(longEdge, minimum) => t('crop.belowMinBody', { longEdge, minimum })}
        tooSmallTitle={t('crop.tooSmallTitle')}
        tooSmallBody={(longEdge, minimum) => t('crop.tooSmallBody', { longEdge, minimum })}
        decodeFailedTitle={t('crop.decodeFailedTitle')}
        decodeFailedBody={t('crop.decodeFailedBody')}
      />
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
            <div className="aspect-frame w-full overflow-hidden rounded-xl bg-surface-sunken">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob: or short-lived signed URL; the optimiser must not touch it. */}
              <img
                src={upload.previewUrl}
                alt={t('upload.previewAlt')}
                className="size-full object-cover"
              />
            </div>

            {sourceFile === null || busy ? null : (
              <Button
                type="button"
                variant="secondary"
                fullWidth
                startIcon={<Crop aria-hidden="true" />}
                onClick={recrop}
              >
                {t('upload.recrop')}
              </Button>
            )}
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
