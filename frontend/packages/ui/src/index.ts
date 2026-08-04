/**
 * `@repo/ui` — the Drape design system.
 *
 * Everything an app needs comes from this one entry point:
 *
 *   import { Button, EmptyState, ThemeProvider, cn } from '@repo/ui';
 *
 * Deep imports (`@repo/ui/src/components/button/Button`) are not part of the contract and will
 * break. The only other public path is `@repo/ui/styles/*` for the stylesheets.
 *
 * Inventory and conventions: ARCHITECTURE.md §6.1 (tokens), §6.2 (the two layout languages),
 * §6.3 (this list), §6.7 (i18n and RTL), §8.2 (required states).
 */

/* ================================================================== *
 * Utilities
 * ================================================================== */
export { cn } from './lib/cn';
export type { ClassValue } from './lib/cn';
export { useControllableState } from './lib/use-controllable-state';
export type { UseControllableStateParams } from './lib/use-controllable-state';
export { useIdOr } from './lib/use-id';

/* ================================================================== *
 * Typefaces (D-2) — next/font declarations, attached to <html> by the app
 * ================================================================== */
export { fonts, fontVariables, fraunces, ibmPlexMono, manrope, notoNastaliqUrdu } from './lib/fonts';
export type { FontRole } from './lib/fonts';

/* ================================================================== *
 * Providers
 * ================================================================== */
export {
  BrandThemeProvider,
  DirectionProvider,
  THEME_STORAGE_KEY,
  ThemeProvider,
  ThemeScript,
  useBrand,
  useDirection,
  useTheme,
} from './providers';
export type {
  BrandContextValue,
  BrandTheme,
  Direction,
  DirectionProviderProps,
  ResolvedThemeMode,
  ThemeContextValue,
  ThemeMode,
  ThemeProviderProps,
} from './providers';

/* ================================================================== *
 * Primitives
 * ================================================================== */
export * from './components/button';
export * from './components/icon-button';
export * from './components/link';
export * from './components/badge';
export * from './components/status-pill';
export * from './components/avatar';
export * from './components/spinner';
export * from './components/separator';
export * from './components/kbd';
export * from './components/visually-hidden';
export * from './components/aspect-ratio';
export * from './components/scroll-area';
export * from './components/directional-icon';

/* ================================================================== *
 * Forms
 * ================================================================== */
export * from './components/label';
export * from './components/input';
export * from './components/textarea';
export * from './components/form-field';
export * from './components/select';
export * from './components/multi-select';
export * from './components/combobox';
export * from './components/checkbox';
export * from './components/radio-group';
export * from './components/switch';
export * from './components/slider';
export * from './components/date-picker';
export * from './components/file-dropzone';
export * from './components/otp-input';
export * from './components/password-input';
export * from './components/color-swatch-picker';
export * from './components/tag-input';

/* ================================================================== *
 * Layout
 * ================================================================== */
export * from './components/card';
export * from './components/sheet';
export * from './components/dialog';
export * from './components/alert-dialog';
export * from './components/drawer';
export * from './components/popover';
export * from './components/tooltip';
export * from './components/dropdown-menu';
export * from './components/tabs';
export * from './components/accordion';
export * from './components/breadcrumbs';
export * from './components/pagination';
export * from './components/toolbar';
export * from './components/layout';

/* ================================================================== *
 * Data
 * ================================================================== */
export * from './components/table';
export * from './components/data-table';
export * from './components/description-list';
export * from './components/stat';
export * from './components/progress';
export * from './components/quota-meter';
export * from './components/sparkline';
export * from './components/skeleton';

/* ================================================================== *
 * Feedback
 * ================================================================== */
export * from './components/toast';
export * from './components/callout';
export * from './components/confirm-dialog';
export * from './components/stepper';

/* ================================================================== *
 * Media
 * ================================================================== */
export * from './components/image';
export * from './components/image-gallery';
export * from './components/zoomable';
export * from './components/compare-toggle';
export * from './components/watermark-preview';
export * from './components/blurred-thumbnail';
export * from './components/shortlisting-caption';

/* ================================================================== *
 * The six required states (D-5).
 * Every screen ships all of the applicable ones. A screen with only its
 * default state is incomplete.
 * ================================================================== */
export * from './components/states';
