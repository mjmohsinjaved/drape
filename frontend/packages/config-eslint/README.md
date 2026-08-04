# @repo/config-eslint

Shared **ESLint 9 flat configs** for the Drape frontend workspace.

| Entry point                  | Use it in                                            |
| ---------------------------- | ---------------------------------------------------- |
| `@repo/config-eslint/base`   | Any non-React package (`@repo/utils`, `@repo/store`) |
| `@repo/config-eslint/react`  | React packages (`@repo/ui`, `@repo/api-client`)      |
| `@repo/config-eslint/next`   | The Next.js app (`apps/web`)                         |

The layering is `base → react → next`; each entry point re-exports everything below it, so a
package picks exactly one.

## Usage

```js
// packages/<pkg>/eslint.config.js
import { baseConfig } from '@repo/config-eslint/base';

export default [...baseConfig, { /* package-local overrides */ }];
```

```js
// apps/web/eslint.config.js
import { nextConfig } from '@repo/config-eslint/next';

export default nextConfig;
```

Run it with `eslint . --max-warnings 0` (that is what the workspace `lint` task does).

## What is enforced

- `@typescript-eslint` **recommended + stylistic**.
- `@typescript-eslint/no-explicit-any: error` and `no-console: error` — both are
  CLAUDE.md non-negotiables, do not disable them per-file without a written reason.
- `@typescript-eslint/consistent-type-imports` with inline `import { type X }` fix style.
- `import/order`: builtin → external → internal (`@repo/**`, then `@/**`) → parent → sibling →
  index, alphabetised, blank line between groups.
- `turbo/no-undeclared-env-vars`: every `process.env.X` read must be declared in `turbo.json`
  (`globalEnv`, or a task-level `env`). This is what keeps the Turbo cache honest.
- React (`react`, `react-hooks`) and **`jsx-a11y` recommended** — Drape targets WCAG 2.1 AA, so
  a11y findings are lint failures, not advisories.
- `@next/eslint-plugin-next` recommended + core-web-vitals in the Next entry point.
- `eslint-config-prettier` is applied **last** in every entry point, so formatting is Prettier's
  job alone.

### The RTL and design-token bans (`react` / `next` only)

`no-restricted-syntax` carries four **error**-level selectors, exported as
`designSystemRestrictions` from `react.js`:

1. Physical-direction Tailwind classes — `ml-`, `pr-`, `left-`, `border-l`, `text-left`, …
   Drape ships an Urdu locale, so layout must use logical properties (`ms-`/`me-`, `ps-`/`pe-`,
   `text-start`/`text-end`, `border-s`/`border-e`). A physical side does not mirror.
2. Physical CSS-in-JS properties — `marginLeft`, `borderRightWidth`, … Use the `*Inline*` forms.
3. **D-1**: hex colour literals in `className` / `style`. Use a design token.
4. **D-1**: arbitrary Tailwind *values* — `w-[13px]`, `text-[#fff]`. Use the token scale.

Rule 4 deliberately does **not** match arbitrary *variants* (`data-[state=open]:`,
`has-[:checked]:`, `min-[600px]:`), which are ordinary Radix/Tailwind usage.

CSS files are outside ESLint's reach — the token rules there are enforced by review and by the
contrast spec in `@repo/ui`.

## File naming

`ARCHITECTURE.md` §1.2 sketches these as `base.mjs` / `react.mjs` / `next.mjs`. The package sets
`"type": "module"`, so `.js` here *is* ESM and the two are equivalent; the `exports` map also
accepts the `.mjs` specifiers (`@repo/config-eslint/base.mjs`) so either import form resolves.
