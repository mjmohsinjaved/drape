'use client';

import * as React from 'react';

import { cn } from '../../lib/cn';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../alert-dialog/AlertDialog';
import { Button } from '../button/Button';
import { Input } from '../input/Input';
import { Label } from '../label/Label';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The heading. Name the action and the item explicitly — "Delete Anarkali in raw silk", never
   * "Are you sure?" (D-17).
   */
  title: React.ReactNode;
  /** What will happen, and what it costs. State the consequence, do not soften it. */
  description?: React.ReactNode;
  /**
   * The confirm button's label. Use the same verb the trigger used, so the flow reads
   * Delete -> Delete -> Deleted (D-13).
   */
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive by default — this component exists for destructive work. */
  tone?: 'danger' | 'primary';
  /**
   * Required for a destructive action on a named object (D-17): the user must type this string
   * before the confirm button enables. Pass the garment name, the consumer's name, the category.
   */
  confirmationText?: string;
  /** Label above the type-to-confirm field. `{name}` is replaced with `confirmationText`. */
  confirmationPrompt?: string;
  /** Mismatch message. Never blames the user (D-7). */
  confirmationMismatchHint?: string;
  /** Case-sensitive matching. Off by default: exact casing is a spelling test, not a safeguard. */
  caseSensitive?: boolean;
  onConfirm: () => void | Promise<void>;
  /** Keeps the dialog open with a spinner while the mutation runs. */
  loading?: boolean;
  children?: React.ReactNode;
}

/**
 * The one confirmation surface in Drape.
 *
 * Pass `confirmationText` and it becomes the type-the-name dialog D-17 requires for deleting a
 * garment or a consumer. Leave it off and it is an ordinary two-button confirmation for the less
 * severe cases (discarding an unsaved draft, revoking a share link).
 *
 * Deliberate behaviours:
 * - the confirm button is disabled until the typed name matches, so a mis-aimed Enter cannot
 *   destroy anything;
 * - the name is echoed in the prompt so the user can see exactly what they are about to affect;
 * - cancel is the initially focused control.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  confirmationText,
  confirmationPrompt = 'To confirm, type {name}',
  confirmationMismatchHint = 'The name does not match yet. Type it exactly as shown above.',
  caseSensitive = false,
  onConfirm,
  loading = false,
  children,
}: ConfirmDialogProps): React.JSX.Element {
  const [typed, setTyped] = React.useState('');
  const inputId = React.useId();
  const hintId = `${inputId}-hint`;

  // Reset between openings, so a previously typed name never carries over to another item.
  React.useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const normalise = (value: string): string =>
    caseSensitive ? value.trim() : value.trim().toLocaleLowerCase();

  const requiresTyping = Boolean(confirmationText);
  const matches = requiresTyping ? normalise(typed) === normalise(confirmationText ?? '') : true;
  const showMismatch = requiresTyping && typed.length > 0 && !matches;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>

        {children}

        {requiresTyping ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={inputId}>
              {confirmationPrompt.split('{name}')[0]}
              <span className="font-mono font-semibold text-ink">{confirmationText}</span>
              {confirmationPrompt.split('{name}')[1]}
            </Label>
            <Input
              id={inputId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby={showMismatch ? hintId : undefined}
              aria-invalid={showMismatch || undefined}
            />
            {showMismatch ? (
              <p id={hintId} className="text-xs text-ink-muted">
                {confirmationMismatchHint}
              </p>
            ) : null}
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary" disabled={loading}>
              {cancelLabel}
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              disabled={!matches || loading}
              loading={loading}
              loadingLabel={confirmLabel}
              onClick={(event) => {
                // Keep the dialog mounted while the mutation runs; the caller closes it on success.
                event.preventDefault();
                void onConfirm();
              }}
              className={cn(!matches && 'cursor-not-allowed')}
            >
              {confirmLabel}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Named export for the D-17 case, so a reviewer can grep for it and see every place a
 * type-the-name confirmation is required. It is the same component with the prop mandatory.
 */
export function TypeToConfirmDialog(
  props: ConfirmDialogProps & { confirmationText: string },
): React.JSX.Element {
  return <ConfirmDialog {...props} />;
}
