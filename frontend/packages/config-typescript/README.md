# @repo/config-typescript

Shared `tsconfig` bases for the Drape frontend workspace. JSON only — nothing is built here.

| File                 | Extend it from                                       |
| -------------------- | ---------------------------------------------------- |
| `base.json`          | Any non-React package (`@repo/utils`, `@repo/store`) |
| `react-library.json` | React packages (`@repo/ui`, `@repo/api-client`)      |
| `library.json`       | Alias of `react-library.json` (ARCHITECTURE.md name) |
| `nextjs.json`        | `apps/web`                                            |

```json
{
  "extends": "@repo/config-typescript/react-library.json",
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

Every workspace package extends one of these. No package redefines `strict`, `target` or
`moduleResolution` locally — if a setting needs to change, it changes here.

## The strictness dial

`base.json` turns on everything that catches real bugs:

- `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`
- `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
- `forceConsistentCasingInFileNames` (mandatory: the dev machine is Windows, CI is Linux)
- `useUnknownInCatchVariables`

`exactOptionalPropertyTypes` is deliberately **off**. It is correct in principle, but React,
Next.js and Radix typings pass `prop: undefined` freely, so turning it on buries real errors
under hundreds of library-boundary false positives. Revisit only if the ecosystem catches up.

`declaration` / `declarationMap` are on in the base for packages that do emit; packages
consumed source-first (`@repo/utils`) turn them off alongside `noEmit: true`.
