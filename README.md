# Drape — Virtual Fitting Room

A virtual fitting room for a single formalwear brand, built on the TryOnCloud API.
One login, one dashboard route, two experiences resolved server-side by role.

- **`backend/`** — NestJS API service. All business logic, authentication, authorisation,
  quota and budget enforcement, the TryOnCloud proxy, storage signing, jobs, and every
  database write. The only service holding secrets or database credentials.
- **`frontend/`** — Next.js web service. All UI for both roles. Holds no secrets and no
  business rules.
- **`docs/`** — [PRD](docs/PRD-drape-v1.md) · [Delivery plan](docs/PROJECT-PLAN.md) ·
  [Architecture contract](docs/ARCHITECTURE.md)

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20+ (built on 24) | |
| npm | 9+ | The frontend uses npm workspaces, not pnpm |
| PostgreSQL | 16 | `docker compose up -d` inside `backend/` brings one up |

## Image storage

Uploaded images are **never stored inside this repository**. The API writes them to a
directory given by `STORAGE_ROOT` (default `D:/drape-storage`) and stores only the
relative storage key in Postgres. Files are served through short-lived HMAC-signed URLs
issued by the API, so the directory itself is never exposed to the web.

```
<STORAGE_ROOT>/
├── garments/         ├── person-photos/   ├── reference-models/
├── categories/       ├── renders/         ├── brand/
└── thumbnails/
```

## Getting started

```bash
# 1. database
cd backend && docker compose up -d

# 2. api
cd backend
cp .env.example .env          # then fill in the secrets — none have defaults
npm install
npm run migration:run
npm run seed                  # creates the first admin from SEED_ADMIN_* env
npm run start:dev             # http://localhost:4000/api/v1  ·  docs at /api/docs

# 3. web
cd frontend
cp apps/web/.env.example apps/web/.env.development
npm install
npm run dev                   # http://localhost:3000
```

## Checks

```bash
cd backend  && npm run typecheck && npm run lint && npm test
cd frontend && npm run typecheck && npm run lint && npm test
```

`npm run check:guards` in `backend/` fails the build if any route handler lacks an
explicit `@Public()` or `@Roles(...)` declaration (PRD B-5, E-16).
