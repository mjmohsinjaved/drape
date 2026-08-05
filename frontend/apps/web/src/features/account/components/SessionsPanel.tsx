'use client';

import { useRouter } from 'next/navigation';

import { Laptop } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Badge, Button, Card, CardContent, EmptyState } from '@repo/ui';

import {
  useRevokeOtherSessions,
  useRevokeSession,
} from '@/features/account/hooks/use-account-mutations';
import { FormErrorFeedback } from '@/features/auth/components/FormFeedback';

import type { SessionSummary } from '@/features/auth/api/types';

/**
 * The caller's own live sessions — `GET /auth/sessions`, `DELETE /auth/sessions[/:sessionId]`.
 *
 * The address is already truncated server-side and the row shows a device, not a location
 * (E-12). "This device" is labelled so nobody signs themselves out by accident, and its revoke
 * control is absent rather than disabled — a control that cannot be used should not be offered.
 *
 * ### The six D-5 states
 * - **default** — the list.
 * - **loading** — the busy revoke buttons; the list itself is server-rendered.
 * - **empty** — impossible in practice (reading this page needs a session), but handled:
 *   the shell says what to do rather than reporting emptiness (D-6).
 * - **error** — a failed revoke, with a retry.
 * - **permission denied** — a suspended account renders the S-9 shell.
 * - **success** — the row disappears; the refreshed list is the confirmation.
 */
export interface SessionsPanelProps {
  sessions: SessionSummary[];
}

export function SessionsPanel({ sessions }: SessionsPanelProps) {
  const t = useTranslations('account.sessions');
  const format = useFormatter();
  const router = useRouter();

  const revokeOne = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();

  const others = sessions.filter((session) => !session.current);
  const error = revokeOne.error ?? revokeOthers.error;

  function refreshAfter() {
    router.refresh();
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        size="inline"
        headingLevel="h3"
        title={t('emptyTitle')}
        description={t('emptyBody')}
        action={
          <Button
            variant="secondary"
            onClick={() => {
              router.refresh();
            }}
          >
            {t('refreshAction')}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <FormErrorFeedback
          error={error}
          onRetry={
            error.isRetryable
              ? () => {
                  revokeOne.reset();
                  revokeOthers.reset();
                }
              : undefined
          }
        />
      ) : null}

      <ul className="flex flex-col gap-3">
        {sessions.map((session) => (
          <li key={session.id}>
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div className="flex min-w-0 items-start gap-3">
                  <Laptop aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ink-subtle" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                      <span className="truncate">{session.userAgent ?? t('unknownDevice')}</span>
                      {session.current ? <Badge variant="outline">{t('thisDevice')}</Badge> : null}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {t('meta', {
                        ip: session.ip,
                        seen: format.dateTime(new Date(session.lastSeenAt), 'short'),
                      })}
                    </p>
                  </div>
                </div>

                {session.current ? null : (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={revokeOne.isPending && revokeOne.variables?.sessionId === session.id}
                    loadingLabel={t('revoking')}
                    onClick={() => {
                      if (revokeOne.isPending) return;
                      revokeOne.mutate({ sessionId: session.id }, { onSuccess: refreshAfter });
                    }}
                  >
                    {t('revokeAction')}
                  </Button>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {others.length > 0 ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={revokeOthers.isPending}
          loadingLabel={t('revoking')}
          onClick={() => {
            if (revokeOthers.isPending) return;
            revokeOthers.mutate(undefined, { onSuccess: refreshAfter });
          }}
        >
          {t('revokeOthersAction')}
        </Button>
      ) : null}
    </div>
  );
}
