# Drape — working notes for agents

## Read before writing code

1. `docs/PRD-drape-v1.md` — product requirements. Authoritative on behaviour.
2. `docs/ARCHITECTURE.md` — the technical contract. Authoritative on structure, naming,
   entity columns, error codes, endpoints and tokens. If code and this file disagree, the
   file is right and the code is a defect.
3. `docs/PROJECT-PLAN.md` — workstream breakdown and locked decisions.

## Layout

- `backend/` — NestJS monorepo, one app (`apps/api`) plus `libs/{common,database,storage,notifications}`.
  Aliases: `@library/common`, `@library/database`, `@library/storage`, `@library/notifications`, `@api/*`.
  **No RabbitMQ** — PRD §8.2 rules out a queue in V1.
- `frontend/` — Turborepo with **npm workspaces** (pnpm is not installed). One app
  (`apps/web`) serving both roles, plus `packages/{ui,api-client,store,utils,config-*}`.

## Non-negotiables

- TypeScript strict. No `any`. No `console.log` — use the NestJS `Logger` / structured logger.
- No secret ever has a fallback default. Missing env fails at boot.
- TypeORM `synchronize` is always `false`. Schema changes go through reversible migrations.
- Every unique index carries `WHERE "deletedAt" IS NULL`.
- `quota_ledger` and `usage_ledger` are append-only. Remaining quota and budget are
  **derived**, never stored in a mutable column.
- Every API route declares `@Public()` or `@Roles(...)`. `npm run check:guards` enforces it.
- Authorisation is decided in the API only. Anything role-shaped in the web app is
  presentation and must carry a comment saying so.
- Images live under `STORAGE_ROOT`, **outside the repo**. The database stores the relative
  key. Never build an absolute path into a column, a fixture or a test.
- Admins can never read a consumer's photo (PRD S-10). Enforce it in the query layer and
  cover it with a test.
- Consumer-facing copy passes the PRD §9.4 check: it is a **shortlisting** tool, never a
  preview. Nothing promises accuracy or says "see yourself in".
- Every screen ships all six D-5 states: default, loading, empty, error, permission-denied,
  success.

## Environment

Windows, Node 24, npm 9. No pnpm, no docker daemon, no local `psql` on the dev machine —
so integration work that needs a live database is written and wired but verified here by
typecheck, lint, build and unit tests.
