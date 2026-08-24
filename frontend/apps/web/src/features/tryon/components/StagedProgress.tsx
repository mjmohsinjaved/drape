'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useReducedMotion } from '@/hooks/use-reduced-motion';

import type { TryOnStage } from '@/features/tryon/api/types';

const STAGES: readonly TryOnStage[] = ['QUEUED', 'UPLOADING', 'GENERATING', 'FINISHING'];

const CREEP_TAU_MS = 25_000;

export interface StagedProgressProps {
  stage: TryOnStage;
  elapsedMs: number;
  complete?: boolean;
}

export function StagedProgress({ stage, elapsedMs, complete = false }: StagedProgressProps) {
  const t = useTranslations('tryon.wait');
  const reducedMotion = useReducedMotion();

  const index = Math.max(0, STAGES.indexOf(stage));
  const floor = (index / STAGES.length) * 100;
  const ceiling = ((index + 1) / STAGES.length) * 100;

  const span = ceiling - floor;
  const creep = span * (1 - Math.exp(-elapsedMs / CREEP_TAU_MS));
  const percent = complete ? 100 : Math.min(floor + Math.max(creep, 2), ceiling - 2);

  const currentLabel = t(`stages.${stage}.label`);
  const currentBody = t(`stages.${stage}.body`);

  return (
    <div className="flex flex-col gap-6">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={currentLabel}
        aria-label={t('progressLabel')}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
      >
        <div
          className={
            reducedMotion
              ? 'h-full rounded-full bg-brand'
              : 'h-full rounded-full bg-brand transition-[width] duration-slow ease-out'
          }
          style={{ inlineSize: `${String(percent)}%` }}
        />
      </div>

      <p aria-live="polite" className="sr-only">
        {currentLabel}. {currentBody}
      </p>

      <ol className="flex flex-col gap-4">
        {STAGES.map((candidate, candidateIndex) => {
          const done = complete || candidateIndex < index;
          const current = !complete && candidateIndex === index;

          return (
            <li key={candidate} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={[
                  'mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs',
                  done
                    ? 'bg-brand text-brand-fg'
                    : current
                      ? 'bg-brand-tint text-brand'
                      : 'bg-surface-sunken text-ink-subtle',
                ].join(' ')}
              >
                {done ? <Check className="size-3.5" /> : candidateIndex + 1}
              </span>

              <div className="flex flex-col gap-0.5">
                <p className={current || done ? 'text-sm font-medium' : 'text-sm text-ink-subtle'}>
                  {t(`stages.${candidate}.label`)}
                </p>
                {current ? (
                  <p className="max-w-prose text-sm text-ink-muted">
                    {t(`stages.${candidate}.body`)}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
