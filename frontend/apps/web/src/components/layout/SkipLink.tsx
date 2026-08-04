import { useTranslations } from 'next-intl';

/** The id every shell puts on its `<main>`, so the skip link always has a target. */
export const MAIN_CONTENT_ID = 'main-content';

/**
 * The first focusable thing on every page (D-20, §9.5).
 *
 * Visually hidden until focused, then it appears in flow at the start edge — `start`, not
 * `left`, so it lands correctly in Urdu. Its hit area clears the 44 x 44 px floor (D-10).
 */
export function SkipLink() {
  const t = useTranslations('common');

  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only z-50 focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-md focus:bg-surface focus:px-4 focus:text-sm focus:shadow-md"
    >
      {t('skipToContent')}
    </a>
  );
}
