import { useTranslations } from 'next-intl';

import { Badge, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';

import type { ReactNode } from 'react';

export interface PagePlaceholderProps {
  /** The page's `<h1>`. Exactly one per page (§8.1). */
  title: string;
  description: string;
  /**
   * The workstream that fills this segment in, e.g. `W2`. Rendered as a small badge so the
   * scaffold is obviously a scaffold and never mistaken for a finished screen.
   */
  workstream: string;
  /** What the owning workstream is expected to build here. */
  notes?: readonly string[];
  children?: ReactNode;
}

/**
 * The **default** D-5 state for a route that exists but has no body yet.
 *
 * The route tree in ARCHITECTURE §6.6 is fixed, so every segment is created now with its
 * metadata, its `loading.tsx` and its `error.tsx` in place. Later workstreams fill in bodies
 * rather than inventing routes.
 *
 * The other five states are already reachable for every one of these segments:
 *  - **loading**           — the segment's `loading.tsx` (aspect-matched skeleton, D-8)
 *  - **error**             — the segment's `error.tsx` → `RouteError` (D-7)
 *  - **permission denied** — the segment's server-side role check → `DeniedState` (S-9)
 *  - **empty**             — `EmptyNotice`, once the segment has a collection to be empty
 *  - **success**           — `SuccessNotice` / the toaster, once it has an action to confirm
 */
export function PagePlaceholder({
  title,
  description,
  workstream,
  notes,
  children,
}: PagePlaceholderProps) {
  const t = useTranslations('common.placeholder');

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <Badge variant="outline">{t('badge', { workstream })}</Badge>
        </div>
        <p className="max-w-prose text-base text-ink-muted">{description}</p>
      </header>

      {children}

      {notes && notes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('nextTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex list-disc flex-col gap-2 ps-5 text-sm text-ink-muted">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
