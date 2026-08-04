# Drape — frontend

Turborepo workspace for the Drape virtual fitting room. One Next.js app serves both the
consumer and admin experiences (PRD S-2); everything shared lives in a `@repo/*` package.

Authoritative documents, in order of precedence: `docs/PRD-drape-v1.md` (behaviour) →
`docs/ARCHITECTURE.md` (structure, naming, error codes, routes) → this file.

## Layout

```
frontend/
├── apps/
│   └── web/                    # the only deployable app — consumer + admin shells
├── packages/
│   ├── config-typescript/      # base.json, react-library.json, nextjs.json
│   ├── config-eslint/          # ESLint 9 flat configs: base → react → next
│   ├── config-tailwind/        # Tailwind preset mapping design tokens → utilities
│   ├── ui/                     # design-system atoms, tokens, Theme/Direction providers
│   ├── api-client/             # Axios instances, interceptors, TanStack Query hooks, DTOs
│   ├── store/                  # Zustand stores
│   └── utils/                  # pure helpers (money, dates, slug, bytes, debounce, Result)
├── package.json                # workspaces: ["apps/*", "packages/*"]
├── turbo.json
├── tsconfig.json               # thin, editor support only
├── .prettierrc
└── .gitignore
```

### Package names

Use these exact strings in every dependency block (ARCHITECTURE.md §1.2):

| Path                         | Package name              |
| ---------------------------- | ------------------------- |
| `apps/web`                   | `web`                     |
| `packages/config-typescript` | `@repo/config-typescript` |
| `packages/config-eslint`     | `@repo/config-eslint`     |
| `packages/config-tailwind`   | `@repo/config-tailwind`   |
| `packages/ui`                | `@repo/ui`                |
| `packages/api-client`        | `@repo/api-client`        |
| `packages/store`             | `@repo/store`             |
| `packages/utils`             | `@repo/utils`             |

## Why npm workspaces and not pnpm

**pnpm is not installed on the build machine and will not be** (ARCHITECTURE.md §0: Node 24,
npm 9, no pnpm, no Docker daemon). The workspace is therefore driven by npm workspaces, and
Turborepo runs on top of it exactly as it would on pnpm.

Two consequences you must not forget:

1. **npm does not understand the `workspace:*` protocol.** Internal dependencies are declared
   as `"*"`:

   ```json
   "dependencies": { "@repo/ui": "*", "@repo/api-client": "*", "@repo/utils": "*" }
   ```

   A `workspace:*` range will install from the public registry — or fail — rather than link.

2. **There is no `pnpm-workspace.yaml`.** The workspace globs live in the root `package.json`.

npm hoists to `frontend/node_modules`, so a package can accidentally resolve a dependency it
never declared. Declare every direct dependency in the package that imports it, even when it
already works without.

## Commands

Run everything from `frontend/`.

| Command              | What it does                                             |
| -------------------- | -------------------------------------------------------- |
| `npm install`        | Installs and links the whole workspace                    |
| `npm run dev`        | `turbo run dev` — all apps in watch mode                  |
| `npm run build`      | `turbo run build` — topological, `^build` first           |
| `npm run start`      | `turbo run start` — serves the production build           |
| `npm run lint`       | `turbo run lint` — `eslint . --max-warnings 0` per package |
| `npm run lint:fix`   | Same, with `--fix`                                        |
| `npm run typecheck`  | `turbo run typecheck` (`type-check` is an alias)          |
| `npm run test`       | `turbo run test` — Vitest                                 |
| `npm run test:watch` | Vitest in watch mode                                      |
| `npm run format`     | Prettier over the workspace                               |
| `npm run clean`      | Removes build output and Turbo caches                     |

Scope to one package with Turbo's filter: `npm run build -- --filter=web`,
`npm run test -- --filter=@repo/utils`.

### Turbo caching and environment variables

`turbo.json` declares `globalEnv` for the `NEXT_PUBLIC_*` surface and `globalDependencies` for
`tsconfig.json`, `.prettierrc` and both config packages. ESLint enforces the other half:
`turbo/no-undeclared-env-vars` fails on any `process.env.X` read that is not declared, which is
what keeps a cached build from being wrong.

## Rules that outrank convenience

- **All API access goes through `@repo/api-client`.** No component, page, Server Component or
  store calls `fetch` or `axios` directly. The client owns the base URL, the cookie forwarding,
  the CSRF header, the response envelope, the error-code mapping and the TanStack query keys.
  A one-off `fetch` bypasses all of it and will be sent back in review.
- **All design-system atoms come from `@repo/ui`.** Buttons, inputs, dialogs, toasts, skeletons
  and tokens live there. `apps/web/src/components/` holds app-level *composites* built out of
  those atoms, never a second Button.
- **Authorisation is decided by the API.** Anything role-shaped in the web app is presentation
  and carries a comment saying so. `middleware.ts` handles locale negotiation and shell routing
  only — it is never a security boundary.
- TypeScript `strict`, no `any`, no `console.log`. All three are lint errors.
- Every screen ships all six D-5 states: default, loading, empty, error, permission-denied,
  success.
- The UI ships `en` and `ur`. Urdu is right-to-left, so layout uses **logical** properties
  (`ms-`/`me-`, `ps-`/`pe-`, `text-start`/`text-end`) — never `ml-`/`pr-`/`text-left`.
  `@repo/config-eslint` flags the physical ones.
- Consumer copy passes the PRD §9.4 check: Drape is a **shortlisting** tool, never a preview.
  Nothing promises accuracy or says "see yourself in".

## Adding a package

1. `packages/<name>/` with `package.json` named `@repo/<name>`.
2. A `tsconfig.json` extending `@repo/config-typescript/base.json` (or `react-library.json`).
3. An `eslint.config.js` re-exporting the right `@repo/config-eslint` entry point.
4. `lint`, `typecheck`, `test` and `clean` scripts, so the Turbo tasks reach it.
5. If `apps/web` consumes it, add it to `transpilePackages` in `next.config.ts`.
