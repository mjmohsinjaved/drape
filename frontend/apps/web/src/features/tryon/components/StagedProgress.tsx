'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useReducedMotion } from '@/hooks/use-reduced-motion';

import type { TryOnStage } from '@/features/tryon/api/types';

const STAGES: readonly TryOnStage[] = ['QUEUED', 'UPLOADING', 'GENERATING', 'FINISHING'];

export interface StagedProgressProps {
  stage: TryOnStage;
  elapsedMs: number;
  /** Freezes the sequence at 100% when the job has landed. */
  complete?: boolean;
}

/**
 * The seven-second wait — PRD C-19, §10.3.
 *
 * > "A staged, progressing sequence, not a spinner."
 *
 * So: four named stages, each with its own line of microcopy, driven by the `stage` events the
 * API emits at least every two seconds (§5.11). Completed stages carry a tick, the current one
 * is announced, the rest are dimmed. Nothing here spins.
 *
 * The bar creeps *within* a stage as well as between them, because a bar that only moves four
 * times in seven seconds reads as stuck. The creep is capped below the next stage's floor so it
 * can never run ahead of what is actually happening — a progress bar that lies is worse than no
 * progress bar.
 *
 * `prefers-reduced-motion` removes the width transition entirely (D-11): the bar still shows the
 * true position, it simply arrives there rather than sliding.
 */
export function StagedProgress({ stage, elapsedMs, complete = false }: StagedProgressProps) {
  const t = useTranslations('tryon.wait');
  const reducedMotion = useReducedMotion();

  const index = Math.max(0, STAGES.indexOf(stage));
  const floor = (index / STAGES.length) * 100;
  const ceiling = ((index + 1) / STAGES.length) * 100;

  // Seven seconds is the expected end-to-end time, so elapsed/7000 is a fair guess at how far
  // through the whole sequence we are. It is clamped into the current stage's band so the
  // guess can never contradict the stage the server has actually reported.
  const guess = Math.min(100, (elapsedMs / 7000) * 100);
  const percent = complete ? 100 : Math.min(Math.max(guess, floor + 2), ceiling - 2);

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

      {/* The announcement a screen reader hears; the visible list below is the same information. */}
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
                <p
                  className={
                    current || done ? 'text-sm font-medium' : 'text-sm text-ink-subtle'
                  }
                >
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
