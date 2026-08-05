'use client';

import * as React from 'react';

import { useRouter } from 'next/navigation';

import { useTranslations } from 'next-intl';

import { Button, Callout } from '@repo/ui';

export interface PartialDataNoticeProps {
  /** One line, sentence case — what is incomplete. */
  title: string;
  /** One entry per thing that did not load, in the screen's own words. */
  items: readonly string[];
}

/**
 * A screen that mostly worked, saying which part of it did not.
 *
 * The failure this exists to stop is quieter than an error: a secondary read fails, the screen
 * renders anyway, and a partial set is presented as the whole. A filter list missing three of
 * its five facets does not look broken — it looks like a small collection. So the rule is that a
 * swallowed read has to leave a mark: the screen keeps working, and it says what is missing and
 * how to get it back (D-7).
 *
 * `warning` rather than `danger`: nothing is lost and nothing she did failed. It is a `Callout`
 * rather than an `ErrorState` because the screen behind it is still usable, and D-5's error
 * state is for when it is not.
 */
export function PartialDataNotice({ title, items }: PartialDataNoticeProps) {
  const t = useTranslations('errors');
  const router = useRouter();
  const [retrying, startTransition] = React.useTransition();

  const retry = React.useCallback((): void => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  const only = items[0];

  return (
    <Callout
      tone="warning"
      title={title}
      action={
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={retrying}
          loadingLabel={t('generic.action')}
          onClick={retry}
        >
          {t('generic.action')}
        </Button>
      }
    >
      {items.length === 1 && only !== undefined ? (
        <p>{only}</p>
      ) : (
        <ul className="flex list-disc flex-col gap-1 ps-5">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </Callout>
  );
}
