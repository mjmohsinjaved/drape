'use client';

import * as React from 'react';

import { cn } from '../../lib/cn';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grow with the content instead of scrolling. Capped by `maxRows`. */
  autoResize?: boolean;
  /** Upper bound for `autoResize`, in rows. */
  maxRows?: number;
}

/**
 * A multi-line text control — enquiry notes, garment descriptions, the admin's reply to a
 * shopper.
 *
 * Resizing is vertical only: a horizontally resizable textarea breaks the column it sits in and
 * is a nuisance on a phone. Wrap it in `FormField` for the label, hint and error wiring.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, autoResize = false, maxRows = 12, rows = 4, onInput, ...props },
  forwardedRef,
) {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

  const setRefs = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  const resize = React.useCallback(() => {
    const node = innerRef.current;
    if (!node || !autoResize) return;
    node.style.height = 'auto';
    const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight) || 24;
    node.style.height = `${String(Math.min(node.scrollHeight, lineHeight * maxRows))}px`;
  }, [autoResize, maxRows]);

  React.useEffect(resize, [resize, props.value]);

  return (
    <textarea
      ref={setRefs}
      rows={rows}
      onInput={(event) => {
        resize();
        onInput?.(event);
      }}
      className={cn(
        'flex w-full min-w-0 resize-y rounded-md border border-line-strong bg-surface',
        'px-3 py-2.5 font-body text-base text-ink',
        'transition-[border-color,box-shadow] duration-fast ease-out',
        'placeholder:text-ink-subtle',
        'hover:border-ink-subtle',
        'focus-visible:border-brand focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle',
        'read-only:bg-surface-sunken',
        'aria-[invalid=true]:border-danger',
        autoResize && 'resize-none overflow-hidden',
        className,
      )}
      {...props}
    />
  );
});
