import type { Locale } from '@/i18n/config';

/**
 * Shared page/layout prop shapes. In Next 15 `params` and `searchParams` are promises, so a
 * page awaits them before use.
 */

export interface LocaleParams {
  params: Promise<{ locale: Locale }>;
}

export interface LocaleParamsWith<TExtra extends Record<string, string>> {
  params: Promise<{ locale: Locale } & TExtra>;
}

export interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}

export interface SearchParamsProp {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The props every `error.tsx` receives. */
export interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}
