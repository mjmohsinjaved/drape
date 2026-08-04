'use client';

import * as React from 'react';

import { DirectionProvider as RadixDirectionProvider } from '@radix-ui/react-direction';

/* ================================================================== *
 * Colour mode — light / dark / system
 * ================================================================== */

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedThemeMode = 'light' | 'dark';

export interface ThemeContextValue {
  /** What the user chose. `system` follows the OS. */
  mode: ThemeMode;
  /** What is actually painted right now. */
  resolvedMode: ResolvedThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** Light -> dark -> light. `system` resolves first, so the first press always visibly changes something. */
  toggleMode: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export const THEME_STORAGE_KEY = 'drape.theme-mode';

function readStoredMode(storageKey: string): ThemeMode | null {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : null;
  } catch {
    // Private mode, blocked storage, embedded webview. The default mode still works.
    return null;
  }
}

function systemMode(): ResolvedThemeMode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export interface ThemeProviderProps {
  children: React.ReactNode;
  /** Mode to use before anything is stored. Defaults to `system`. */
  defaultMode?: ThemeMode;
  /** localStorage key. Override only to isolate a Storybook or a test. */
  storageKey?: string;
  /** Element the `dark` class is written to. Defaults to `document.documentElement`. */
  target?: HTMLElement | null;
}

/**
 * Applies the colour mode by toggling `class="dark"` on <html> — the switch that
 * `tokens.css` and the `dark:` variant both key on (§6.1).
 *
 * Pair it with `<ThemeScript />` in <head> so the class is already correct on first paint and
 * a dark-mode user never sees an ivory flash.
 */
export function ThemeProvider({
  children,
  defaultMode = 'system',
  storageKey = THEME_STORAGE_KEY,
  target,
}: ThemeProviderProps): React.JSX.Element {
  const [mode, setModeState] = React.useState<ThemeMode>(defaultMode);
  const [resolvedMode, setResolvedMode] = React.useState<ResolvedThemeMode>(
    defaultMode === 'dark' ? 'dark' : 'light',
  );

  // Adopt the stored preference once the client is live. Server-rendered markup stays neutral.
  React.useEffect(() => {
    const stored = readStoredMode(storageKey);
    if (stored) setModeState(stored);
  }, [storageKey]);

  React.useEffect(() => {
    const element = target ?? document.documentElement;

    const apply = (): void => {
      const next: ResolvedThemeMode = mode === 'system' ? systemMode() : mode;
      element.classList.toggle('dark', next === 'dark');
      setResolvedMode(next);
    };

    apply();

    if (mode !== 'system') return;

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [mode, target]);

  const setMode = React.useCallback(
    (next: ThemeMode) => {
      setModeState(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // Preference is not persisted; the session still honours the choice.
      }
    },
    [storageKey],
  );

  const toggleMode = React.useCallback(() => {
    setMode(resolvedMode === 'dark' ? 'light' : 'dark');
  }, [resolvedMode, setMode]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ mode, resolvedMode, setMode, toggleMode }),
    [mode, resolvedMode, setMode, toggleMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside <ThemeProvider>.');
  }
  return context;
}

/* ================================================================== *
 * Brand — runtime override from GET /settings/brand (PRD A-27)
 * ================================================================== */

/**
 * The only three things the backend may change at runtime (§6.1): the brand colour, its hover
 * and active steps, and the logo. Everything else in the token set is compile-time.
 *
 * The API validates a submitted colour against the documented contrast floors before storing it
 * and rejects a failing value with `SETTINGS_VALUE_INVALID` (D-20), so a value arriving here has
 * already passed the same check the build runs.
 */
export interface BrandTheme {
  /** Brand name, for the logo's alt text and the document title. */
  name?: string;
  /** CSS colour. Overrides `--color-brand`. */
  primaryColor?: string;
  /** CSS colour. Overrides `--color-brand-hover`. Derived from `primaryColor` when absent. */
  primaryHoverColor?: string;
  /** CSS colour. Overrides `--color-brand-active`. Derived from `primaryColor` when absent. */
  primaryActiveColor?: string;
  /** Signed URL for the logo asset. */
  logoUrl?: string;
  /** Signed URL for a logo variant that reads on a dark canvas. Falls back to `logoUrl`. */
  logoDarkUrl?: string;
}

export interface BrandContextValue {
  brand: BrandTheme;
  /** The logo for the mode currently painted, or `null` when the brand has none. */
  logoUrl: string | null;
  setBrand: (brand: BrandTheme) => void;
}

const BrandContext = React.createContext<BrandContextValue | null>(null);

/**
 * Applies the backend's brand colour and logo by overriding CSS custom properties on the scope
 * element. It writes tokens, never component styles — which is why a single assignment restyles
 * every button, link, focus ring, selected table row and progress bar in the product at once.
 *
 * `--color-brand-hover` and `--color-brand-active` fall back to a `color-mix()` against the ink
 * and canvas tokens, so a brand that supplies only a primary colour still gets real hover and
 * active states (D-10) rather than a flat fill.
 */
export function BrandThemeProvider({
  children,
  brand: brandProp,
  target,
}: {
  children: React.ReactNode;
  /** Brand payload from `GET /settings/brand`. Undefined until it loads; tokens stay at their defaults. */
  brand?: BrandTheme | undefined;
  /** Element the overrides are written to. Defaults to `document.documentElement`. */
  target?: HTMLElement | null;
}): React.JSX.Element {
  const [brand, setBrand] = React.useState<BrandTheme>(brandProp ?? {});
  const { resolvedMode } = useOptionalTheme();

  React.useEffect(() => {
    if (brandProp) setBrand(brandProp);
  }, [brandProp]);

  React.useEffect(() => {
    const element = target ?? document.documentElement;
    const { primaryColor, primaryHoverColor, primaryActiveColor } = brand;

    const overrides: Array<[string, string | undefined]> = [
      ['--color-brand', primaryColor],
      [
        '--color-brand-hover',
        primaryHoverColor ??
          (primaryColor ? `color-mix(in oklab, ${primaryColor} 88%, var(--color-ink))` : undefined),
      ],
      [
        '--color-brand-active',
        primaryActiveColor ??
          (primaryColor ? `color-mix(in oklab, ${primaryColor} 76%, var(--color-ink))` : undefined),
      ],
      // The focus ring is the brand colour in light mode (§6.1); keep them in step.
      ['--color-focus', primaryColor],
      [
        '--color-brand-tint',
        primaryColor
          ? `color-mix(in oklab, ${primaryColor} 12%, var(--color-surface))`
          : undefined,
      ],
    ];

    for (const [property, value] of overrides) {
      if (value) {
        element.style.setProperty(property, value);
      } else {
        element.style.removeProperty(property);
      }
    }

    return () => {
      for (const [property] of overrides) element.style.removeProperty(property);
    };
  }, [brand, target]);

  const logoUrl = React.useMemo(() => {
    if (resolvedMode === 'dark') return brand.logoDarkUrl ?? brand.logoUrl ?? null;
    return brand.logoUrl ?? null;
  }, [brand.logoDarkUrl, brand.logoUrl, resolvedMode]);

  const value = React.useMemo<BrandContextValue>(
    () => ({ brand, logoUrl, setBrand }),
    [brand, logoUrl],
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandContextValue {
  const context = React.useContext(BrandContext);
  if (!context) {
    throw new Error('useBrand must be used inside <BrandThemeProvider>.');
  }
  return context;
}

/** Brand provider may sit above or below the theme provider; it must not throw either way. */
function useOptionalTheme(): { resolvedMode: ResolvedThemeMode } {
  const context = React.useContext(ThemeContext);
  return { resolvedMode: context?.resolvedMode ?? 'light' };
}

/* ================================================================== *
 * Direction — ltr / rtl (§6.7, C-41)
 * ================================================================== */

export type Direction = 'ltr' | 'rtl';

const DirectionContext = React.createContext<Direction>('ltr');

export interface DirectionProviderProps {
  children: React.ReactNode;
  /** `ltr` for `en`, `rtl` for `ur`. Comes from the `[locale]` segment. */
  dir: Direction;
  /**
   * Render a wrapping <div dir="…">. Leave false when the app has already set `dir` on <html>,
   * which is the normal case — a second dir attribute is redundant, not harmful, but noisy.
   */
  asWrapper?: boolean;
}

/**
 * Publishes the reading direction to Radix (so popovers, menus, sliders and tabs pick the right
 * arrow-key semantics) and to `useDirection()` for the handful of things CSS logical properties
 * cannot express — chiefly `<DirectionalIcon>`, which mirrors a chevron with `scaleX(-1)`.
 *
 * Layout itself never consults this. Layout is logical properties, always (§6.7).
 */
export function DirectionProvider({
  children,
  dir,
  asWrapper = false,
}: DirectionProviderProps): React.JSX.Element {
  return (
    <DirectionContext.Provider value={dir}>
      <RadixDirectionProvider dir={dir}>
        {asWrapper ? <div dir={dir}>{children}</div> : children}
      </RadixDirectionProvider>
    </DirectionContext.Provider>
  );
}

/** Current reading direction. Defaults to `ltr` outside a provider. */
export function useDirection(): Direction {
  return React.useContext(DirectionContext);
}

/* ================================================================== *
 * First-paint mode script
 * ================================================================== */

/**
 * Sets `class="dark"` before the first paint so a dark-mode user never sees an ivory flash.
 * Render it inside <head>; it is a server component and ships ~350 bytes.
 *
 * It is deliberately inert on failure: a thrown error inside the try leaves the document in
 * light mode, which is a readable, WCAG-passing state.
 */
export function ThemeScript({
  defaultMode = 'system',
  storageKey = THEME_STORAGE_KEY,
}: {
  defaultMode?: ThemeMode;
  storageKey?: string;
}): React.JSX.Element {
  const script = `(function(){try{var m=localStorage.getItem(${JSON.stringify(storageKey)})||${JSON.stringify(defaultMode)};var d=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;
  return <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: script }} />;
}
