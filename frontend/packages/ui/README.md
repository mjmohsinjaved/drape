# `@repo/ui`

The Drape design system: the token set from `ARCHITECTURE.md §6.1`, the providers, and the atom
inventory from §6.3. Every screen in `apps/web` — consumer and admin — is built from these.

Source-first. There is no build step and no `dist/`: the app transpiles the package through
`transpilePackages` in `next.config.ts`.

## Install and wire up

`apps/web/package.json`:

```json
"dependencies": { "@repo/ui": "*" }
```

`apps/web/next.config.ts`:

```ts
transpilePackages: ['@repo/ui', '@repo/api-client', '@repo/store', '@repo/utils'],
```

`apps/web/src/styles/globals.css` — one import, plus the source globs Tailwind needs:

```css
@import '@repo/ui/styles/globals.css';
@source '../../../../packages/ui/src';
@source './';
```

`apps/web/src/app/[locale]/layout.tsx`:

```tsx
import {
  BrandThemeProvider,
  DirectionProvider,
  ThemeProvider,
  ThemeScript,
  Toaster,
  TooltipProvider,
  fontVariables,
} from '@repo/ui';

export default async function RootLayout({ children, params }: LayoutProps) {
  const { locale } = await params;
  const brand = await getBrand(); // GET /settings/brand — A-27

  return (
    <html lang={locale} dir={direction[locale]} className={fontVariables} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <ThemeProvider defaultMode="system">
          <BrandThemeProvider brand={brand}>
            <DirectionProvider dir={direction[locale]}>
              <TooltipProvider>
                {children}
                <Toaster />
              </TooltipProvider>
            </DirectionProvider>
          </BrandThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

`ThemeScript` goes in `<head>` so `class="dark"` is set before the first paint and a dark-mode
user never sees an ivory flash.

## Import from the package root, always

```ts
import { Button, EmptyState, DataTable, cn } from '@repo/ui';
```

Deep imports (`@repo/ui/src/components/button/Button`) are not part of the contract. The only
other public path is `@repo/ui/styles/*`.

---

## The rule that matters most: apps never define colours

`src/styles/tokens.css` is **the only file in the entire frontend where a raw colour value may
appear.** Not a hex, not an `rgb()`, not an `oklch()`, not `bg-[#71202F]`, not a colour in a
`style` prop, not one in a chart config. This is PRD **D-1**, and it is enforced three ways:

1. `@repo/config-tailwind` deletes Tailwind's stock palette, so `bg-red-500` does not compile.
2. `@repo/config-eslint` bans hex literals and arbitrary Tailwind values in `apps/web`.
3. `tokens.css` is the only place the values live, so a colour change is one diff in one file.

Use the semantic utilities instead: `bg-canvas`, `bg-surface`, `bg-surface-raised`,
`bg-surface-sunken`, `text-ink`, `text-ink-muted`, `text-ink-subtle`, `border-line`,
`border-line-strong`, `bg-brand` / `text-brand-fg`, `text-gold-text`, and the semantic families
`success` / `warning` / `danger` / `info`, each with a `-tint` for backgrounds.

Two colour rules that are easy to get wrong:

- **Never `text-gold`.** `--color-gold` is 3.6:1 — non-text and large text only. When the gold
  family has to carry text, it is `--color-gold-text` (7.2:1).
- **`--color-brand`, `--color-brand-hover` and `--color-brand-active` are runtime-overridable**
  by the backend (A-27) and nothing else is. Anything that must follow the brand has to read
  those tokens rather than copy their values.

If a colour you need does not exist, it is missing from the token set. Add it to
`ARCHITECTURE.md §6.1` first, then to `tokens.css`. Do not reach for an arbitrary value.

The same discipline applies to spacing, radii, type and shadows: `p-4` not `p-[17px]`,
`rounded-lg` not `rounded-[14px]`, `text-sm` not `text-[13px]`.

---

## Logical properties only

Drape ships an Urdu (RTL) locale. Layout mirrors because **no physical side appears in any
component** — not here, not in `apps/web`.

| Use                                          | Never                                      |
| -------------------------------------------- | ------------------------------------------ |
| `ms-*` `me-*` `ps-*` `pe-*`                  | `ml-*` `mr-*` `pl-*` `pr-*`                |
| `start-*` `end-*`                            | `left-*` `right-*`                         |
| `text-start` `text-end`                      | `text-left` `text-right`                   |
| `border-s-*` `border-e-*`                    | `border-l-*` `border-r-*`                  |
| `rounded-s-*` `rounded-e-*`                  | `rounded-l-*` `rounded-r-*`                |
| `gap-x-*`                                    | `space-x-*`                                |

There are **no `[dir='rtl']` selectors in this codebase**, so there is nothing to fall back on
when a physical property slips through. The one exception is `<DirectionalIcon>`, which mirrors
chevrons, arrows and back buttons with `scaleX(-1)` because a transform has no logical form.
Icons that are not directional — search, trash, plus, camera — never flip.

---

## The six required states (D-5)

Every screen ships all of the applicable ones. A screen with only its default state is
incomplete.

```tsx
{state === 'loading' ? (
  <LoadingState label="Loading your try-ons" layout="grid" ratio="garment" />
) : state === 'denied' ? (
  <PermissionDeniedState />
) : state === 'error' ? (
  <ErrorState onRetry={refetch} />
) : items.length === 0 ? (
  <EmptyState
    title="Try your first piece on"
    description="Pick something from the catalog and see how it might sit."
    action={<Button asChild><Link href="/catalog">Browse the catalog</Link></Button>}
  />
) : (
  <DefaultState>{/* … */}</DefaultState>
)}
```

Three of these enforce a product rule in their types:

- **`EmptyState` requires `action`.** An empty state that only reports emptiness is a defect
  (D-6). If you cannot name a next step, the screen is wrong, not the prop.
- **`ErrorState`'s default copy states what happened and what to do next.** It does not
  apologise and does not blame the user (D-7). Prefer specific copy from `errors.json` when the
  API gives you an `ErrorCode`.
- **`Skeleton` takes a `ratio`** so the placeholder is the shape of the content it replaces and
  CLS stays under 0.1 (D-8). `<Skeleton ratio="garment" />`, `<Skeleton variant="text" lines={2} />`.

`PermissionDeniedState` takes no id, name or resource type — deliberately. The copy is identical
whether the resource is forbidden or absent, so the screen can never reveal which (§8.2).

---

## Copy rules baked into the components

**Drape is a shortlisting tool, never a preview tool.** No string may promise accuracy or say
"see yourself in" (PRD §9.4). Run every consumer-facing string through the §8.3 check.

- `<ShortlistingCaption>` carries the non-negotiable caption that must sit with every render.
  It has no dismiss prop and no hidden variant — that is the point (C-20, §8.3).
- `<CompareToggle>` labels the render "Your try-on" and the source "Catalog photo". Not "Your
  look", not "You in this".
- `<QuotaMeter>` says "Try-ons left this month", not "Quota balance" (D-14), and at zero it
  shows the way on rather than a dead end.
- Confirmations reuse the verb of the action: Publish → Published, Delete → Deleted (D-13).

---

## Two layout languages (D-4, §6.2)

They share the token set and nothing else.

|            | Consumer                                          | Admin                                             |
| ---------- | ------------------------------------------------- | ------------------------------------------------- |
| Container  | `<Container width="consumer">` (1200px, centred)   | `<Container width="admin">` (1680px, full-bleed)   |
| Card       | `<Card variant="consumer">` — radius-xl, shadow-sm | `<Card variant="admin">` — radius-md, hairline     |
| Body type  | `text-base`                                        | `text-sm` / `text-density`                         |
| Lists      | Card lists. Tables are avoided.                    | `<DataTable>` is the primary surface.              |
| Density    | n/a                                                | `data-density="comfortable" \| "compact"`          |

The density scale drives `h-row`, `p-cell`, `h-control`, `text-density`, `gap-stack` and
`gap-section`. `compact` only applies on a fine pointer, so the 44×44 target floor (D-10) can
never be violated on a phone by a stale preference.

---

## Accessibility floor (D-10, D-20 — WCAG 2.1 AA)

Every atom already does this; keep it true when you compose them.

- **Focus is always visible.** `globals.css` puts a `--shadow-focus` ring on every interactive
  element. Do not remove it — re-draw it if a design needs it drawn differently.
- **Touch targets are ≥44×44.** Controls that look smaller (`IconButton size="sm"`, `Checkbox`,
  `Switch`, admin density controls) extend their hit area with `touch-target-pseudo`.
- **Icons are never the accessible name.** `IconButton` requires a `label`; `Image` requires
  `alt`; `Sparkline` requires a text alternative.
- **Colour is never the only signal.** `StatusPill` carries a word and a dot, `Stepper` carries a
  marker, `QuotaMeter` spells out the number.
- **Motion respects `prefers-reduced-motion`** — clamped globally to 1ms (D-11).

---

## Layout of the package

```
src/
├── styles/
│   ├── tokens.css      # §6.1 — the only raw colours in the frontend
│   └── globals.css     # base layer, focus ring, reduced motion, RTL defaults
├── lib/
│   ├── cn.ts           # re-export of @repo/utils
│   ├── fonts.ts        # next/font — Fraunces, Manrope, Noto Nastaliq Urdu, IBM Plex Mono
│   ├── use-controllable-state.ts
│   └── use-id.ts
├── providers/
│   └── theme-provider.tsx  # ThemeProvider, BrandThemeProvider, DirectionProvider, ThemeScript
├── components/
│   ├── <atom>/<Atom>.tsx + index.ts   # one folder per atom (§6.3)
│   └── states/                        # the six D-5 states
└── index.ts            # the only public entry point
```

`'use client'` appears only where interactivity requires it. `Badge`, `Card`, `Skeleton`,
`Stat`, `Table`, `Kbd`, `VisuallyHidden`, `Sparkline`, `DescriptionList`, `WatermarkPreview`,
`ShortlistingCaption`, `DefaultState`, `LoadingState`, `EmptyState`, `SuccessState` and
`PermissionDeniedState` are server components and render without shipping JS. `ErrorState` is a
client component only because it owns a retry button.
