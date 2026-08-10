# Drape — Virtual Fitting Room

A virtual fitting room for a single formalwear brand, built on the TryOnCloud API. A
customer uploads one full-length photograph, picks a piece from the catalogue, and gets an
image of that piece on her in about twenty seconds. Studio staff run the catalogue from the
same application.

One login, one dashboard route, two experiences resolved server-side by role.

> **What this is not.** A try-on is a **shortlisting aid**, never a preview. Nothing in the
> product promises accuracy or says "see yourself in" (PRD §9.4). Fabric fall, embroidery
> detail and length differ in person, and every screen that shows a render says so.

---

## Contents

1. [How it is put together](#1-how-it-is-put-together)
2. [Tech stack](#2-tech-stack)
3. [Repository layout](#3-repository-layout)
4. [Setting up on a new machine](#4-setting-up-on-a-new-machine)
5. [The TryOnCloud API key](#5-the-tryoncloud-api-key)
6. [Email and SMS in development](#6-email-and-sms-in-development)
7. [The UI flow](#7-the-ui-flow)
8. [How one try-on actually runs](#8-how-one-try-on-actually-runs)
9. [Everyday commands](#9-everyday-commands)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. How it is put together

Two services, deployed independently, talking over one HTTP contract.

```
                    ┌───────────────────────────────┐
   browser ────────►│  Next.js web  ·  :3000        │
                    │  All UI, both roles.          │
                    │  No secrets. No business rules.│
                    └──────────────┬────────────────┘
                                   │  credentialed fetch (cookie + CSRF)
                                   ▼
                    ┌───────────────────────────────┐
                    │  NestJS API  ·  :4000         │
                    │  Every rule, every write,     │
                    │  every credential.            │
                    └───┬───────────┬───────────┬───┘
                        │           │           │
                   PostgreSQL   STORAGE_ROOT  TryOnCloud
                     (:5432)     (on disk)     (upstream)
```

Three boundaries are worth knowing before you touch anything:

- **The web service holds no secrets.** No TryOnCloud key, no database URL, no session
  secret. The browser calls the API directly; there is no proxy layer. Anything role-shaped
  in the web app is presentation only and carries a comment saying so.
- **Authorisation is decided in the API, always.** Every route declares `@Public()` or
  `@Roles(...)`, and `npm run check:guards` fails the build if one does not.
- **Images never live in the repository.** The API writes them under `STORAGE_ROOT` on disk
  and stores only the relative key in Postgres. Files reach the browser through short-lived
  HMAC-signed URLs, so the directory is never web-exposed.

There is **no message queue**. A try-on is awaited inside the request while the job row
carries state and an SSE stream carries progress.

---

## 2. Tech stack

### API — `backend/`

| Concern | Choice |
|---|---|
| Runtime | Node.js 24, TypeScript 5.9 (strict, no `any`) |
| Framework | NestJS 11, Express platform, monorepo layout |
| Database | PostgreSQL 16 via TypeORM 0.3 — `synchronize` is always `false` |
| Auth | Custom server-side sessions. **No NextAuth, no JWT.** Argon2id password hashing, TOTP second factor via `otplib` |
| Validation | `class-validator` / `class-transformer` on every DTO and on env at boot |
| Images | `sharp` for thumbnails and metadata |
| Upstream | `axios` against TryOnCloud, behind a swappable `TryOnProvider` |
| Scheduling | `@nestjs/schedule` for retention and outbox sweeps — no queue |
| Email / SMS | `nodemailer`; pluggable drivers, `console` by default |
| API docs | `@nestjs/swagger` at `/api/docs` when `EXPOSE_API_DOCS=true` |
| Tests | Jest + ts-jest |

### Web — `frontend/`

| Concern | Choice |
|---|---|
| Framework | Next.js 15 App Router, React 19, React Server Components |
| Monorepo | Turborepo with **npm workspaces** — pnpm is not used |
| Styling | Tailwind CSS v4, `class-variance-authority`, `tailwind-merge` |
| Components | Radix UI primitives wrapped in the local `@repo/ui` package |
| Server state | TanStack Query 5 |
| Client state | Zustand (`@repo/store`) |
| HTTP | Axios with cookie, CSRF and request-id interceptors (`@repo/api-client`) |
| i18n | `next-intl` — English and Urdu, with RTL |
| Env | `@t3-oss/env-nextjs` + Zod, validated at build |
| Tests | Vitest + Testing Library |

### Workspace packages

| Package | Contains |
|---|---|
| `@repo/ui` | The design system: primitives, gallery, states, layout |
| `@repo/api-client` | Axios instance, interceptors, query client, DTO types, error codes |
| `@repo/store` | Zustand stores (auth presentation state, try-on tray) |
| `@repo/utils` | Shared pure helpers |
| `@repo/config-*` | Shared ESLint, Tailwind and TypeScript configs |

---

## 3. Repository layout

```
backend/
├── apps/api/               NestJS application — one app, feature modules under src/modules
│   ├── src/modules/        auth, users, garments, catalog, photos, tryon, results,
│   │                       shortlist, enquiries, quota, settings, audit, retention …
│   ├── src/seeders/        settings, admin, policy version, categories, reference models
│   └── test/               e2e specs and factories
├── libs/
│   ├── common/             error codes, exceptions, metrics, guards, decorators
│   ├── database/           data sources and migrations
│   ├── storage/            storage drivers, key builder, signed URLs, image service
│   └── notifications/      email and SMS drivers, templates
├── scripts/                check-route-guards, export-openapi, ensure-storage-root, seed-check
└── docker-compose.yml      PostgreSQL 16 + Adminer, local development only

frontend/
├── apps/web/               the Next.js app, both roles
│   └── src/
│       ├── app/[locale]/   (public) · (auth) · (consumer) · admin · dashboard
│       ├── features/       auth, photos, catalog-browse, tryon, renders, shortlist …
│       └── i18n/messages/  en/ and ur/ message bundles
└── packages/               ui · api-client · store · utils · config-*

docs/
├── PRD-drape-v1.md         product requirements — authoritative on behaviour
├── ARCHITECTURE.md         the technical contract — authoritative on structure
├── PROJECT-PLAN.md         workstreams and locked decisions
└── RUNBOOK.md              operational procedures, including key rotation
```

---

## 4. Setting up on a new machine

### 4.0 Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20+ (developed on 24) | `node -v` |
| npm | 9+ | npm workspaces; **do not use pnpm or yarn** |
| PostgreSQL | 16 | Native install or the bundled `docker compose` |
| Git | any recent | |
| Docker Desktop | optional | Only if you want Postgres from `docker compose` |

On Windows, `sharp` and `argon2` install prebuilt binaries. If either falls back to
building from source you will need the Visual Studio C++ build tools.

### 4.1 Clone

```bash
git clone https://github.com/mjmohsinjaved/drape.git
cd drape
```

### 4.2 Create the storage directory

Images live **outside the repository**, and that is enforced rather than suggested:
`STORAGE_ROOT` must be an absolute path, and the API refuses to start if it resolves inside
the checkout or contains it. Consumer photographs one `git add -A` away from a commit is
the failure being designed out.

Pick a directory now; `npm run storage:ensure` in step 4.5 creates it and its prefix tree
once `.env` names it.

```bash
# Windows
mkdir D:\drape-storage

# macOS / Linux
mkdir -p ~/drape-storage
```

The prefix tree inside it:

```
<STORAGE_ROOT>/
├── garments/      ├── person-photos/   ├── reference-models/   ├── exports/
├── categories/    ├── renders/         ├── brand/              └── thumbnails/
```

### 4.3 Start PostgreSQL

**Option A — Docker.** The compose file reads `backend/.env`, so write that file first
(step 4.4) and come back:

```bash
cd backend
docker compose up -d      # Postgres on :5432, Adminer on http://localhost:8080
```

**Option B — a native install.** Create the database and user yourself, then point
`DATABASE_URL` at it:

```sql
CREATE DATABASE drape;
CREATE USER drape WITH ENCRYPTED PASSWORD 'your-password';
GRANT ALL PRIVILEGES ON DATABASE drape TO drape;
```

### 4.4 Configure the API

```bash
cd backend
cp .env.example .env
```

`.env` is git-ignored and every secret in it is required with **no fallback default** — a
missing one fails at boot, never at request time. Generate the four 64-hex-character keys:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run that four times, once per key. Then fill in:

| Variable | What to put | Example |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `postgresql://drape:pw@localhost:5432/drape` |
| `SESSION_COOKIE_DOMAIN` | Parent domain covering both origins | `.localhost` |
| `SESSION_SECRET` | 64 hex chars | *generated* |
| `CSRF_SECRET` | 64 hex chars | *generated* |
| `TWOFA_ENCRYPTION_KEY` | 64 hex chars | *generated* |
| `STORAGE_URL_SECRET` | 64 hex chars | *generated* |
| `STORAGE_ROOT` | The directory from 4.2 | `D:/drape-storage` |
| `SEED_ADMIN_EMAIL` | First admin's login | `you@example.com` |
| `SEED_ADMIN_PASSWORD` | First admin's password | *your choice* |
| `SEED_ADMIN_NAME` | Display name | `Studio Admin` |
| `POSTGRES_PASSWORD` | Only if using `docker compose` | must match `DATABASE_URL` |

Leave `TRYONCLOUD_API_KEY` empty for now — see [section 5](#5-the-tryoncloud-api-key).
`TRYON_DRIVER=mock` is the default and needs no key.

Rotating `SESSION_SECRET` logs every user out. Rotating `STORAGE_URL_SECRET` invalidates
every signed URL already handed out.

### 4.5 Install, migrate, seed

```bash
cd backend
npm install
npm run storage:ensure     # creates STORAGE_ROOT and its prefix tree, refusing a path inside the repo
npm run migration:run      # creates the schema — synchronize is always false
npm run seed               # settings, first admin, policy version, categories, reference models
```

`npm run seed` is idempotent, so re-running it is safe. It creates:

- **Settings** — quota per consumer, monthly platform budget, warning thresholds.
- **The first admin** — from `SEED_ADMIN_*`. This is the only way to create one; there is
  no public admin signup. Further staff are invited from `/admin/team`.
- **The current policy version** — the consent text every consumer must accept.
- **Categories** and **reference models** — the stand-in figures used for admin test
  renders, so a consumer photograph is never involved in catalogue work.

### 4.6 Configure and install the web app

```bash
cd frontend
cp apps/web/.env.example apps/web/.env.development
npm install
```

Defaults in that file work for local development:

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:4000/api/v1` | Browser → API |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Canonical origin for share links and OG tags |
| `NEXT_PUBLIC_APP_ENV` | `development` | Distinct from `NODE_ENV` |
| `API_INTERNAL_URL` | same as above | Server Components → API |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `en` | `en` or `ur` |

### 4.7 Run both services

Two terminals:

```bash
# terminal 1
cd backend && npm run start:dev      # http://localhost:4000/api/v1

# terminal 2
cd frontend && npm run dev           # http://localhost:3000
```

Check the API is alive:

```bash
curl http://localhost:4000/api/v1/health
```

Set `EXPOSE_API_DOCS=true` in `backend/.env` for Swagger at
`http://localhost:4000/api/docs`.

### 4.8 First login

Open `http://localhost:3000/en/login` and sign in with `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD`. Admins carry a mandatory TOTP second factor, so the first sign-in
walks through enrolment: scan the QR with any authenticator app and store the recovery
codes.

Both roles land on `/en/dashboard`, which resolves server-side by role — admins get the
studio console, consumers get the fitting room.

---

## 5. The TryOnCloud API key

### Two drivers

| `TRYON_DRIVER` | Behaviour | Cost |
|---|---|---|
| `mock` *(default)* | Deterministic placeholder render, configurable latency and failure rate | free |
| `http` | Real calls to TryOnCloud | **one image per cache miss** |

Keep `mock` for everything except deliberate end-to-end checks. It exercises the same retry
logic, the same failure taxonomy and the same seven-second wait UI, so almost nothing about
the app behaves differently.

### Getting a key

1. Sign in at **https://www.tryoncloud.com/dashboard/developer-api**.
2. Create a developer API key. Keys carry a `tk_dev_v1_` prefix and are sent whole.
3. Put it in `backend/.env` — **never** anywhere under `frontend/`:

```dotenv
TRYON_DRIVER=http
TRYONCLOUD_BASE_URL=https://www.tryoncloud.com/api/v1
TRYONCLOUD_API_KEY=tk_dev_v1_xxxxxxxxxxxxxxxxxxxx
```

4. Restart the API. Startup validation makes both values required when the driver is
   `http`, so a missing key fails the boot rather than the first generation. The log
   confirms the choice:

   ```
   WARN [TryOnProviderFactory] TRYON_DRIVER=http — generations will call TryOnCloud
        and spend the upstream budget.
   ```

### The contract, for reference

`POST {base}/generate`, multipart with `garment_image` and `person_image`, authenticated
with an `X-API-KEY` header — *not* `Authorization: Bearer`. The response is the rendered
image itself, not JSON and not a polling URL. A render takes roughly twenty seconds.

### Things worth knowing before you flip it

- **The key is API-only** (PRD B-1). The web service has no code path that could reach it,
  and it is read through one accessor so every use is greppable.
- **The cache is keyed on content**, not on driver:
  `sha256(garmentSourceHash + personPhotoHash + TRYON_API_VERSION)`. A render produced on
  `mock` is served again on `http` for the same garment and photo. Switch the driver
  *before* your first real try-on, or bump `TRYON_API_VERSION` to invalidate the cache.
- **Development accounts are small.** Every cache miss is a real image. Nothing in the app
  knows your remaining balance; it simply starts receiving rate-limit or auth errors when
  the account runs out.

---

## 6. Email and SMS in development

Both default to `console`, which writes the message to the API log instead of sending it.
That is enough for the whole local flow — verification links, password resets and staff
invitations all appear in the terminal.

For real delivery set `EMAIL_DRIVER=smtp` and fill in `SMTP_*`, or `SMS_DRIVER=http` and
fill in `SMS_HTTP_*`. Both sets become required only when their driver is selected.

---

## 7. The UI flow

Every route is locale-prefixed — `/en/...` or `/ur/...`. Urdu renders right-to-left
throughout.

Every screen ships all six states: default, loading, empty, error, permission-denied and
success. If you are adding a screen, it needs all six.

### 7.1 The customer journey

```
  browse ──► garment ──► [sign in] ──► [consent] ──► [add photo] ──► try on
   :public    :public                                                   │
                                                                        ▼
              enquiry ◄── shortlist ◄─────────────────────────────── result
```

| Step | Route | What happens |
|---|---|---|
| **Browse** | `/en/browse` | Public. Filter by category, colour, fabric, embellishment weight, price. Only garments that are published *and* carry an approved test render are visible — anything else is indistinguishable from a garment that never existed. |
| **Garment detail** | `/en/garments/<slug>` | Public. Gallery, price, fabric, sizes, and one prominent **Try it on**. |
| **Sign up / sign in** | `/en/signup`, `/en/login` | Consumers self-register. Email verification is required before a try-on if `quota.requireEmailVerification` is on. |
| **Consent** | `/en/consent` | First try-on only, and again whenever the policy version changes. Records the version, timestamp, IP and locale. |
| **Add a photo** | `/en/photos/new` | Guidance illustrations, then client-side checks — resolution, full-body framing, blur, single subject, lighting — before a byte is uploaded, so the reason is specific and actionable. Any background is acceptable. The API re-derives every check from the stored bytes and is the enforcement point. |
| **Your photos** | `/en/photos` | Up to a configured maximum. Exactly one is *active*, and that is the one a try-on uses. |
| **Try on** | button → `/en/tryon/<jobId>` | Staged progress over SSE: uploading → generating → finishing. |
| **Result** | `/en/renders/<resultId>` | The render, with the shortlisting caption. Shortlist it, share it, or start an enquiry. |
| **History** | `/en/renders` | Every past render, rendered entirely from snapshots taken at generation time — it still reads correctly after the photo is deleted or the garment is withdrawn. |
| **Shortlist** | `/en/shortlist` | Saved pieces. |
| **Share** | `/en/share` | Expiring public links to a render: `/en/s/<token>`. |
| **Enquiry** | `/en/enquiries/new` | Sends the studio a message about a piece. |
| **Account** | `/en/account` | Profile, security, notification preferences, data export and account deletion. |

**Studio staff can never see a consumer's photograph.** That is enforced in the query
layer and covered by a test, not by convention.

### 7.2 The studio journey

```
  category ──► garment ──► images ──► mark try-on source ──► test render
                                                                  │
                                                            approve │ reject
                                                                  ▼
                                                              publish ──► live
```

| Step | Route | What happens |
|---|---|---|
| **Categories** | `/en/admin/categories` | Create the taxonomy first; a garment needs one. |
| **New garment** | `/en/admin/catalog/new` | Title, category, price, fabric, sizes, colours, embellishment weight, sale or rental. Starts as a draft. |
| **Photographs** | `/en/admin/catalog/<id>` | Upload and reorder. Each is scored for quality on upload. |
| **Try-on source** | same screen | Mark exactly one image as the try-on source. This is the image sent upstream — not the hero shot. |
| **Test render** | `/en/admin/catalog/<id>/test-render` | Runs a generation against a **reference model**, never a consumer photograph. Charged to the platform budget under its own reason so admin work is separable from customer demand. |
| **Approve** | same screen | An admin looks at the result and approves or rejects it. |
| **Publish** | `/en/admin/catalog/<id>` | Reports whatever is still missing — try-on source, approved test render, quality score — but does not refuse. The conditions are advice recorded in the audit trail, not a veto. Two consequences worth knowing: published with an approved test render but **no try-on source**, a piece appears in the catalogue and fails when a customer tries it on; published with **no approved test render**, it stays invisible to customers, because browse and the try-on guard both still require one. |
| **Catalogue health** | `/en/admin/catalog/health` | Pieces flagged after a consumer generation failed against them. |
| **Consumers** | `/en/admin/consumers` | Accounts, quota and status. Never their photographs. |
| **Moderation** | `/en/admin/moderation` | Photographs an upstream rejection queued for review. |
| **Enquiries** | `/en/admin/enquiries` | The customer enquiry inbox. |
| **Usage & analytics** | `/en/admin/usage`, `/en/admin/analytics` | Budget burn, cache hit rate, failure breakdown by error code, funnel. |
| **Audit** | `/en/admin/audit` | Every privileged action, append-only. |
| **Team** | `/en/admin/team` | Invite staff. |
| **Settings** | `/en/admin/settings` | Quota, budget, quality thresholds, retention, and the consent policy text. |

---

## 8. How one try-on actually runs

Useful when something goes wrong, because the failure tells you which step you are on.

1. **The click.** The browser mints a UUID idempotency key and posts
   `{ garmentId, idempotencyKey }`. No `personPhotoId` means "use my active photo". The web
   app pre-checks nothing — every rule belongs to the API.

2. **The guard chain**, in this fixed order, entirely before anything is spent: session →
   account active → email verified → consent current → monthly quota → per-hour and per-IP
   rate limits → platform budget → garment published with an approved test render → the
   photo belongs to this user and is not blocked → idempotency key free. The first failure
   wins, and **no job row is written for a rejection**.

   Which failure surfaces decides which screen the customer lands on, which is why the
   order is fixed and tested.

3. **The job row.** Inserted as `RUNNING`. The `UNIQUE (userId, idempotencyKey)` index *is*
   the idempotency check — a double-click loses the insert race and is told to attach to the
   job already running rather than starting a second one.

4. **Cache lookup.** `sha256(garmentSourceHash + personPhotoHash + TRYON_API_VERSION)`. A hit
   copies the existing render into her namespace and **charges nothing** — no quota, no
   budget, no upstream call. This is the single largest cost control in the product.

5. **The upstream call.** Both images are read from `STORAGE_ROOT` and posted as multipart.
   Bounded: a per-attempt timeout, at most `TRYON_MAX_ATTEMPTS` attempts with exponential
   backoff, a hard ceiling on the response body, and typed errors only — no upstream string
   ever reaches the customer.

6. **Storage.** The render and its thumbnail are written under `renders/<userId>/`. The
   stored file is clean; the watermark is composited at download time.

7. **The charge — and only now.** The job is claimed as `SUCCEEDED` *only if it is still
   `RUNNING`*, so a cancellation wins the race. Then one append-only row in `quota_ledger`
   and one in `usage_ledger`. Remaining quota is derived from the ledger, never stored in a
   mutable column.

   **Failed jobs never consume quota or budget.** There is no early charge and no refund
   path, because a refund path is somewhere for a charge to survive a rollback.

8. **The stream closes** with the result, and the browser routes to the render.

On failure the job is marked `FAILED` with its error code, any charge is released, any
written render is withdrawn, and the customer sees the copy written for that specific code.
Some codes do more: a garment the upstream cannot read is flagged for catalogue review, a
moderation rejection queues the photograph for a human, and a misconfigured provider pages
an admin.

---

## 9. Everyday commands

```bash
# backend/
npm run start:dev          # watch mode
npm run start:prod         # run the built output
npm run build
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run check:guards       # fails if any route lacks @Public() or @Roles()
npm run migration:generate # after an entity change
npm run migration:run
npm run migration:revert
npm run seed
npm run openapi:export

# frontend/
npm run dev
npm run build
npm run typecheck
npm run lint
npm test
```

Before opening a pull request:

```bash
cd backend  && npm run typecheck && npm run lint && npm test && npm run check:guards
cd frontend && npm run typecheck && npm run lint && npm test
```

### Rules the build enforces

- TypeScript strict. No `any`. No `console.log` — use the Nest `Logger`.
- No secret has a fallback default. A missing one fails at boot.
- TypeORM `synchronize` is always `false`; schema changes go through reversible migrations.
- Every unique index carries `WHERE "deletedAt" IS NULL`.
- `quota_ledger` and `usage_ledger` are append-only.
- Every route declares `@Public()` or `@Roles(...)`.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| API exits at boot naming a variable | A required secret is missing. Deliberate — there are no defaults. | Fill it in `backend/.env` |
| `EADDRINUSE :::3000` / `:::4000` | A previous dev server is still running | Kill it, or change `API_PORT` |
| `Module parse failed: Cannot parse JSON` | A malformed i18n message file | `node -e "JSON.parse(require('fs').readFileSync('<file>','utf8'))"` over `src/i18n/messages/**` |
| Login succeeds, then every call is 401 | `SESSION_COOKIE_DOMAIN` does not cover both origins | `.localhost` locally |
| Images 404 through the API | `STORAGE_ROOT` wrong, or `STORAGE_URL_SECRET` changed after the URLs were issued | Check the path; regenerate the page |
| `TRYON_PROVIDER_MISCONFIGURED` | Upstream answered 401/403 | The key is wrong, or not activated |
| `UPSTREAM_TIMEOUT` on every attempt | `TRYON_TIMEOUT_MS` is below the real render time (~20 s) | Raise it |
| Garment not visible in browse | Not published, or no approved test render | Both are required; a hidden garment is deliberately indistinguishable from a missing one |
| `Functions cannot be passed directly to Client Components` | A server component passed a callback to a `'use client'` component | Pass data, not behaviour |

Every API error response carries a `requestId`. The same value appears on the error screen
as **Reference** and in the API log line, so a screenshot is enough to find the request.

---

## Documentation

`docs/` is authoritative, and outranks the code where the two disagree.

| Document | Authoritative on |
|---|---|
| [PRD](docs/PRD-drape-v1.md) | Behaviour |
| [Architecture](docs/ARCHITECTURE.md) | Structure, naming, columns, error codes, endpoints |
| [Project plan](docs/PROJECT-PLAN.md) | Workstreams and locked decisions |
| [Runbook](docs/RUNBOOK.md) | Operations, including key rotation |
| [CLAUDE.md](CLAUDE.md) | Working notes for agents contributing to this repository |

Each service has its own README with the detail this one deliberately leaves out — module
conventions, library boundaries and the patterns to follow when adding code:
[`backend/README.md`](backend/README.md) and
[`frontend/README.md`](frontend/README.md).
