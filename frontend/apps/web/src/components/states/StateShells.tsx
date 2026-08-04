import { Callout, EmptyState } from '@repo/ui';
import { useTranslations } from 'next-intl';
import { CheckCircle2, WifiOff } from 'lucide-react';

import type { ReactNode } from 'react';

/**
 * The D-5 states that are not route boundaries, wrapped once so their rules cannot be
 * forgotten screen by screen. The visual shells come from `@repo/ui`; what is added here is
 * the copy discipline from §8.3.
 */

export interface EmptyNoticeProps {
  /** What to do next — never a report of emptiness. "Add your first piece", not "No results". */
  title: string;
  description: string;
  /** The control that performs the next action. An empty state without one is unfinished. */
  action?: ReactNode;
  illustration?: ReactNode;
}

/**
 * Empty — D-5, D-6. Directs the user to the next action.
 *
 * `action` is strongly encouraged: a consumer with no shortlist must be shown how to start,
 * not told that her shortlist is empty.
 */
export function EmptyNotice({ title, description, action, illustration }: EmptyNoticeProps) {
  return (
    <EmptyState tone="neutral" title={title} description={description} action={action}>
      {illustration}
    </EmptyState>
  );
}

export interface SuccessNoticeProps {
  /**
   * Confirms in the same words as the action that caused it — the control that says Publish
   * confirms Published (D-13).
   */
  title: string;
  description?: string;
  /** The undo or the next step, where one exists. */
  action?: ReactNode;
}

/** Success — D-5, D-13. Announced politely so it is heard, not only seen (D-20). */
export function SuccessNotice({ title, description, action }: SuccessNoticeProps) {
  return (
    <Callout variant="success" role="status" aria-live="polite" title={title}>
      {description}
      {action}
    </Callout>
  );
}

export interface OfflineNoticeProps {
  onRetry?: ReactNode;
}

/**
 * Offline / network failure — the `NETWORK_ERROR` state required on any screen that mutates
 * (§8.2). The copy is the client-side addition named in §6.4 and is translated locally.
 */
export function OfflineNotice({ onRetry }: OfflineNoticeProps) {
  const t = useTranslations('errors.offline');

  return (
    <Callout variant="warning" role="status" aria-live="polite" title={t('title')}>
      <span className="inline-flex items-center gap-2">
        <WifiOff aria-hidden="true" className="size-4" />
        {t('body')}
      </span>
      {onRetry}
    </Callout>
  );
}

export interface SavedIndicatorProps {
  label: string;
}

/** The quiet inline confirmation used after an auto-saving edit. */
export function SavedIndicator({ label }: SavedIndicatorProps) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2 text-sm">
      <CheckCircle2 aria-hidden="true" className="size-4" />
      {label}
    </span>
  );
}
