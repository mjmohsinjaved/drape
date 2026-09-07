'use client';

import * as React from 'react';

import { Maximize2, Minus, Plus, RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import Cropper, { type Area, type MediaSize, type Point } from 'react-easy-crop';

import { cn } from '../../lib/cn';
import { Button } from '../button/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../dialog/Dialog';
import { IconButton } from '../icon-button/IconButton';
import { Slider } from '../slider/Slider';
import { Spinner } from '../spinner/Spinner';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

import { cropImageToFile, largestCrop, outputSize, type CroppedImage } from './crop-image';

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.2;
const QUARTER_TURN = 90;

export interface ImageCropperDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  file: File | null;

  aspect: number;
  maxEdge: number;
  recommendedMinEdge?: number;

  outputType?: 'image/jpeg' | 'image/png';
  outputQuality?: number;
  outputBaseName?: string;

  onConfirm: (result: CroppedImage) => void;

  title: string;
  description?: React.ReactNode;
  stepLabel?: React.ReactNode;
  aspectLabel: string;
  confirmLabel: string;
  cancelLabel: string;
  stageLabel: string;
  zoomLabel: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  rotateLeftLabel: string;
  rotateRightLabel: string;
  resetLabel: string;
  hint?: React.ReactNode;
  loadingLabel: string;
  workingLabel: string;
  formatOutput: (width: number, height: number) => string;
  belowMinTitle?: string;
  belowMinBody?: (longEdge: number, minimum: number) => string;
  tooSmallTitle?: string;
  tooSmallBody?: (longEdge: number, minimum: number) => string;
  decodeFailedTitle: string;
  decodeFailedBody: string;
}

interface Transform {
  crop: Point;
  zoom: number;
  rotation: number;
}

const INITIAL: Transform = { crop: { x: 0, y: 0 }, zoom: MIN_ZOOM, rotation: 0 };

export function ImageCropperDialog({
  open,
  onOpenChange,
  file,
  aspect,
  maxEdge,
  recommendedMinEdge,
  outputType = 'image/jpeg',
  outputQuality = 0.92,
  outputBaseName = 'photo',
  onConfirm,
  title,
  description,
  stepLabel,
  aspectLabel,
  confirmLabel,
  cancelLabel,
  stageLabel,
  zoomLabel,
  zoomInLabel,
  zoomOutLabel,
  rotateLeftLabel,
  rotateRightLabel,
  resetLabel,
  hint,
  loadingLabel,
  workingLabel,
  formatOutput,
  belowMinTitle,
  belowMinBody,
  tooSmallTitle,
  tooSmallBody,
  decodeFailedTitle,
  decodeFailedBody,
}: ImageCropperDialogProps): React.JSX.Element {
  const [source, setSource] = React.useState<string | null>(null);
  const [transform, setTransform] = React.useState<Transform>(INITIAL);
  const [area, setArea] = React.useState<Area | null>(null);
  const [media, setMedia] = React.useState<MediaSize | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [working, setWorking] = React.useState(false);

  React.useEffect(() => {
    if (file === null) {
      setSource(null);
      return undefined;
    }

    const url = URL.createObjectURL(file);
    setSource(url);
    setTransform(INITIAL);
    setArea(null);
    setMedia(null);
    setFailed(false);
    setWorking(false);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const onCropChange = React.useCallback((crop: Point): void => {
    setTransform((current) => ({ ...current, crop }));
  }, []);

  const onZoomChange = React.useCallback((zoom: number): void => {
    setTransform((current) => ({ ...current, zoom }));
  }, []);

  const onCropComplete = React.useCallback((_: Area, pixels: Area): void => {
    setArea(pixels);
  }, []);

  const nudgeZoom = React.useCallback((delta: number): void => {
    setTransform((current) => ({
      ...current,
      zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((current.zoom + delta) * 100) / 100)),
    }));
  }, []);

  const turn = React.useCallback((degrees: number): void => {
    setTransform((current) => ({
      ...current,
      rotation: (current.rotation + degrees + 360) % 360,
    }));
  }, []);

  const reset = React.useCallback((): void => {
    setTransform(INITIAL);
  }, []);

  const dismiss = React.useCallback((): void => {
    onOpenChange(false);
  }, [onOpenChange]);

  const confirm = React.useCallback((): void => {
    if (file === null || area === null) return;

    setWorking(true);
    void cropImageToFile({
      file,
      area,
      rotation: transform.rotation,
      aspect,
      maxEdge,
      type: outputType,
      quality: outputQuality,
      fileName: `${outputBaseName}.${outputType === 'image/png' ? 'png' : 'jpg'}`,
    })
      .then((result) => {
        setWorking(false);
        onConfirm(result);
      })
      .catch(() => {
        setWorking(false);
        setFailed(true);
      });
  }, [
    area,
    aspect,
    file,
    maxEdge,
    onConfirm,
    outputBaseName,
    outputQuality,
    outputType,
    transform.rotation,
  ]);

  const output = area === null ? null : outputSize(area, aspect, maxEdge);
  const outputLongEdge = output === null ? 0 : Math.max(output.width, output.height);

  const ceiling =
    media === null
      ? null
      : largestCrop(
          { width: media.naturalWidth, height: media.naturalHeight },
          transform.rotation,
          aspect,
        );
  const ceilingLongEdge = ceiling === null ? 0 : Math.max(ceiling.width, ceiling.height);

  const short = recommendedMinEdge !== undefined && output !== null && outputLongEdge < recommendedMinEdge;
  const hopeless =
    recommendedMinEdge !== undefined && ceiling !== null && ceilingLongEdge < recommendedMinEdge;

  const ready = source !== null && media !== null && !failed;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" closeLabel={cancelLabel} className="gap-0 overflow-hidden p-0">
        <DialogHeader>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <DialogTitle>{title}</DialogTitle>
            {stepLabel === undefined ? null : (
              <span className="text-sm tabular-nums text-ink-muted">{stepLabel}</span>
            )}
          </div>
          {description === undefined ? null : <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {failed ? (
            <div className="mx-6 my-2 rounded-lg border border-danger/40 bg-danger-tint p-6">
              <h3 className="text-base font-medium text-ink">{decodeFailedTitle}</h3>
              <p className="mt-1 text-sm text-pretty text-ink-muted">{decodeFailedBody}</p>
            </div>
          ) : (
            <>
              <div className="relative h-crop-stage w-full shrink-0 bg-stage">
                {source === null ? null : (
                  <Cropper
                    image={source}
                    crop={transform.crop}
                    zoom={transform.zoom}
                    rotation={transform.rotation}
                    aspect={aspect}
                    minZoom={MIN_ZOOM}
                    maxZoom={MAX_ZOOM}
                    zoomSpeed={0.25}
                    restrictPosition
                    objectFit="contain"
                    showGrid
                    onCropChange={onCropChange}
                    onZoomChange={onZoomChange}
                    onCropComplete={onCropComplete}
                    onMediaLoaded={setMedia}
                    mediaProps={{
                      onError: () => {
                        setFailed(true);
                      },
                    }}
                    cropperProps={{ 'aria-label': stageLabel }}
                    style={{
                      cropAreaStyle: {
                        color: 'var(--color-stage-scrim)',
                        border: '1px solid var(--color-stage-line)',
                      },
                    }}
                  />
                )}

                {ready ? (
                  <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
                    <span className="rounded-full bg-stage-scrim px-2.5 py-1 text-xs font-medium text-stage-ink backdrop-blur-sm">
                      {aspectLabel}
                    </span>
                    {output === null ? null : (
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-1 text-xs font-medium tabular-nums backdrop-blur-sm',
                          short
                            ? 'bg-warning text-brand-fg'
                            : 'bg-stage-scrim text-stage-ink',
                        )}
                      >
                        {formatOutput(output.width, output.height)}
                      </span>
                    )}
                  </div>
                ) : null}

                {source !== null && media === null ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stage"
                  >
                    <Spinner className="text-stage-ink" />
                    <span className="text-xs text-stage-ink">{loadingLabel}</span>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-3 px-6 pt-4">
                <div className="flex items-center gap-1">
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={zoomOutLabel}
                    icon={<Minus />}
                    disabled={!ready || transform.zoom <= MIN_ZOOM}
                    onClick={() => {
                      nudgeZoom(-ZOOM_STEP);
                    }}
                  />
                  <Slider
                    className="mx-1 flex-1"
                    value={[transform.zoom]}
                    min={MIN_ZOOM}
                    max={MAX_ZOOM}
                    step={0.01}
                    disabled={!ready}
                    thumbLabels={[zoomLabel]}
                    formatValue={(value) => `${String(Math.round(value * 100))}%`}
                    onValueChange={([value]) => {
                      if (value !== undefined) onZoomChange(value);
                    }}
                  />
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={zoomInLabel}
                    icon={<Plus />}
                    disabled={!ready || transform.zoom >= MAX_ZOOM}
                    onClick={() => {
                      nudgeZoom(ZOOM_STEP);
                    }}
                  />

                  <span aria-hidden="true" className="mx-2 h-6 w-px shrink-0 bg-line" />

                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={rotateLeftLabel}
                    icon={<RotateCcw />}
                    disabled={!ready}
                    onClick={() => {
                      turn(-QUARTER_TURN);
                    }}
                  />
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={rotateRightLabel}
                    icon={<RotateCw />}
                    disabled={!ready}
                    onClick={() => {
                      turn(QUARTER_TURN);
                    }}
                  />
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={resetLabel}
                    icon={<Undo2 />}
                    disabled={!ready || isInitial(transform)}
                    onClick={reset}
                  />
                </div>

                {hint === undefined ? null : (
                  <p className="flex items-center gap-1.5 text-xs text-ink-subtle">
                    <Maximize2 aria-hidden="true" className="size-3.5 shrink-0" />
                    {hint}
                  </p>
                )}

                <div aria-live="polite">
                  {short && !hopeless && belowMinTitle !== undefined && belowMinBody !== undefined ? (
                    <Note title={belowMinTitle}>
                      {belowMinBody(outputLongEdge, recommendedMinEdge ?? 0)}
                    </Note>
                  ) : null}
                  {hopeless && tooSmallTitle !== undefined && tooSmallBody !== undefined ? (
                    <Note title={tooSmallTitle}>
                      {tooSmallBody(ceilingLongEdge, recommendedMinEdge ?? 0)}
                    </Note>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={dismiss}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!ready || area === null}
            loading={working}
            loadingLabel={workingLabel}
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>

        <VisuallyHidden aria-live="polite">{working ? workingLabel : ''}</VisuallyHidden>
      </DialogContent>
    </Dialog>
  );
}

function isInitial(transform: Transform): boolean {
  return (
    transform.zoom === INITIAL.zoom &&
    transform.rotation === INITIAL.rotation &&
    transform.crop.x === 0 &&
    transform.crop.y === 0
  );
}

function Note({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-warning/40 bg-warning-tint px-3 py-2">
      <p className="text-xs font-medium text-ink">{title}</p>
      <p className="mt-0.5 text-xs text-pretty text-ink-muted">{children}</p>
    </div>
  );
}
