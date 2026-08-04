# @repo/utils

Pure, framework-free helpers shared across the Drape frontend.

Nothing in this package may import React, Next.js, `@repo/api-client` or `@repo/store` — it sits
at the bottom of the dependency graph so every other workspace package can depend on it.

## Consumption

The package is **source-first**: `exports` points straight at `src/index.ts` and there is no
build step, so there is never a stale `dist/`. `apps/web` must therefore list `@repo/utils` in
`next.config.ts` → `transpilePackages`.

```ts
import { cn, formatCurrency, isRtlLocale } from '@repo/utils';
```

## What is in here

| Module                  | Exports                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `cn.ts`                 | `cn` — clsx + tailwind-merge                                              |
| `format-currency.ts`    | `formatCurrency`, `getCurrencySymbol`, `DEFAULT_CURRENCY` (`PKR`)         |
| `format-date.ts`        | `formatDate`, `formatDateTime`, `formatRelative`, `toDate`                |
| `truncate.ts`           | `truncate` — code-point safe                                              |
| `slugify.ts`            | `slugify` — ASCII by default, `allowUnicode` opt-in                       |
| `is-rtl-locale.ts`      | `isRtlLocale`, `getDirection`, `RTL_LANGUAGE_SUBTAGS`                     |
| `build-query-string.ts` | `buildQueryString`, `appendQueryString`                                   |
| `safe-json-parse.ts`    | `safeJsonParse`, `safeJsonStringify` — return `Result`, never throw       |
| `debounce.ts`           | `debounce` with `cancel` / `flush` / `pending`                            |
| `sleep.ts`              | `sleep`, `SleepAbortError` — abortable                                    |
| `bytes.ts`              | `formatBytes` for uploader progress rows                                  |
| `result.ts`             | `Result<T, E>`, `ok`, `err`, `isOk`, `isErr`, `unwrapOr`, `mapResult`     |

## Conventions

- One helper per **kebab-case** file, re-exported from `src/index.ts`. Nothing is imported from
  a deep path by consumers.
- Every formatter is **locale-aware** and takes a `fallback` rather than emitting `NaN`,
  `Invalid Date` or `undefined` into the UI.
- Money is always `(amount, currency)`, never a preformatted string — the API sends
  `decimal(18,2)` plus a `char(3)` code defaulting to `PKR` (ARCHITECTURE.md §2.1).
- date-fns ships **no Urdu locale**. Every date helper takes a date-fns `Locale` object, so
  `apps/web` supplies its own `ur` locale and passes it in.

## Adding a helper

1. New kebab-case file in `src/`, one exported concern, with a JSDoc block explaining *why*.
2. Colocated `*.test.ts` covering the empty / nullish / non-finite / non-Latin edges.
3. Re-export the value **and** its option type from `src/index.ts`.
4. `npm run typecheck && npm run lint && npm run test` from this directory.

## Commands

```bash
npm run test        # vitest run
npm run test:watch  # vitest
npm run typecheck   # tsc --noEmit
npm run lint        # eslint . --max-warnings 0
```

Tests run with `TZ=UTC` (pinned in `vitest.config.ts`) so date assertions match on a PKT dev
machine and in CI alike.
