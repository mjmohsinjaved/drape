'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, Callout, ProgressBar } from '@repo/ui';
import { formatDateTime } from '@repo/utils';

import { AdminSection } from '@/features/catalog/components/AdminPage';

import type { GarmentQualityCheck } from '@/features/catalog/types/admin-catalog';

export interface QualityReportProps {
  score: number | null;
  minScore: number;
  checks: readonly GarmentQualityCheck[];
  overridden: boolean;
  overriddenAt: string | null;
  /** Opens the override dialog. Absent when the score already passes. */
  onOverride?: () => void;
  /** Re-runs the validator against the current try-on source. */
  onRevalidate?: () => void;
  revalidating?: boolean;
}

/**
 * A-10 — the quality report for the try-on source.
 *
 * > "Below threshold the garment is marked **Needs a better photo** and cannot be published
 * > without an explicit override, which is logged."
 *
 * Three things this screen is careful about:
 *
 * 1. **Every failed check shows its own remediation.** The API authors those strings
 *    (`ImageQualityCheckDto.remediation`) so the console and the validator cannot drift on what
 *    "too small" means — they arrive already specific: "Re-export this piece at 2,000px or more
 *    on its longest side. This one is 1,640px."
 * 2. **Override is not the path of least resistance.** It is a tertiary control under the list of
 *    things to fix, phrased as what it does rather than as a way past the block, and the dialog
 *    behind it demands a written reason. Re-taking the photograph is the primary action.
 * 3. **The waiver never hides the score.** An overridden garment keeps the failing number and the
 *    failed checks on screen, with a line saying who allowed it and when.
 */
export function QualityReport({
  score,
  minScore,
  checks,
  overridden,
  overriddenAt,
  onOverride,
  onRevalidate,
  revalidating = false,
}: QualityReportProps) {
  const t = useTranslations('admin.catalog.quality');

  if (score === null) {
    return (
      <AdminSection title={t('sectionTitle')} description={t('notCheckedBody')}>
        <Callout tone="info" title={t('notChecked')}>
          {t('notCheckedHint')}
        </Callout>
      </AdminSection>
    );
  }

  const failed = checks.filter((check) => !check.passed);
  const passes = score >= minScore;

  return (
    <AdminSection
      title={t('sectionTitle')}
      description={t('sectionDescription', { minScore })}
      actions={
        onRevalidate ? (
          <Button
            variant="ghost"
            size="sm"
            loading={revalidating}
            loadingLabel={t('revalidate')}
            onClick={onRevalidate}
          >
            {t('revalidate')}
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-2">
        <ProgressBar
          value={score}
          max={100}
          tone={passes ? 'success' : 'danger'}
          label={t('scoreLabel')}
          showLabel
          formatValue={(value) => t('scoreOf', { score: value, minScore })}
        />
      </div>

      {!passes ? (
        <Callout tone={overridden ? 'warning' : 'danger'} title={t('needsBetterPhoto')}>
          {overridden
            ? t('overriddenBody', { when: formatDateTime(overriddenAt) })
            : t('needsBetterPhotoBody')}
        </Callout>
      ) : (
        <Callout tone="success" title={t('readyTitle')}>
          {t('readyBody')}
        </Callout>
      )}

      <ul className="flex flex-col gap-2">
        {checks.map((check) => (
          <li
            key={check.check}
            className="flex items-start gap-3 rounded-sm border border-line p-3"
          >
            {check.passed ? (
              <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <XCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
            )}
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-medium text-ink">
                {t(`checks.${check.check}`)}
                <span className="sr-only">
                  {check.passed ? t('checkPassed') : t('checkFailed')}
                </span>
              </p>
              {/*
                Server-authored, already user-safe copy (§10.5). It is the one string on this
                screen that is not translated locally, because it carries measured numbers the
                console does not have.
              */}
              {!check.passed && check.remediation !== null ? (
                <p className="text-sm text-ink-muted">{check.remediation}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {!passes && !overridden && onOverride ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="text-xs text-ink-muted">
            {t('overrideExplainer', { count: failed.length })}
          </p>
          <div>
            <Button variant="ghost" size="sm" onClick={onOverride}>
              {t('overrideAction')}
            </Button>
          </div>
        </div>
      ) : null}
    </AdminSection>
  );
}
