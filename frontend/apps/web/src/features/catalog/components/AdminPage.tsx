import { cn } from '@repo/ui';

import type { ReactNode } from 'react';

/**
 * The admin layout language for a single console screen (D-4, §6.2).
 *
 * It is a plain wrapper: one `--density-section-gap` rhythm between the header and the blocks
 * below it. **It does not set `data-density`.** `AdminShell` owns that attribute for the whole
 * admin surface, so the rail's compact toggle retimes the rail, the top bar and the page in one
 * step — a per-screen scope could only ever tighten the part of the console it wrapped.
 */
export interface AdminPageProps {
  children: ReactNode;
  className?: string;
}

export function AdminPage({ children, className }: AdminPageProps) {
  return <div className={cn('flex flex-col gap-section', className)}>{children}</div>;
}

export interface AdminPageHeaderProps {
  /** The page's single `<h1>`. `--text-2xl` is the admin page-title size and the only display use. */
  title: string;
  description?: string;
  /** Primary and secondary actions, in reading order. */
  actions?: ReactNode;
  /** A status line under the title — counts, filters in force, the last saved time. */
  meta?: ReactNode;
}

export function AdminPageHeader({ title, description, actions, meta }: AdminPageHeaderProps) {
  return (
    <header className="flex flex-col gap-stack">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold text-ink">{title}</h1>
          {description ? <p className="max-w-prose text-sm text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {meta ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">{meta}</div>
      ) : null}
    </header>
  );
}

export interface AdminSectionProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Heading level, so the document outline stays ordered (D-20). */
  headingLevel?: 'h2' | 'h3';
  className?: string;
}

/** A titled block inside a dense screen: hairline border, `--radius-md`, no shadow (§6.2). */
export function AdminSection({
  title,
  description,
  actions,
  children,
  headingLevel = 'h2',
  className,
}: AdminSectionProps) {
  const Heading = headingLevel;

  return (
    <section
      className={cn(
        'flex flex-col gap-stack rounded-md border border-line bg-surface p-4',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Heading className="font-body text-sm font-semibold text-ink">{title}</Heading>
          {description ? <p className="text-xs text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
