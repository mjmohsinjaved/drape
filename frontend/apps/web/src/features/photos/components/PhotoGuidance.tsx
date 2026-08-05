import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  PHOTO_GUIDANCE_DIAGRAMS,
  PHOTO_GUIDANCE_ORDER,
} from '@/features/photos/components/PhotoDiagrams';

/**
 * Guidance **before** the picker — PRD C-13, §10.3.
 *
 * > "Guidance before the picker: full body, front facing, plain background, fitted clothing,
 * > good light, phone at chest height. Illustrated with diagrams, not photographs of real
 * > people."
 *
 * §10.3 sets the bar as "clear enough that a first attempt usually passes validation", so each
 * item pairs a drawing with one instruction and one reason. The six items are the six things
 * the C-14 validator actually measures, in the same order — she is shown exactly what will be
 * checked, which is why a rejection afterwards is never a surprise.
 *
 * A Server Component: six inline SVGs and some text, and no JavaScript at all.
 */
export function PhotoGuidance() {
  const t = useTranslations('photos.guidance');

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 className="font-display text-2xl text-balance">{t('title')}</h2>
        <p className="max-w-prose text-pretty text-ink-muted">{t('subtitle')}</p>
      </header>

      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {PHOTO_GUIDANCE_ORDER.map((key) => {
          const Diagram = PHOTO_GUIDANCE_DIAGRAMS[key];

          return (
            <li key={key} className="flex flex-col gap-3 rounded-xl bg-surface-sunken p-4">
              <Diagram className="h-40 w-full text-ink-muted" />
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-medium text-balance">
                  {t(`items.${key}.title`)}
                </h3>
                <p className="text-sm text-pretty text-ink-muted">{t(`items.${key}.body`)}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="flex items-start gap-2 text-sm text-ink-muted">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span className="text-pretty">{t('privacyNote')}</span>
      </p>
    </section>
  );
}
