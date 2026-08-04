import * as React from 'react';

import { cn } from '../../lib/cn';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

/** Keys that should render as a symbol rather than a word. */
const KEY_GLYPHS: Readonly<Record<string, string>> = {
  enter: '↵',
  return: '↵',
  shift: '⇧',
  tab: '⇥',
  escape: 'Esc',
  esc: 'Esc',
  backspace: '⌫',
  delete: 'Del',
  space: 'Space',
  up: '↑',
  down: '↓',
  /* Deliberately NOT mirrored under RTL: these name physical keys on a keyboard,
     and the Left key is the Left key in every locale. */
  left: '←',
  right: '→',
  cmd: '⌘',
  meta: '⌘',
  alt: 'Alt',
  ctrl: 'Ctrl',
  control: 'Ctrl',
};

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  /** Literal key text when you are not using `KeyboardShortcut`. */
  children?: React.ReactNode;
}

/** A single key cap. */
export const Kbd = React.forwardRef<HTMLElement, KbdProps>(function Kbd(
  { className, children, ...props },
  ref,
) {
  return (
    <kbd
      ref={ref}
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-xs border border-line-strong',
        'bg-surface-raised px-1.5 py-0.5 font-mono text-2xs leading-none text-ink-muted shadow-xs',
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
});

export interface KeyboardShortcutProps extends React.HTMLAttributes<HTMLElement> {
  /**
   * Keys in press order, e.g. `['j']`, `['ctrl', 'k']`, `['/']`. Matches the admin shortcuts in
   * §6.2: `j`/`k` navigate rows, `Enter` opens, `a` approves a test render, `p` publishes,
   * `/` focuses search (D-19).
   */
  keys: readonly string[];
  /** What the shortcut does, announced to assistive tech: "Publish". */
  label?: string;
  /** Separator between caps. `+` for a chord, `then` for a sequence. */
  separator?: React.ReactNode;
}

/**
 * The hint form: a row of key caps with an accessible description, for menu items, tooltips and
 * the admin shortcut sheet.
 *
 * It is a hint only. The key handler lives with the surface that owns the behaviour — a
 * component that renders a hint must never also bind the key, or two surfaces end up fighting
 * over `/`.
 */
export const KeyboardShortcut = React.forwardRef<HTMLElement, KeyboardShortcutProps>(
  function KeyboardShortcut({ className, keys, label, separator = null, ...props }, ref) {
    return (
      <span
        ref={ref as React.Ref<HTMLSpanElement>}
        className={cn('inline-flex items-center gap-1', className)}
        {...props}
      >
        {label ? <VisuallyHidden>{`${label}, keyboard shortcut: `}</VisuallyHidden> : null}
        {keys.map((key, index) => (
          <React.Fragment key={`${key}-${String(index)}`}>
            {index > 0 && separator ? (
              <span aria-hidden="true" className="text-2xs text-ink-subtle">
                {separator}
              </span>
            ) : null}
            <Kbd>{KEY_GLYPHS[key.toLowerCase()] ?? key.toUpperCase()}</Kbd>
          </React.Fragment>
        ))}
      </span>
    );
  },
);
