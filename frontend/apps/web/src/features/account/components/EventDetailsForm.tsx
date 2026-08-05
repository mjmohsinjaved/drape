'use client';

import { useState, type FormEvent } from 'react';

import { useTranslations } from 'next-intl';

import { BUDGET_BANDS, EVENT_TYPES, type BudgetBand, type EventType ,type  ConsumerProfile } from '@repo/api-client';
import { Button } from '@repo/ui';

import { SelectField } from '@/features/account/components/SelectField';
import { useUpdateMyProfile } from '@/features/account/hooks/use-account-mutations';
import { TextField } from '@/features/auth/components/fields';
import { FormErrorFeedback, FormSuccessFeedback } from '@/features/auth/components/FormFeedback';


/**
 * The C-2 event details — **this is the "later, in context" the signup form promised.**
 *
 * > "Signup requires name, email, password and phone. Event date, event type and budget band
 * > are optional and prompted later in context."
 *
 * So they are asked here, on her own account screen, where the question is hers to answer at
 * leisure. Every one of them is optional, every one can be cleared, and nothing downstream
 * treats a blank as unfinished onboarding. The copy says what the answers are *for* — better
 * suggestions — rather than implying she owes them.
 *
 * ### The six D-5 states
 * - **default** — three optional fields.
 * - **loading** — the busy save button, plus the segment's `loading.tsx`.
 * - **empty** — the unanswered case *is* the default here, and it is not a failure state.
 * - **error** — validation and transport failures.
 * - **permission denied** — an admin never reaches this screen; the consumer layout redirects.
 * - **success** — "Saved", in the same words as the control (D-13).
 */
export interface EventDetailsFormProps {
  profile: ConsumerProfile;
}

const NOT_ANSWERED = '';

export function EventDetailsForm({ profile }: EventDetailsFormProps) {
  const t = useTranslations('account.eventDetails');
  const tc = useTranslations('auth.common');
  const update = useUpdateMyProfile();

  const [eventDate, setEventDate] = useState(profile.eventDate ?? NOT_ANSWERED);
  const [eventType, setEventType] = useState<string>(profile.eventType ?? NOT_ANSWERED);
  const [budgetBand, setBudgetBand] = useState<string>(profile.budgetBand ?? NOT_ANSWERED);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (update.isPending) return;

    update.mutate({
      eventDate: eventDate === NOT_ANSWERED ? null : eventDate,
      eventType: eventType === NOT_ANSWERED ? null : (eventType as EventType),
      budgetBand: budgetBand === NOT_ANSWERED ? null : (budgetBand as BudgetBand),
    });
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex max-w-prose flex-col gap-5">
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

      {update.isSuccess && !update.isPending ? (
        <FormSuccessFeedback title={t('savedTitle')} description={t('savedBody')} />
      ) : null}

      <TextField
        label={t('dateLabel')}
        value={eventDate}
        onValueChange={setEventDate}
        type="date"
        disabled={update.isPending}
        hint={t('dateHint')}
      />

      <SelectField
        label={t('typeLabel')}
        value={eventType}
        onValueChange={setEventType}
        options={EVENT_TYPES.map((value) => ({ value, label: t(`types.${value}`) }))}
        placeholder={t('typePlaceholder')}
        optional
        disabled={update.isPending}
      />

      <SelectField
        label={t('budgetLabel')}
        value={budgetBand}
        onValueChange={setBudgetBand}
        options={BUDGET_BANDS.map((value) => ({ value, label: t(`bands.${value}`) }))}
        placeholder={t('budgetPlaceholder')}
        optional
        hint={t('budgetHint')}
        disabled={update.isPending}
      />

      <Button
        type="submit"
        loading={update.isPending}
        loadingLabel={tc('saving')}
        className="self-start"
      >
        {t('submit')}
      </Button>
    </form>
  );
}
