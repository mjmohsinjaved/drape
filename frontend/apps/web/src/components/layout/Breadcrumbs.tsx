'use client';

import { usePathname } from 'next/navigation';

import { useTranslations } from 'next-intl';

import { Breadcrumbs as BreadcrumbsRoot, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage } from '@repo/ui';

import { routes, stripLocale } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface BreadcrumbsProps {
  locale: Locale;
  /**
   * Labels for segments a translation key cannot cover — a garment title, an enquiry
   * reference. Keyed by the raw path segment.
   */
  overrides?: Readonly<Record<string, string>>;
}

/**
 * The admin breadcrumb — D-4. Repetitive work means moving up and sideways constantly, so the
 * trail is always there and every ancestor is clickable.
 *
 * Segments are translated from `admin.nav`; an id-looking segment falls back to an override or
 * is dropped rather than shown as a raw uuid.
 */
export function Breadcrumbs({ locale, overrides }: BreadcrumbsProps) {
  const t = useTranslations('admin.nav');
  const tCommon = useTranslations('common.nav');
  const pathname = usePathname();

  const segments = stripLocale(pathname).split('/').filter(Boolean);

  const crumbs = segments.map((segment, index) => {
    const href = `${routes.home(locale)}/${segments.slice(0, index + 1).join('/')}`;
    const override = overrides?.[segment];
    const looksLikeId = /^[0-9a-f-]{8,}$/i.test(segment);
    const label = override ?? (looksLikeId ? null : t.has(segment) ? t(segment) : segment);
    return { href, label };
  });

  const visible = crumbs.filter((crumb): crumb is { href: string; label: string } =>
    Boolean(crumb.label),
  );

  if (visible.length === 0) return null;

  return (
    <BreadcrumbsRoot aria-label={tCommon('breadcrumbLabel')}>
      <BreadcrumbItem>
        <BreadcrumbLink href={routes.dashboard(locale)}>{tCommon('dashboard')}</BreadcrumbLink>
      </BreadcrumbItem>
      {visible.map((crumb, index) => (
        <BreadcrumbItem key={crumb.href}>
          {index === visible.length - 1 ? (
            <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
          ) : (
            <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
          )}
        </BreadcrumbItem>
      ))}
    </BreadcrumbsRoot>
  );
}
