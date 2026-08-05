'use client';

import { useTranslations } from 'next-intl';

import { StatusPill, type StatusPillProps } from '@repo/ui';

import type { PublishState, TestRenderState } from '@repo/api-client';

/**
 * Lifecycle state, drawn once so no screen invents its own word for it.
 *
 * §2.2: enum values are `UPPER_SNAKE_CASE` on the wire and are never rendered. Each pill maps its
 * value to a translated label; the word carries the meaning and the colour only reinforces it
 * (D-20).
 */

const PUBLISH_TONES: Readonly<Record<PublishState, NonNullable<StatusPillProps['tone']>>> = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  ARCHIVED: 'warning',
};

export function PublishStatePill({ state }: { state: PublishState }) {
  const t = useTranslations('admin.catalog.publishState');
  return (
    <StatusPill size="sm" tone={PUBLISH_TONES[state]} srPrefix={t('label')}>
      {t(state)}
    </StatusPill>
  );
}

const TEST_RENDER_TONES: Readonly<Record<TestRenderState, NonNullable<StatusPillProps['tone']>>> = {
  NONE: 'neutral',
  PENDING: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
};

export function TestRenderStatePill({ state }: { state: TestRenderState }) {
  const t = useTranslations('admin.catalog.testRenderState');
  return (
    <StatusPill
      size="sm"
      tone={TEST_RENDER_TONES[state]}
      srPrefix={t('label')}
      pulse={state === 'PENDING'}
    >
      {t(state)}
    </StatusPill>
  );
}

export interface QualityPillProps {
  score: number | null;
  minScore: number;
  /** True once an admin has recorded the A-10 waiver, which is a different fact from the score. */
  overridden: boolean;
}

/**
 * A-10 — the score, and "Needs a better photo" when it is under the bar.
 *
 * The label is A-10's own words. An overridden garment keeps the failing score on screen: the
 * waiver removes the block, not the problem, and hiding the number afterwards would make the
 * override invisible on every screen but the one where it was granted.
 */
export function QualityPill({ score, minScore, overridden }: QualityPillProps) {
  const t = useTranslations('admin.catalog.quality');

  if (score === null) {
    return (
      <StatusPill size="sm" tone="neutral" srPrefix={t('label')} dot={false}>
        {t('notChecked')}
      </StatusPill>
    );
  }

  const failing = score < minScore;

  return (
    <StatusPill
      size="sm"
      tone={failing ? (overridden ? 'warning' : 'danger') : 'success'}
      srPrefix={t('label')}
    >
      {failing
        ? overridden
          ? t('overriddenShort', { score })
          : t('needsBetterPhotoShort', { score })
        : t('scoreShort', { score })}
    </StatusPill>
  );
}
