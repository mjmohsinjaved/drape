# Drape API (`drape-api`)

The NestJS backend for Drape. **One deployable app** — `apps/api` — plus four libraries
(`libs/common`, `libs/database`, `libs/storage`, `libs/notifications`). No queue, no
gateway/service split: PRD §8.2 rules out an external broker in V1.

This service holds every secret and is the only process with database credentials.
Structure, naming, error codes, routes and tokens are governed by
[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — if code and that document disagree,
the document is right.

---

## Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| Node.js | ≥ 20 (developed on 24) | |
| npm | ≥ 9 | **No pnpm.** |
| PostgreSQL | 16 | `docker compose up -d` brings one up locally |
| Docker Desktop | optional | Only for the local database; the app itself runs on the host |

A writable directory for uploaded media — see [Storage](#storage) — **outside this repository**.

---

## Getting started

```bash
# 1. Environment. Every secret is required and none has a fallback default;
#    the API refuses to boot if one is missing.
cp .env.example .env

# 2. Database (local only — see the header comment in docker-compose.yml)
docker compose up -d

# 3. Dependencies
npm install

# 4. Storage root — creates the directory tree under STORAGE_ROOT
npm run storage:ensure

# 5. Schema and seed data
npm run migration:run
npm run seed            # first admin, default settings, sample categories, policy version

# 6. Run
npm run start:dev
```

- API base URL — **http://localhost:4000/api/v1**
- Swagger UI — **http://localhost:4000/api/docs**
- Adminer (database browser) — http://localhost:8080

---

## Storage

> **`STORAGE_ROOT` must point at a directory OUTSIDE this repository.**

Uploaded media never lives in the repo. The API writes every image — garment photos,
consumer person-photos, renders, thumbnails, brand assets — under `STORAGE_ROOT`
(default `D:/drape-storage`). That path is resolved once at module init and asserted to be
absolute and **not** inside the repository root; startup fails otherwise. The directory is
never symlinked into the tree, never committed, and never served by a static file handler.

**The database stores only the relative storage key** — for example
`renders/2026/08/9f3c…​.webp` — never an absolute path, never a URL. Absolute paths are
built at read time from the configured root, and files are delivered exclusively through
short-lived HMAC-signed URLs issued by `GET /api/v1/files/:token`.

```
<STORAGE_ROOT>/            # e.g. D:/drape-storage
├── garments/              ├── person-photos/     ├── reference-models/
├── categories/            ├── renders/           ├── brand/
└── thumbnails/
```

Never write an absolute path into a column, a fixture, a seed or a test.

---

## Commands

### Run

| Command | What it does |
| --- | --- |
| `npm run start` | Start the API once |
| `npm run start:dev` | Start with watch mode |
| `npm run start:debug` | Watch mode with the Node inspector attached |
| `npm run build` | Compile `apps/api` into `dist/` |
| `npm run start:prod` | Run the compiled build (`node dist/apps/api/main`) |

### Database

All migration commands run through `ts-node -r tsconfig-paths/register` against
`libs/database/src/data-sources/api.data-source.ts`. `synchronize` is `false` in every
environment — schema changes only ever happen through a reviewed, reversible migration.

| Command | What it does |
| --- | --- |
| `npm run migration:create` | Create an empty migration in `libs/database/src/migrations/api/` |
| `npm run migration:generate` | Generate a migration by diffing entities against the database |
| `npm run migration:run` | Apply pending migrations (tracking table `api_migrations`) |
| `npm run migration:revert` | Roll the last migration back |
| `npm run migration:show` | List applied and pending migrations |
| `npm run seed` | Run the seeders in `apps/api/src/seeders/` |

### Quality gates

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` across apps, libs and scripts |
| `npm run lint` | ESLint, `--max-warnings 0` |
| `npm run lint:fix` | ESLint with autofix |
| `npm run format` | Prettier write |
| `npm test` | Unit tests (`*.spec.ts`) |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:cov` | Unit tests with coverage — the build fails below 70% lines/statements |
| `npm run test:e2e` | End-to-end tests (`apps/api/test/jest-e2e.json`) |
| `npm run check:guards` | Fails if any route handler lacks `@Public()` or `@Roles(...)` (B-5) |
| `npm run openapi:generate` | Writes `openapi.json` for the frontend contract check (B-4) |
| `npm run storage:ensure` | Creates the `STORAGE_ROOT` directory tree if it is missing |

Before opening a pull request:

```bash
npm run typecheck && npm run lint && npm test && npm run check:guards
```

---

## Layout

```
backend/
├── apps/api/          # the single deployable application
├── libs/common/       # @library/common       — guards, filters, decorators, error codes
├── libs/database/     # @library/database     — data source, base entities, migrations
├── libs/storage/      # @library/storage      — local-disk driver, signed URLs, sharp
├── libs/notifications/# @library/notifications— email/SMS drivers and templates
└── scripts/           # check-route-guards.ts, export-openapi.ts, ensure-storage-root.ts
```

Import rules (enforced by ESLint): always import from a library barrel
(`@library/common`, never `@library/common/guards/roles.guard`), and `libs/*` must never
import from `@api/*`.

---

## Notes

- **No secret has a working fallback default.** Missing configuration fails at boot, loudly.
- `TRYON_DRIVER=mock` in local development and CI. The upstream TryOnCloud account has a
  ten-image budget and tests must never spend it.
- Every route declares `@Public()` or `@Roles(...)`; authorisation is decided here and
  nowhere else. Object-level ownership is checked in the service, not the guard.
- No `console` — use the Nest `Logger` or the structured logger in `@library/common`.
