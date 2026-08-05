'use client';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

import { SwitchField } from '@repo/ui';

import { SavedIndicator } from '@/components/states';
import { useUpdateNotificationPreferences } from '@/features/account/hooks/use-account-mutations';
import { FormErrorFeedback } from '@/features/auth/components/FormFeedback';

import type { NotificationPreferences } from '@repo/api-client';

/**
 * Notification preferences — C-7.
 *
 * A switch takes effect immediately, so there is no Save button: each toggle sends the one key
 * it owns, and the API writes only the keys present. A client that has never heard of a fifth
 * preference can therefore never reset it.
 *
 * The descriptions say what each notification actually contains, named by what she controls
 * rather than by how the system is built (D-14).
 *
 * ### The six D-5 states
 * - **default** — the four switches, seeded from the server-rendered read.
 * - **loading** — the switch is disabled while its own write is in flight.
 * - **empty** — not applicable; the set of preferences is fixed.
 * - **error** — the write failed, with a retry, and the toggle rolls back to the saved value.
 * - **permission denied** — a suspended account renders the S-9 shell.
 * - **success** — the quiet inline "Saved" that an auto-saving control earns.
 */
export interface NotificationPreferencesFormProps {
  preferences: NotificationPreferences;
}

const TOGGLES = [
  'emailOnResultReady',
  'emailOnEnquiryUpdate',
  'smsOnEnquiryUpdate',
  'emailOnNewArrivals',
] as const;

export function NotificationPreferencesForm({ preferences }: NotificationPreferencesFormProps) {
  const t = useTranslations('account.notificationPrefs');
  const update = useUpdateNotificationPreferences();

  const [values, setValues] = useState<NotificationPreferences>(preferences);
  const [pendingKey, setPendingKey] = useState<keyof NotificationPreferences | null>(null);

  function toggle(key: keyof NotificationPreferences, next: boolean) {
    if (update.isPending) return;

    const previous = values[key];
    setValues((current) => ({ ...current, [key]: next }));
    setPendingKey(key);

    update.mutate(
      { [key]: next },
      {
        onError: () => {
          // Optimistic rollback (D-18): the switch returns to what is actually saved.
          setValues((current) => ({ ...current, [key]: previous }));
        },
        onSettled: () => {
          setPendingKey(null);
        },
      },
    );
  }

  return (
    <div className="flex max-w-prose flex-col gap-6">
      {update.error ? (
        <FormErrorFeedback
          error={update.error}
          onRetry={
            update.error.isRetryable
              ? () => {
                  update.reset();
                }
              : undefined
          }
        />
      ) : null}

      <div className="flex flex-col gap-5">
        {TOGGLES.map((key) => (
          <SwitchField
            key={key}
            label={t(`${key}.label`)}
            description={t(`${key}.description`)}
            checked={values[key]}
            disabled={update.isPending && pendingKey !== key}
            onCheckedChange={(next) => {
              toggle(key, next);
            }}
          />
        ))}
      </div>

      {update.isSuccess && !update.isPending ? <SavedIndicator label={t('saved')} /> : null}
    </div>
  );
}
