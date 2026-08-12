'use client';

import Link from 'next/link';

import { useTranslations } from 'next-intl';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Stepper,
  type StepperStep,
} from '@repo/ui';

import { routes } from '@/lib/routes';

import type { AdminGarment } from '@/features/catalog/types/admin-catalog';
import type { Locale } from '@/i18n/config';

export interface FirstRunGuideProps {
  locale: Locale;
  /** A category has to exist before a garment can be created (`categoryId` is required). */
  hasCategory: boolean;
  /** The most recently touched draft, if there is one — the piece the guide is about. */
  draft: AdminGarment | null;
  /** Once anything is live the guide has done its job and stops rendering. */
  publishedCount: number;
}

/**
 * The two things that stand between an empty catalog and a live piece. The one-step flow
 * (2026-08) folded photographs, test render and publish into "add a piece": the create form
 * takes the photographs and the save is the publish.
 */
const STEP_IDS = ['category', 'garment'] as const;
type StepId = (typeof STEP_IDS)[number];

function currentStep(hasCategory: boolean): StepId {
  return hasCategory ? 'garment' : 'category';
}

/**
 * §10.3 — "a guided path from empty catalog to first published garment".
 *
 * It is not a checklist that reports progress; it is one screen that always names the single
 * next action and links straight to it (D-6). The step is derived from the catalog itself rather
 * than from a dismissed flag, so an admin who leaves halfway through and comes back a week later
 * arrives at the step they actually stopped on.
 *
 * It disappears the moment something is published, without being dismissed — the run is over.
 */
export function FirstRunGuide({ locale, hasCategory, publishedCount }: FirstRunGuideProps) {
  const t = useTranslations('admin.catalog.firstRun');

  if (publishedCount > 0) return null;

  const active = currentStep(hasCategory);
  const activeIndex = STEP_IDS.indexOf(active);

  const steps: StepperStep[] = STEP_IDS.map((id) => ({
    id,
    label: t(`steps.${id}.label`),
    description: t(`steps.${id}.description`),
  }));

  const href =
    active === 'category' ? routes.admin.categories(locale) : routes.admin.catalogNew(locale);

  return (
    <Card variant="admin" className="border-brand/30 bg-brand-tint">
      <CardHeader>
        <CardTitle as="h2" className="text-base">
          {t('title')}
        </CardTitle>
        <CardDescription>{t('body')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Stepper steps={steps} current={activeIndex} label={t('stepperLabel')} />
        <div>
          <Button asChild>
            <Link href={href}>{t(`steps.${active}.action`)}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
