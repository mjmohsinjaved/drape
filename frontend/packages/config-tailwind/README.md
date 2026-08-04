# `@repo/config-tailwind`

The shared Tailwind **v4** preset for Drape. It maps the design tokens defined in
`ARCHITECTURE.md §6.1` onto Tailwind's theme, adds the admin density scale from §6.1/§6.2,
and supplies the utilities Tailwind has no namespace for.

Tailwind v4 is CSS-first. **This package contains no JavaScript and no `tailwind.config.ts`.**

## Consuming it

Almost always, don't. Import `@repo/ui/styles/globals.css` instead — it pulls in the tokens
and this preset in the correct order:

```css
/* apps/web/src/styles/globals.css */
@import '@repo/ui/styles/globals.css';
@source '../../../../packages/ui/src';
```

If you need the preset on its own (a Storybook, a docs site), the order is fixed:

```css
@import '@repo/ui/styles/tokens.css'; /* declares the values */
@import '@repo/config-tailwind'; /* maps them onto utilities */
@source '../node_modules/@repo/ui/src'; /* so ui class names survive tree-shaking */
```

## What it gives you

| Namespace         | Source token       | Example utilities                                      |
| ----------------- | ------------------ | ------------------------------------------------------ |
| Colour            | `--color-*`        | `bg-canvas`, `text-ink-muted`, `border-line-strong`     |
| Type scale        | `--text-*`         | `text-sm`, `text-3xl` (size + leading + tracking)       |
| Tracking          | `--tracking-*`     | `tracking-2xs` — only when tracking must leave the size |
| Spacing (4px)     | `--space-*`        | `p-4`, `gap-6`, `mb-8`                                  |
| Radii             | `--radius-*`       | `rounded-md`, `rounded-xl`                              |
| Shadows           | `--shadow-*`       | `shadow-sm`, `shadow-focus`                             |
| Typefaces         | `--font-*`         | `font-display`, `font-body`, `font-mono`, `font-urdu`   |
| Easing            | `--ease-*`         | `ease-out`, `ease-in-out`                               |
| Duration          | `--duration-*`     | `duration-fast`, `duration-base`                        |
| Containers        | `--container-*`    | `max-w-consumer`, `max-w-admin`                         |
| Density           | `--density-*`      | `h-row`, `p-cell`, `h-control`, `text-density`          |
| Shell             | `--sidenav-*`      | `w-sidenav`, `h-topbar-admin`, `h-tabbar`               |
| Focus and targets | —                  | `focus-ring`, `focus-ring-within`, `touch-target`       |
| Gutters (§6.2)    | —                  | `gutter-consumer`, `gutter-admin`                       |

Variants: `dark:`, `compact:`, `comfortable:`, `urdu:`, plus `xs:` at 360px (D-9).

## Two rules that are not negotiable

**1. Tailwind's stock palette and type scale are deleted.** The preset opens with
`--color-*: initial`, `--text-*: initial`, `--tracking-*: initial`, `--radius-*: initial`,
`--shadow-*: initial`, `--ease-*: initial`. `bg-red-500`, `tracking-wide` and
`text-2xl`-from-Tailwind do not
compile. If a colour you need is missing, it is missing from the token set — add it to
`ARCHITECTURE.md §6.1` and `@repo/ui/src/styles/tokens.css`, in that order. Do not reach for
an arbitrary value. (PRD **D-1**.)

**2. Logical properties only.** RTL (`ur`) works because no physical side ever appears in
component CSS — not in this package, not in `@repo/ui`, not in `apps/web`. Use `ms-*`,
`me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`, `border-s-*`,
`border-e-*`, `rounded-s-*`, `rounded-e-*`, `gap-x-*`. Never `ml-*`, `pr-*`, `left-*`,
`text-left`, `space-x-*`. `@repo/config-eslint` fails the build on the physical forms, and
there is **not one `[dir='rtl']` selector in the codebase** to fall back on. (§6.7.)

## Why `@theme inline`

Every entry in `theme.css` points at a custom property rather than holding a value, and the
block is marked `inline` so the value is copied into the generated utility. `bg-brand`
therefore compiles to `background-color: var(--color-brand)` and re-resolves whenever the
token changes scope: under `.dark`, and under the runtime brand colour the backend supplies
at `GET /settings/brand` (PRD **A-27**). A non-inline theme would bake the light value into
the utility at build time and the runtime override would silently do nothing.

Only `--color-brand`, `--color-brand-hover`, `--color-brand-active` and the logo asset are
runtime-overridable. Everything else is compile-time.
