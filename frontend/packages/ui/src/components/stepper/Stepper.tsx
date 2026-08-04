'use client';

import * as React from 'react';

import { Check } from 'lucide-react';

import { cn } from '../../lib/cn';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export interface StepperStep {
  id: string;
  /** The step name. A noun phrase for the thing produced: "Photo", "Consent", "Try-on". */
  label: React.ReactNode;
  /** One short line under the label. */
  description?: React.ReactNode;
}

export interface StepperProps extends Omit<React.ComponentPropsWithoutRef<'nav'>, 'onSelect'> {
  steps: readonly StepperStep[];
  /** 0-based index of the step the user is on. */
  current: number;
  /** Landmark name. Translate it. */
  label?: string;
  orientation?: 'horizontal' | 'vertical';
  /** Makes completed steps clickable so the user can go back. Forward steps stay disabled. */
  onStepSelect?: (index: number, step: StepperStep) => void;
  /** Announced suffixes. Translate them. */
  completedLabel?: string;
  currentLabel?: string;
  upcomingLabel?: string;
}

/**
 * Progress through a multi-step flow: the consent-then-photo-then-try-on path, and the admin's
 * first-run route from empty catalog to first published garment (PRD §10.3).
 *
 * State is carried by the marker (a tick, a filled dot, an outline) as well as by colour, and
 * spelled out for assistive tech — a stepper that only changes hue tells a colour-blind user
 * nothing (D-20).
 */
export const Stepper = React.forwardRef<HTMLElement, StepperProps>(function Stepper(
  {
    className,
    steps,
    current,
    label = 'Progress',
    orientation = 'horizontal',
    onStepSelect,
    completedLabel = 'completed',
    currentLabel = 'current step',
    upcomingLabel = 'upcoming',
    ...props
  },
  ref,
) {
  return (
    <nav ref={ref} aria-label={label} className={className} {...props}>
      <ol
        className={cn(
          'flex',
          orientation === 'horizontal' ? 'flex-row items-start gap-2' : 'flex-col gap-4',
        )}
      >
        {steps.map((step, index) => {
          const complete = index < current;
          const active = index === current;
          const clickable = Boolean(onStepSelect) && complete;

          const marker = (
            <span
              aria-hidden="true"
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                complete && 'border-brand bg-brand text-brand-fg',
                active && 'border-brand bg-brand-tint text-brand',
                !complete && !active && 'border-line-strong bg-surface text-ink-subtle',
              )}
            >
              {complete ? <Check className="size-4" strokeWidth={3} /> : index + 1}
            </span>
          );

          const body = (
            <span className="flex min-w-0 flex-col gap-0.5 text-start">
              <span
                className={cn(
                  'text-sm font-medium',
                  active ? 'text-ink' : complete ? 'text-ink-muted' : 'text-ink-subtle',
                )}
              >
                {step.label}
                <VisuallyHidden>
                  {` (${complete ? completedLabel : active ? currentLabel : upcomingLabel})`}
                </VisuallyHidden>
              </span>
              {step.description ? (
                <span className="text-xs text-ink-subtle">{step.description}</span>
              ) : null}
            </span>
          );

          return (
            <li
              key={step.id}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex min-w-0 items-start gap-3',
                orientation === 'horizontal' && 'flex-1',
              )}
            >
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onStepSelect?.(index, step)}
                  className={cn(
                    'flex min-h-11 min-w-0 items-start gap-3 rounded-md text-start',
                    'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
                  )}
                >
                  {marker}
                  {body}
                </button>
              ) : (
                <span className="flex min-w-0 items-start gap-3">
                  {marker}
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
});
