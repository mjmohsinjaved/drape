# Drape — System Architecture

**Status:** Binding contract for implementation. **Version:** 1.0 · August 2026
**Derived from:** `docs/PRD-drape-v1.md` (v5.0) and `docs/PROJECT-PLAN.md` (locked decisions).

This document is the single source of truth for folder layout, naming, entities, error codes,
routes, tokens and environment. Where this document and the PRD disagree on a *mechanism*, this
document wins. Where they disagree on a *product requirement*, the PRD wins and this document is
a bug — raise it, do not improvise.

**If something you need is not specified here, it is a gap. Ask. Do not invent a second way of
doing a thing that already has one way.**

## 0. Ground rules

| Rule | Value |
| --- | --- |
| Node / npm | Node 24, npm 9. **No pnpm.** No Docker daemon on the build machine. No local `psql`. |
| Backend | NestJS monorepo, **exactly one deployable app** `apps/api`, plus `libs/*`. No RabbitMQ. No gateway/service split (PRD §8.2: "no external queue is required in V1"). |
| ORM | TypeORM. **Migrations only. `synchronize: false` in every environment, no exceptions.** |
| Database | PostgreSQL 16. The API is the only process with database credentials (B-3). |
| Storage | Local disk **outside the repository**, root `STORAGE_ROOT` (default `D:/drape-storage`). The database stores the **relative storage key** and never an absolute path. |
| Frontend | Turborepo + **npm workspaces**. One Next.js app `apps/web` serving both roles (PRD S-2). |
| Auth | Custom server-side sessions, httpOnly `SameSite=Lax` cookie, CSRF double-submit. **No NextAuth, no JWT.** |
| TryOnCloud | Behind a `TryOnProvider` interface. `TRYON_DRIVER=mock` in local and CI — the upstream account has a 10-image budget and tests must never spend it. |
| Language | TypeScript everywhere, `strict: true`. `any` is a review failure. |
| Casing | camelCase for TS identifiers and entity columns; PascalCase for types; kebab-case for files, folders and URL segments; UPPER_SNAKE_CASE for constants, env vars and enum **values**; snake_case for table names only. |

---

## 1. Repository layout

```
D:/Projects Apps/fitting Room/
├── backend/            # NestJS monorepo (one app + four libs)
├── frontend/           # Turborepo + npm workspaces (one app + seven packages)
├── docs/
│   ├── PRD-drape-v1.md
│   ├── PROJECT-PLAN.md
│   ├── ARCHITECTURE.md          # this file
│   ├── RUNBOOK.md               # E-17
│   └── drape_nextjs_nestjs_architecture.svg
└── .github/workflows/           # ci-backend.yml, ci-frontend.yml, contract-check.yml
```

`D:/drape-storage/` (or whatever `STORAGE_ROOT` points at) lives **outside** this tree and is never
committed, never symlinked into the repo, and never served by a static file handler.

### 1.1 `backend/`

```
backend/
├── apps/
│   └── api/
│       ├── src/
│       │   ├── main.ts                       # bootstrap: env validation → Nest → middleware → CORS → swagger → listen
│       │   ├── api.module.ts                 # composition root: imports feature modules only
│       │   ├── bootstrap/
│       │   │   ├── validate-env.ts
│       │   │   ├── cors.config.ts
│       │   │   ├── swagger.config.ts
│       │   │   ├── global-providers.ts       # APP_GUARD / APP_INTERCEPTOR / APP_FILTER wiring
│       │   │   └── graceful-shutdown.ts
│       │   ├── modules/
│       │   │   ├── health/
│       │   │   ├── auth/                     # + guards/ + strategies/ + listeners/
│       │   │   ├── users/
│       │   │   ├── invites/
│       │   │   ├── settings/
│       │   │   ├── consents/
│       │   │   ├── categories/
│       │   │   ├── garments/                 # + validators/  (image quality, A-10)
│       │   │   ├── catalog/                  # public read-only projection; owns no entities
│       │   │   ├── person-photos/
│       │   │   ├── tryon/                    # + providers/ + guards/ + processors/ + listeners/
│       │   │   ├── results/
│       │   │   ├── shortlist/
│       │   │   ├── share/
│       │   │   ├── enquiries/                # + listeners/
│       │   │   ├── quota/
│       │   │   ├── moderation/
│       │   │   ├── analytics/                # owns no entities; read-only aggregates
│       │   │   ├── audit/                    # + listeners/
│       │   │   ├── notifications/            # outbox + in-app; + processors/
│       │   │   ├── retention/                # purge cron, deletion log, data export; + processors/
│       │   │   └── files/                    # signed-URL download + upload-ticket redemption
│       │   ├── shared/
│       │   │   ├── entities/                 # only entities with no single owning module
│       │   │   ├── services/                 # request-scoped helpers used by 3+ modules
│       │   │   └── constants/                # audit action codes, metric names, settings keys
│       │   └── seeders/
│       │       ├── run-seed.ts
│       │       ├── admin.seeder.ts           # E-4 first admin
│       │       ├── settings.seeder.ts        # A-28/A-29/A-30 defaults
│       │       ├── categories.seeder.ts      # A-4 sample categories
│       │       ├── policy-version.seeder.ts  # C-12 initial policy version
│       │       └── reference-models.seeder.ts# E-4 / A-11 reference model photos
│       ├── test/
│       │   ├── e2e/                          # E-8, E-9
│       │   ├── authorization/                # E-7 harness: every ADMIN route + cross-account
│       │   ├── fixtures/
│       │   ├── factories/
│       │   └── jest-e2e.json
│       ├── tsconfig.app.json
│       └── tsconfig.spec.json
├── libs/
│   ├── common/
│   │   └── src/
│   │       ├── index.ts                      # barrel — everything is exported here
│   │       ├── config/                       # swagger.config.ts, env-validation.ts
│   │       ├── constants/                    # error-codes.constant.ts, roles.constant.ts, metrics.constant.ts
│   │       ├── decorators/                   # public, roles, current-user, response-message, skip-csrf
│   │       ├── dto/                          # pagination-query.dto.ts, id-param.dto.ts
│   │       ├── exceptions/                   # app.exception.ts + subclasses
│   │       ├── filters/                      # global-exception.filter.ts
│   │       ├── guards/                       # csrf, throttler, session-auth, roles
│   │       ├── interceptors/                 # response-transform.interceptor.ts
│   │       ├── interfaces/                   # ICurrentUser, ApiResponse, PaginationMeta, IPaginated
│   │       ├── logger/                       # structured-logger.service.ts, request-context.ts (AsyncLocalStorage)
│   │       ├── metrics/                      # metrics.service.ts, metrics.module.ts
│   │       ├── middleware/                   # request-id, request-logging, security-headers
│   │       ├── pipes/                        # custom-validation.pipe.ts
│   │       └── utils/                        # hash.util.ts, money.util.ts, period.util.ts, redact.util.ts
│   ├── database/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── database.module.ts
│   │       ├── database-connection.service.ts
│   │       ├── data-sources/api.data-source.ts
│   │       ├── entities/                     # base.entity.ts, append-only.entity.ts
│   │       ├── transformers/                 # decimal.transformer.ts
│   │       ├── migrations/api/               # timestamped migrations, reviewed, reversible
│   │       └── scripts/                      # db-reset.ts, db-check.ts
│   ├── storage/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── storage.module.ts
│   │       ├── storage.service.ts            # façade over the active driver
│   │       ├── storage.config.ts
│   │       ├── storage-key.builder.ts        # the ONLY place keys are constructed
│   │       ├── signed-url.service.ts         # issue/verify HMAC tokens
│   │       ├── image.service.ts              # sharp: probe, thumbnail, EXIF strip, watermark
│   │       ├── drivers/                      # storage-driver.interface.ts, local-disk.driver.ts, (s3.driver.ts later)
│   │       └── exceptions/
│   └── notifications/
│       └── src/
│           ├── index.ts
│           ├── notifications.module.ts
│           ├── interfaces/                   # email-provider.interface.ts, sms-provider.interface.ts
│           ├── drivers/                      # console-email, smtp-email, console-sms, http-sms
│           ├── services/                     # email.service.ts, sms.service.ts, template.service.ts
│           └── templates/                    # en/ and ur/ subfolders, one .hbs per template id
├── scripts/
│   ├── check-route-guards.ts                 # B-5: fails CI on any route without an explicit role guard
│   └── export-openapi.ts                     # B-4: writes openapi.json for the frontend contract check
├── .env.example
├── .eslintrc / eslint.config.mjs
├── docker-compose.yml                        # documented one-command DB bring-up (not runnable here)
├── jest.config.ts
├── nest-cli.json
├── package.json
└── tsconfig.json
```

**Every feature module folder uses the standard template in §2.9.** Modules that own no entities
(`catalog`, `analytics`, `files`, `health`) omit `entities/`.

#### Path aliases (`backend/tsconfig.json` → `compilerOptions.paths`)

```json
{
  "@library/common":          ["libs/common/src"],
  "@library/common/*":        ["libs/common/src/*"],
  "@library/database":        ["libs/database/src"],
  "@library/database/*":      ["libs/database/src/*"],
  "@library/storage":         ["libs/storage/src"],
  "@library/storage/*":       ["libs/storage/src/*"],
  "@library/notifications":   ["libs/notifications/src"],
  "@library/notifications/*": ["libs/notifications/src/*"],
  "@api/*":                   ["apps/api/src/*"]
}
```

Import rules, enforced by ESLint `no-restricted-imports`:

- Always import from the barrel: `@library/common`, never `@library/common/guards/roles.guard`.
- `libs/*` **must not** import from `@api/*`. Libraries know nothing about the application.
- A feature module imports another feature module's *module class*, never its files directly.
- Cross-module entity access goes through the owning module's exported service, or through the
  owning module re-exporting `TypeOrmModule.forFeature([...])`.

#### Root scripts (`backend/package.json`)

```json
{
  "build": "nest build api",
  "start:dev": "nest start api --watch",
  "start:prod": "node dist/apps/api/main",
  "migration:create": "npx typeorm migration:create libs/database/src/migrations/api/Migration",
  "migration:generate": "npx typeorm-ts-node-commonjs migration:generate -d libs/database/src/data-sources/api.data-source.ts libs/database/src/migrations/api/Migration",
  "migration:run": "npx typeorm-ts-node-commonjs migration:run -d libs/database/src/data-sources/api.data-source.ts",
  "migration:revert": "npx typeorm-ts-node-commonjs migration:revert -d libs/database/src/data-sources/api.data-source.ts",
  "migration:show": "npx typeorm-ts-node-commonjs migration:show -d libs/database/src/data-sources/api.data-source.ts",
  "seed": "ts-node apps/api/src/seeders/run-seed.ts",
  "openapi:export": "ts-node scripts/export-openapi.ts",
  "check:guards": "ts-node scripts/check-route-guards.ts",
  "lint": "eslint \"{apps,libs,scripts,test}/**/*.ts\" --max-warnings 0",
  "type-check": "tsc --noEmit -p tsconfig.json",
  "test": "jest",
  "test:cov": "jest --coverage",
  "test:e2e": "jest --config ./apps/api/test/jest-e2e.json"
}
```

Migration table name: `api_migrations`. Data source entity glob:
`apps/api/src/modules/**/entities/*.entity.ts` plus `apps/api/src/shared/entities/*.entity.ts`.

### 1.2 `frontend/`

```
frontend/
├── apps/
│   └── web/
│       ├── public/
│       │   ├── illustrations/                # C-13 photo-guidance diagrams (drawn, never photographs)
│       │   ├── icons/
│       │   └── og/
│       ├── src/
│       │   ├── app/                          # App Router tree — see §6.7
│       │   ├── components/                   # app-level composites (not design-system atoms)
│       │   │   ├── layout/                   # ConsumerShell, AdminShell, TopBar, SideNav, LocaleSwitch
│       │   │   ├── states/                   # EmptyState, ErrorState, DeniedState, Skeletons  (D-5)
│       │   │   └── feedback/                 # ToastViewport, ConfirmDialog, TypeToConfirmDialog (D-17)
│       │   ├── features/                     # one folder per domain; components/ hooks/ stores/ schemas/ types/
│       │   │   ├── auth/  account/  catalog/  consent/  person-photos/  tryon/  results/
│       │   │   ├── shortlist/  share/  enquiries/  quota/
│       │   │   └── admin-catalog/  admin-categories/  admin-consumers/  admin-enquiries/
│       │   │       admin-moderation/  admin-analytics/  admin-usage/  admin-audit/  admin-settings/
│       │   ├── hooks/                        # cross-feature hooks (useMediaQuery, useReducedMotion, useDirection)
│       │   ├── i18n/
│       │   │   ├── config.ts                 # locales, defaultLocale, dir map
│       │   │   ├── request.ts                # next-intl server config
│       │   │   └── messages/{en,ur}/*.json   # one file per feature namespace
│       │   ├── lib/
│       │   │   ├── env.ts                    # @t3-oss/env-nextjs
│       │   │   ├── server-api.ts             # cookie-forwarding client for Server Components
│       │   │   ├── session.ts                # getSession() cached server helper
│       │   │   ├── files.ts                  # signed-URL helpers
│       │   │   └── format.ts                 # money/date/number formatters, locale-aware
│       │   ├── styles/
│       │   │   ├── globals.css               # @layer base — token declarations live here
│       │   │   └── fonts.ts                  # next/font/google declarations
│       │   └── middleware.ts                 # locale negotiation + shell routing only (never a security boundary)
│       ├── .env.example
│       ├── next.config.ts
│       ├── tailwind.config.ts
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   ├── config-typescript/                    # base.json, nextjs.json, library.json
│   ├── config-eslint/                        # base.mjs, next.mjs, react.mjs (+ RTL logical-property rule)
│   ├── config-tailwind/                      # tailwind preset mapping tokens → utilities
│   ├── ui/
│   │   └── src/
│   │       ├── components/                   # one folder per atom — see §6.4
│   │       ├── tokens/                       # tokens.css, tokens.ts, contrast.spec.ts
│   │       ├── providers/                    # ThemeProvider, DirectionProvider
│   │       ├── lib/                          # cn.ts
│   │       └── index.ts
│   ├── api-client/
│   │   └── src/
│   │       ├── axios-instance.ts  server-instance.ts  query-client.ts  query-keys.ts
│   │       ├── interceptors/  hooks/  providers/  endpoints/  types/  dto/
│   │       └── index.ts
│   ├── store/
│   │   └── src/stores/                       # see §6.6
│   └── utils/
│       └── src/                              # pure helpers: money, date, slug, file-size, debounce, sr-only text
├── .env.example
├── package.json                              # workspaces: ["apps/*", "packages/*"]
├── turbo.json
└── tsconfig.json
```

Workspace package names — **use these exact strings in every `package.json` dependency block**:

| Path | Package name |
| --- | --- |
| `apps/web` | `web` |
| `packages/config-typescript` | `@repo/config-typescript` |
| `packages/config-eslint` | `@repo/config-eslint` |
| `packages/config-tailwind` | `@repo/config-tailwind` |
| `packages/ui` | `@repo/ui` |
| `packages/api-client` | `@repo/api-client` |
| `packages/store` | `@repo/store` |
| `packages/utils` | `@repo/utils` |

npm workspaces do **not** understand `workspace:*`. Internal dependencies are declared as `"*"`:

```json
"dependencies": { "@repo/ui": "*", "@repo/api-client": "*", "@repo/store": "*", "@repo/utils": "*" }
```

`apps/web/next.config.ts` must list every internal package in `transpilePackages`.
Root scripts: `dev`, `build`, `lint`, `lint:fix`, `type-check`, `format`, `clean`, all via `turbo`.

---

## 2. Backend conventions

### 2.1 Base entities

Every entity extends exactly one of these two. There is no third option.

```typescript
// libs/database/src/entities/base.entity.ts
import {
  BaseEntity as TypeOrmBaseEntity,
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Default base for every mutable, soft-deletable entity.
 * Unique indexes on subclasses MUST carry `where: '"deletedAt" IS NULL'`.
 */
export abstract class BaseEntity extends TypeOrmBaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
```

```typescript
// libs/database/src/entities/append-only.entity.ts
import {
  BaseEntity as TypeOrmBaseEntity,
  CreateDateColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Base for immutable ledgers and records of fact: quota_ledger, usage_ledger,
 * audit_log, consents, deletion_log, enquiry_notes, auth_attempts.
 *
 * There is no updatedAt and no deletedAt — by design. Rows are INSERTed and read.
 * Never call save() on a loaded instance, never softRemove(), never remove().
 * Correcting a mistake means appending a compensating row, not editing history.
 */
export abstract class AppendOnlyEntity extends TypeOrmBaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
```

`AppendOnlyEntity` subclasses get a database-level guard in their migration:

```sql
CREATE RULE "no_update_quota_ledger" AS ON UPDATE TO "quota_ledger" DO INSTEAD NOTHING;
CREATE RULE "no_delete_quota_ledger" AS ON DELETE TO "quota_ledger" DO INSTEAD NOTHING;
```

Exception: `deletion_log` and `audit_log` rows may be physically removed only by an explicitly
reviewed retention migration, never by application code.

#### Money

```typescript
// libs/database/src/transformers/decimal.transformer.ts
import type { ValueTransformer } from 'typeorm';

/** decimal(18,2) comes back from pg as a string. Always transform. */
export const decimalTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value ?? null,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};
```

Every monetary column is declared exactly like this:

```typescript
@Column({ type: 'decimal', precision: 18, scale: 2, nullable: true, transformer: decimalTransformer })
deposit: number | null;
```

Currency is a separate `char(3)` column defaulting to `'PKR'`. Never store a formatted string.

### 2.2 Naming conventions

| Element | Convention | Example in this codebase |
| --- | --- | --- |
| Variables, properties, parameters | camelCase | `personPhotoId`, `remainingQuota` |
| Functions and methods | camelCase | `deriveQuotaBalance()`, `buildCacheKey()` |
| Entity class | PascalCase, singular | `TryOnResult`, `QuotaLedgerEntry` |
| Entity **columns** | camelCase — never override with `{ name: 'snake_case' }` | `garmentTitleSnapshot` |
| Table name | snake_case plural, in the `@Entity()` decorator only | `@Entity('tryon_results')` |
| TS enum type | PascalCase | `PublishState`, `VerdictKind` |
| TS enum **values** | UPPER_SNAKE_CASE, string-valued, identical to the stored value | `PublishState.PUBLISHED = 'PUBLISHED'` |
| PostgreSQL enum type | snake_case + `_enum` | `publish_state_enum` |
| Files and folders | kebab-case | `tryon-guard-chain.service.ts` |
| URL path segments | kebab-case, plural nouns | `/api/v1/person-photos` |
| Query parameters | camelCase | `?sortBy=createdAt&publishState=PUBLISHED` |
| DTO class | PascalCase + `Dto` | `CreateGarmentDto`, `GarmentQueryDto`, `GarmentResponseDto` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_MONTHLY_QUOTA`, `TRYON_CACHE_VERSION` |
| Environment variables | UPPER_SNAKE_CASE | `STORAGE_URL_SECRET` |
| Migration class | `PascalCaseDescription` + epoch ms | `CreateTryonTables1754300000000` |
| Migration tracking table | snake_case | `api_migrations` |
| Event names (EventEmitter2) | `domain.action` | `tryon.succeeded`, `enquiry.created` |
| Audit action codes | UPPER_SNAKE_CASE, verb last | `GARMENT_PUBLISHED`, `MODERATION_ITEM_VIEWED` |
| Metric names | dot-delimited lower snake | `tryon.latency_ms`, `quota.consumed` |

Enum values are UPPER_SNAKE_CASE **in TypeScript, in PostgreSQL, and on the wire**. The API never
translates enum casing. The frontend receives `"PUBLISHED"` and maps it to display copy through i18n.

### 2.3 Response envelope

Produced by `ResponseTransformInterceptor` (success) and `GlobalExceptionFilter` (error). Every
response on `/api/v1/**` uses one of these three shapes. There are no bare bodies except
`GET /api/v1/files/:token` (binary stream) and `GET /api/v1/tryon/jobs/:id/stream` (SSE).

**Success — single resource**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Garment retrieved successfully",
  "data": { "id": "0c0a…", "title": "Zarrin Bridal Lehenga", "publishState": "PUBLISHED" },
  "timestamp": "2026-08-05T09:14:22.113Z",
  "path": "/api/v1/catalog/garments/0c0a…",
  "requestId": "6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c"
}
```

**Success — paginated list.** `data` is the array; the envelope carries `meta`. A service returns
`{ items, meta }` and the interceptor unwraps it.

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "data": [ { "id": "…" }, { "id": "…" } ],
  "meta": { "page": 1, "limit": 24, "total": 137, "totalPages": 6, "sortBy": "createdAt", "sortOrder": "DESC" },
  "timestamp": "2026-08-05T09:14:22.113Z",
  "path": "/api/v1/catalog/garments?page=1&limit=24",
  "requestId": "6f8b1a2c-…"
}
```

**Error**

```json
{
  "success": false,
  "statusCode": 403,
  "errorCode": "QUOTA_EXHAUSTED",
  "message": "You've used your try-ons this month — your shortlist is saved, and you can send an enquiry any time.",
  "errors": [],
  "details": { "period": "2026-08", "limit": 15, "used": 15, "resetsAt": "2026-09-01T00:00:00.000Z" },
  "timestamp": "2026-08-05T09:14:22.113Z",
  "path": "/api/v1/tryon",
  "requestId": "6f8b1a2c-…"
}
```

Rules:

- `message` is **always safe to display to the end user**. Internal detail goes to logs, never here.
- `errors[]` is reserved for field-level validation (`{ field, message, code }`). Empty otherwise.
- `details` is a typed, non-sensitive object the UI needs in order to render the state correctly
  (quota numbers, retry-after seconds, the failing bulk item ids). Never contains storage keys,
  identifiers belonging to another user, stack traces, or SQL.
- `requestId` mirrors the `X-Request-Id` response header and the value in every log line (E-12).
- The interceptor skips wrapping when the handler returns an object that already has `success`.

`@ResponseMessage('…')` sets `message` on success; the default is `"Success"`.

### 2.4 The `ErrorCode` enum

`libs/common/src/constants/error-codes.constant.ts`. This is the complete, closed set. Adding a code
means adding a row to this table in the same pull request.

**Consumer copy:** strings marked ✔︎ are taken **verbatim from PRD §8.3** and must not be reworded.
All other consumer-facing messages here have already been through the §9.4 shortlisting check and the
§10.5 copy standards — treat them as fixed copy, translate them, do not rewrite them.

#### Authentication and session

| Code | HTTP | Default message | Notes |
| --- | --- | --- | --- |
| `AUTH_REQUIRED` | 401 | `Sign in to continue.` | No session cookie presented. |
| `SESSION_EXPIRED` | 401 | `Your session has ended. Sign in again to pick up where you left off.` | Idle or absolute expiry reached. |
| `SESSION_INVALID` | 401 | `Your session has ended. Sign in again to pick up where you left off.` | Unknown or revoked token. Same copy as above — never reveal which. |
| `INVALID_CREDENTIALS` | 401 | `That email and password don't match an account.` | Generic by design (S-6). Identical for unknown email and wrong password. |
| `ACCOUNT_LOCKED` | 423 | `Too many attempts. Try again in a few minutes.` | `details.retryAfterSeconds`. Exponential backoff (S-6). |
| `ACCOUNT_SUSPENDED` | 403 | `This account is on hold. Contact us and we'll sort it out.` | A-19. Blocks generation and enquiry, preserves data. |
| `ACCOUNT_DEACTIVATED` | 403 | `This account is no longer active.` | A-2. |
| `EMAIL_NOT_VERIFIED` | 403 | `Confirm your email to start trying pieces on. We've sent you a link.` | C-3 / A-28 guard-chain step. |
| `PHONE_NOT_VERIFIED` | 403 | `Confirm your phone number to send this enquiry.` | C-3, enquiry submission only. |
| `TWOFA_REQUIRED` | 401 | `Enter the code from your authenticator app.` | S-8. Session is in `twofaPending` state. |
| `TWOFA_INVALID` | 401 | `That code didn't work. Try the next one.` | |
| `TWOFA_ALREADY_ENABLED` | 409 | `Two-factor authentication is already on for this account.` | |
| `TWOFA_REQUIRED_FOR_ROLE` | 409 | `Admin accounts must keep two-factor authentication on.` | S-8: admins cannot disable it. |
| `PASSWORD_POLICY_VIOLATION` | 400 | `Choose a password with at least 10 characters, including a number and a symbol.` | |
| `TOKEN_INVALID` | 400 | `That link isn't valid. Request a new one.` | Reset, verification and invite tokens. |
| `TOKEN_EXPIRED` | 410 | `That link has expired. Request a new one.` | Reset link TTL 30 minutes (S-6). |
| `TOKEN_ALREADY_USED` | 409 | `That link has already been used. Request a new one.` | Single-use tokens. |
| `OTP_INVALID` | 400 | `That code didn't match. Check it and try again.` | |
| `OTP_EXPIRED` | 410 | `That code has expired. Send a new one.` | |
| `OTP_MAX_ATTEMPTS` | 429 | `Too many tries. Send a new code in a few minutes.` | |
| `CSRF_TOKEN_MISSING` | 403 | `Refresh the page and try again.` | Double-submit header absent. |
| `CSRF_TOKEN_INVALID` | 403 | `Refresh the page and try again.` | Header and cookie disagree. |
| `INSUFFICIENT_ROLE` | 403 | `You don't have access to this.` | Rendered by the web app as the S-9 no-access screen, never as a raw 403. |
| `SELF_ROLE_CHANGE_FORBIDDEN` | 403 | `You can't change your own role.` | |
| `LAST_ADMIN_PROTECTED` | 409 | `At least one admin must stay active.` | |
| `BOT_CHECK_FAILED` | 403 | `We couldn't verify that request. Try again.` | §8.4 bot protection on signup and generation. |

> S-4 note: a `role` field in the signup payload is **stripped and audit-logged**
> (`SIGNUP_ROLE_IGNORED`), never rejected. It is an audit action code, not an error code.

#### Invites and accounts

| Code | HTTP | Default message |
| --- | --- | --- |
| `EMAIL_ALREADY_EXISTS` | 409 | `An account with this email already exists.` |
| `PHONE_ALREADY_EXISTS` | 409 | `An account with this phone number already exists.` |
| `USER_NOT_FOUND` | 404 | `We couldn't find that account.` |
| `INVITE_NOT_FOUND` | 404 | `That invitation isn't valid. Ask an admin to send a new one.` |
| `INVITE_EXPIRED` | 410 | `That invitation has expired. Ask an admin to send a new one.` |
| `INVITE_ALREADY_CONSUMED` | 409 | `That invitation has already been used.` |
| `DELETION_IN_PROGRESS` | 409 | `This account is being deleted. Nothing more can be changed.` |

#### The try-on guard chain (PRD §8.1 step 3) — evaluated in this exact order

Every predicate below runs **before any spend**. The first failure short-circuits, increments the
`tryon.guard_rejected` metric tagged with the code, and returns immediately. No `tryon_jobs` row is
written for a guard-chain rejection.

| Order | Code | HTTP | Message | PRD verbatim |
| :-: | --- | :-: | --- | :-: |
| 1 | `AUTH_REQUIRED` / `SESSION_EXPIRED` | 401 | *(above)* | |
| 2 | `ACCOUNT_SUSPENDED` | 403 | *(above)* | |
| 3 | `EMAIL_NOT_VERIFIED` | 403 | *(above)* | |
| 4 | `CONSENT_REQUIRED` | 403 | `Before your first try-on we need your go-ahead on how your photo is used.` | |
| 5 | `CONSENT_STALE` | 403 | `We've updated how we handle your photo. Have a read and confirm to carry on.` | C-12 |
| 6 | `QUOTA_EXHAUSTED` | 403 | `You've used your try-ons this month — your shortlist is saved, and you can send an enquiry any time.` | ✔︎ |
| 7 | `RATE_LIMIT_EXCEEDED` | 429 | `You're going a bit fast. Give it a minute and try again.` | `details.retryAfterSeconds`, plus a `Retry-After` header. |
| 8 | `BUDGET_EXHAUSTED` | 403 | `Our fitting room is at capacity today — we'll email you when it's back.` | ✔︎ Alerts admin immediately and captures interest. |
| 9 | `GARMENT_NOT_PUBLISHED` | 404 | `This piece isn't available right now. Browse the rest of the collection.` | Indistinguishable from "not found" by design. |
| 10 | `TEST_RENDER_REQUIRED` | 409 | `This piece isn't ready for try-on yet.` | A-11. Raised by the consumer try-on path, which still refuses an unproven piece. **Not** thrown by publish any more — there it is an advisory identifier only. |
| 11 | `PHOTO_NOT_OWNED` | 403 | *(masked — never returned)* | |
| 11 | `PHOTO_NOT_FOUND` | 404 | `We couldn't find that photo. Pick another or upload a new one.` | What the client actually receives. |
| 12 | `IDEMPOTENCY_IN_FLIGHT` | 409 | `That try-on is already running. Hang tight.` | `details.jobId`, so the client attaches to the existing SSE stream instead of retrying. |

**Masking rule.** `GlobalExceptionFilter` holds a `MASKED_ERROR_CODES` map. Codes in it are logged
with their true value plus the request id, and returned to the client as the masked code and status:

```
PHOTO_NOT_OWNED          → PHOTO_NOT_FOUND           (404)
RESULT_NOT_OWNED         → RESULT_NOT_FOUND          (404)
JOB_NOT_OWNED            → JOB_NOT_FOUND             (404)
ENQUIRY_NOT_OWNED        → ENQUIRY_NOT_FOUND         (404)
SHORTLIST_ITEM_NOT_OWNED → SHORTLIST_ITEM_NOT_FOUND  (404)
SHARE_LINK_NOT_OWNED     → SHARE_LINK_NOT_FOUND      (404)
```

Each `*_NOT_OWNED` code carries its own `ERROR_CODE_SPECS` entry — status `403`, message
`You don't have access to this.` — which exists purely for logging, metrics and tests, because the
code is always masked before it reaches a client.

This satisfies S-9 ("never a redirect that reveals whether the resource exists") and the §9.2
object-level ownership rule. Cross-account tests (E-7) assert the client sees the masked code and
that the true code appears in the log line.

#### Upstream (TryOnCloud) — PRD §8.3 failure taxonomy

| Code | HTTP | Consumer message | Verbatim | System behaviour |
| --- | :-: | --- | :-: | --- |
| `UPSTREAM_NO_GARMENT_DETECTED` | 502 | `We're having trouble with this piece — we've been notified. Try another for now.` | ✔︎ | Flag garment for review. **No charge, no retry, no quota consumed.** Increments `garments.failureCount` and raises a catalog-health row (A-15). |
| `UPSTREAM_UNSUPPORTED_FORMAT` | 422 | `That photo didn't upload properly. Mind trying again?` | ✔︎ | Should be caught at client validation (C-14) wherever possible. No retry. |
| `MODERATION_REJECTED` | 422 | `Let's try a different photo — choose another and we'll carry on from here.` | | Neutral by design. Writes a `moderation_items` row, blocks the photo pending review, **discloses no detail**, no retry. |
| `UPSTREAM_TIMEOUT` | 504 | `Taking longer than usual — hang tight.` | ✔︎ | Exponential backoff, **max 3 attempts total**, then fail cleanly. |
| `UPSTREAM_UNAVAILABLE` | 503 | `Taking longer than usual — hang tight.` | ✔︎ | Upstream 5xx. Same backoff policy as timeout. |
| `UPSTREAM_RATE_LIMITED` | — | *(never surfaced)* | | **Silent. The job stays `RUNNING` and the SSE stream stays open.** Backoff and retry. Only once attempts are exhausted does the job fail as `UPSTREAM_UNAVAILABLE`. |
| `UPSTREAM_INVALID_RESPONSE` | 502 | `We're having trouble with this piece — we've been notified. Try another for now.` | | Malformed upstream payload; treated as no-garment-detected for the consumer. |
| `TRYON_PROVIDER_MISCONFIGURED` | 503 | `The fitting room is briefly unavailable. Try again shortly.` | | `TRYON_DRIVER=http` with no API key. Startup validation catches this first; this is the runtime backstop. |

**Failed jobs never consume quota or budget** (PRD §8.3). Enforced in exactly one place:
`QuotaService.commit()` is called only from the `SUCCEEDED` branch of `TryOnService.run()`.

#### Catalog, garments, images

| Code | HTTP | Default message |
| --- | :-: | --- |
| `CATEGORY_NOT_FOUND` | 404 | `We couldn't find that category.` |
| `CATEGORY_HAS_PUBLISHED_GARMENTS` | 409 | `This category still holds published pieces. Archive it instead, or move them first.` (A-7) |
| `CATEGORY_DEPTH_EXCEEDED` | 400 | `Sub-categories can only go one level deep.` (A-5) |
| `CATEGORY_ARCHIVED` | 409 | `This category is archived. Restore it before adding pieces.` |
| `GARMENT_NOT_FOUND` | 404 | `We couldn't find that piece.` |
| `GARMENT_SKU_EXISTS` | 409 | `Another piece already uses this SKU.` |
| `INVALID_PUBLISH_TRANSITION` | 409 | `A piece can't move from {from} to {to}.` |
| `TRYON_SOURCE_REQUIRED` | 409 | `Choose a try-on source image before publishing.` (A-9) |
| `TRYON_SOURCE_ALREADY_SET` | 409 | `Only one image can be the try-on source.` |
| `GARMENT_QUALITY_BELOW_THRESHOLD` | 422 | `This photo needs work before it can go live.` — `details.checks[]` carries the per-check remediation strings (A-10). |
| `QUALITY_OVERRIDE_REQUIRED` | 409 | `This piece is marked "Needs a better photo". Override to publish anyway.` — the override writes an audit row (A-10). **No longer thrown**: since A-10 became advisory this code is only used as an advisory identifier in `metadata.unmetConditions` and by the console to label the reason. |
| `IMAGE_TOO_SMALL` | 422 | `This image is {actual}px on the long edge. It needs at least 2000px.` |
| `IMAGE_FORMAT_UNSUPPORTED` | 415 | `We accept HEIC, WebP, PNG and JPEG.` |
| `IMAGE_TOO_LARGE` | 413 | `That file is over {maxMb}MB. Try a smaller one.` |
| `IMAGE_CORRUPT` | 422 | `We couldn't read that file. Try exporting it again.` |
| `BULK_OPERATION_PARTIAL_FAILURE` | 207 | `Some items didn't go through.` — `details.results[]` gives the per-item outcome (D-16). |

#### Photos, consent, results, engagement

| Code | HTTP | Default message |
| --- | :-: | --- |
| `CONSENT_POLICY_NOT_FOUND` | 404 | `We couldn't load the current policy. Try again shortly.` |
| `PHOTO_LIMIT_REACHED` | 409 | `You can keep up to {max} photos. Remove one to add another.` |
| `PHOTO_VALIDATION_FAILED` | 422 | `This photo won't work for a try-on.` — `details.checks[]` (C-14). |
| `PHOTO_BLOCKED_BY_MODERATION` | 403 | `Let's try a different photo — choose another and we'll carry on from here.` |
| `RESULT_NOT_FOUND` | 404 | `We couldn't find that result.` |
| `JOB_NOT_FOUND` | 404 | `We couldn't find that try-on.` |
| `SHORTLIST_ITEM_NOT_FOUND` | 404 | `That piece isn't on your shortlist.` |
| `SHORTLIST_EMPTY` | 409 | `Add a piece to your shortlist first.` |
| `SHARE_LINK_NOT_FOUND` | 404 | `This link isn't available.` |
| `SHARE_LINK_REVOKED` | 410 | `This link has been turned off by its owner.` |
| `SHARE_LINK_EXPIRED` | 410 | `This link has expired.` |
| `SHARING_DISABLED` | 403 | `Sharing is turned off right now.` (A-30) |
| `VOTE_ALREADY_CAST` | 409 | `You've already left a note on this piece.` (C-33: one comment per item) |
| `ENQUIRIES_DISABLED` | 403 | `Enquiries are closed right now.` (A-30) |
| `ENQUIRY_NOT_FOUND` | 404 | `We couldn't find that enquiry.` |
| `ENQUIRY_ALREADY_OPEN` | 409 | `You already have an open enquiry. We'll be in touch.` |
| `ENQUIRY_LOST_REASON_REQUIRED` | 400 | `Add a reason before closing this as lost.` (A-22) |
| `INVALID_ENQUIRY_TRANSITION` | 409 | `An enquiry can't move from {from} to {to}.` |

#### Quota, moderation, settings, files, platform

| Code | HTTP | Default message |
| --- | :-: | --- |
| `QUOTA_ADJUSTMENT_INVALID` | 400 | `Enter a whole number between {min} and {max}.` |
| `MODERATION_ITEM_NOT_FOUND` | 404 | `We couldn't find that item.` |
| `MODERATION_ALREADY_REVIEWED` | 409 | `Someone has already reviewed this item.` |
| `IP_BLOCKED` | 403 | `We can't complete that request.` (A-35) |
| `SETTINGS_KEY_UNKNOWN` | 400 | `Unknown setting.` |
| `SETTINGS_VALUE_INVALID` | 400 | `That value isn't allowed for this setting.` |
| `FILE_TOKEN_INVALID` | 403 | `This link isn't valid.` |
| `FILE_TOKEN_EXPIRED` | 403 | `This link has expired. Refresh the page.` |
| `FILE_TOKEN_SUBJECT_MISMATCH` | 403 | `This link isn't valid.` (issued for another account) |
| `FILE_NOT_FOUND` | 404 | `We couldn't find that file.` |
| `UPLOAD_TICKET_INVALID` | 403 | `That upload link isn't valid. Start the upload again.` |
| `UPLOAD_TICKET_EXPIRED` | 410 | `That upload link expired. Start the upload again.` |
| `STORAGE_WRITE_FAILED` | 500 | `We couldn't save that. Try again.` |
| `STORAGE_PATH_REJECTED` | 400 | `We couldn't save that.` — path-traversal attempt; logged at `warn` with the raw key. |
| `EXPORT_NOT_READY` | 409 | `Your export is still being prepared. We'll email you when it's ready.` (C-39) |
| `VALIDATION_ERROR` | 400 | `Check the highlighted fields.` — `errors[]` populated by `CustomValidationPipe`. |
| `RESOURCE_NOT_FOUND` | 404 | `We couldn't find that.` — generic fallback. |
| `RESOURCE_CONFLICT` | 409 | `Something changed while you were working. Reload and try again.` — optimistic-concurrency failure (D-18 rollback). |
| `INTERNAL_ERROR` | 500 | `Something went wrong on our side. We've been notified.` |
| `SERVICE_UNAVAILABLE` | 503 | `We're briefly unavailable. Try again shortly.` |

Declaration form:

```typescript
export enum ErrorCode {
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  // …one entry per row above, value identical to the key
}

export interface ErrorCodeSpec {
  status: HttpStatus;
  message: string;
  /** true when the message is safe and intended for a signed-in consumer */
  consumerFacing: boolean;
}

export const ERROR_CODE_SPECS: Readonly<Record<ErrorCode, ErrorCodeSpec>> = { /* … */ };
export const MASKED_ERROR_CODES: Readonly<Partial<Record<ErrorCode, ErrorCode>>> = { /* … */ };
```

A unit test asserts `ERROR_CODE_SPECS` has exactly one entry per `ErrorCode` member and that every
message is non-empty. A second test asserts every ✔︎ string matches PRD §8.3 character for character.

### 2.5 Exceptions

```typescript
// libs/common/src/exceptions/app.exception.ts
import { HttpException } from '@nestjs/common';
import { ERROR_CODE_SPECS, ErrorCode } from '../constants/error-codes.constant';

export interface FieldError {
  field: string;
  message: string;
  code?: string;
}

export interface AppExceptionOptions {
  /** Overrides the default message from ERROR_CODE_SPECS. Must still be user-safe. */
  message?: string;
  /** Field-level validation detail. */
  errors?: FieldError[];
  /** Typed, non-sensitive data the UI needs to render the state. */
  details?: Record<string, unknown>;
  /** Attached to the log line only. Never serialised to the client. */
  cause?: unknown;
}

export class AppException extends HttpException {
  readonly errorCode: ErrorCode;
  readonly errors: FieldError[];
  readonly details?: Record<string, unknown>;

  constructor(errorCode: ErrorCode, options: AppExceptionOptions = {}) {
    const spec = ERROR_CODE_SPECS[errorCode];
    const message = options.message ?? spec.message;
    super(
      { errorCode, message, errors: options.errors ?? [], details: options.details },
      spec.status,
      { cause: options.cause },
    );
    this.errorCode = errorCode;
    this.errors = options.errors ?? [];
    this.details = options.details;
  }
}
```

Subclasses exist to make intent readable at the throw site and to let tests assert on class. They fix
the code family; they never change the status, which always comes from `ERROR_CODE_SPECS`.

```typescript
export class AuthException       extends AppException {}        // AUTH_*, SESSION_*, TWOFA_*, CSRF_*
export class ForbiddenException  extends AppException {}        // INSUFFICIENT_ROLE, *_DISABLED, IP_BLOCKED
export class NotFoundException   extends AppException {}        // *_NOT_FOUND
export class ConflictException   extends AppException {}        // *_EXISTS, INVALID_*_TRANSITION, IDEMPOTENCY_IN_FLIGHT
export class ValidationException extends AppException {}        // VALIDATION_ERROR, *_INVALID, IMAGE_*
export class GuardChainException extends AppException {}        // every §8.1 step-3 rejection
export class QuotaException      extends GuardChainException {} // QUOTA_EXHAUSTED, BUDGET_EXHAUSTED
export class ConsentException    extends GuardChainException {} // CONSENT_REQUIRED, CONSENT_STALE
export class OwnershipException  extends GuardChainException {} // *_NOT_OWNED — always masked
export class UpstreamException   extends AppException {}        // UPSTREAM_*, MODERATION_REJECTED
export class StorageException    extends AppException {}        // FILE_*, UPLOAD_*, STORAGE_*
```

Throw sites read:

```typescript
throw new QuotaException(ErrorCode.QUOTA_EXHAUSTED, {
  details: { period, limit, used, resetsAt },
});
```

`GlobalExceptionFilter` catches everything, applies `MASKED_ERROR_CODES`, logs
`{ level, requestId, userId, errorCode, trueErrorCode, path, method, durationMs, stack }` and emits
the `errors.by_code` metric (E-13). Unknown exceptions become `INTERNAL_ERROR`, with the original
logged at `error` — the client never sees an internal message.

### 2.6 Decorators

`libs/common/src/decorators/` — the complete inventory. Anything else is a review failure.

| Decorator | Metadata key | Purpose |
| --- | --- | --- |
| `@Public()` | `isPublic` | Bypasses `SessionAuthGuard`. Does **not** bypass CSRF or throttling. A `@Public()` route must still declare `@Roles(Role.PUBLIC)` so the B-5 check passes, and must carry an explicit `@Throttle()`. |
| `@Roles(...roles: Role[])` | `roles` | The route's authorisation contract. `Role.PUBLIC \| Role.CONSUMER \| Role.ADMIN`. **Every route handler carries exactly one.** `scripts/check-route-guards.ts` walks the route table and fails CI on any handler without it (B-5). |
| `@CurrentUser()` / `@CurrentUser('id')` | — | Param decorator returning `ICurrentUser` from `request.user`, or one property of it. Returns `undefined` on `@Public()` routes with no session. |
| `@ResponseMessage('…')` | `responseMessage` | Sets `message` in the success envelope. |
| `@SkipCsrf()` | `skipCsrf` | Bypasses `CsrfGuard`. Permitted **only** where the request's credential travels in the URL rather than in an ambient cookie, so a cross-site form cannot forge it: `PUT /api/v1/files/upload/:ticket` (§3.5 step 2) is the one such route. It is **not** permitted on `POST /auth/login` or `POST /auth/signup` — those forms fetch an anonymous-scope token from `GET /auth/csrf` first, exactly as `POST /invites/token/:token/accept` does, and skipping the guard there allows forced authentication (signing a victim into an attacker-controlled account). Every use carries a comment naming the reason. |

`ICurrentUser`:

```typescript
export interface ICurrentUser {
  id: string;
  role: Role;                 // resolved server-side from the session row (S-3)
  email: string;
  name: string;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  sessionId: string;
  locale: Locale;
}
```

`request.user` is populated **only** by `SessionAuthGuard`, from the `sessions` row joined to
`users`. It is never read from a header, query parameter, body field or any client-supplied claim
(S-3).

### 2.7 Guard chain

Registered in `apps/api/src/bootstrap/global-providers.ts`. **Registration order is execution
order.** This order is fixed and identical for every route.

```typescript
providers: [
  { provide: APP_GUARD, useClass: CsrfGuard },          // 1
  { provide: APP_GUARD, useClass: UserThrottlerGuard }, // 2  extends ThrottlerGuard
  { provide: APP_GUARD, useClass: SessionAuthGuard },   // 3
  { provide: APP_GUARD, useClass: RolesGuard },         // 4
  { provide: APP_INTERCEPTOR, useClass: ResponseTransformInterceptor },
  { provide: APP_FILTER, useClass: GlobalExceptionFilter },
]
```

```
Request
  │
  ├─ 1. CsrfGuard        Skipped for GET/HEAD/OPTIONS and @SkipCsrf().
  │                      Double-submit: header `X-CSRF-Token` must equal cookie `drape.csrf`
  │                      AND HMAC-verify against the session's `csrfSecret`.
  │                      → CSRF_TOKEN_MISSING / CSRF_TOKEN_INVALID
  │
  ├─ 2. UserThrottlerGuard  Tracker = `request.user?.id ?? request.ip`. Global default plus
  │                      per-route @Throttle(). Rejections on auth routes also append an
  │                      `auth_attempts` row.  → RATE_LIMIT_EXCEEDED (+ Retry-After)
  │
  ├─ 3. SessionAuthGuard Skipped when @Public(). Reads cookie `drape.sid`, looks the session up by
  │                      sha256 hash, checks revokedAt / expiresAt / absoluteExpiresAt /
  │                      twofaPending, slides `expiresAt` (12h admin, 30d consumer — S-7), updates
  │                      `lastSeenAt` and `users.lastActiveAt`, attaches ICurrentUser.
  │                      → AUTH_REQUIRED / SESSION_EXPIRED / SESSION_INVALID / TWOFA_REQUIRED /
  │                        ACCOUNT_SUSPENDED / ACCOUNT_DEACTIVATED
  │
  ├─ 4. RolesGuard       Reads @Roles(). PUBLIC always passes. Otherwise the session role must be
  │                      in the list.  → INSUFFICIENT_ROLE
  │
  ├─ Controller → Service  Object-level ownership is checked HERE, in the service, on every read
  │                      and mutation of a photo, render, job, shortlist item, share link or
  │                      enquiry. The guard chain authorises the route; the service authorises the
  │                      row (§9.2). Ownership is never inferred from an unguessable id.
  │
  └─ ResponseTransformInterceptor → envelope
```

Deactivating or suspending a user (A-2, A-19) sets `revokedAt` on every `sessions` row for that user;
guard 3 rejects on their next request, so revocation is immediate.

### 2.8 Pagination

```typescript
// libs/common/src/dto/pagination-query.dto.ts
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ default: 'createdAt' })
  @IsOptional() @IsString()
  sortBy: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional() @IsIn(['ASC', 'DESC'])
  sortOrder: 'ASC' | 'DESC' = 'DESC';
}
```

`sortBy` is validated **per module** against an allow-list before it reaches the query builder — never
interpolated. Module query DTOs extend this class, add `search` plus their own filters, and narrow
`sortBy` with `@IsIn([...])`.

Services return this shape, and only this shape, for every list endpoint:

```typescript
export interface PaginationMeta {
  page: number; limit: number; total: number; totalPages: number;
  sortBy: string; sortOrder: 'ASC' | 'DESC';
}
export interface IPaginated<T> { items: T[]; meta: PaginationMeta; }
```

Consumer-facing infinite lists (catalog grid, history) use the same endpoints; the client drives
`page`. Cursor pagination is not used in V1.

### 2.9 Feature module template

```
modules/{feature}/
├── {feature}.module.ts          # registers entities, controllers, services; exports only what others need
├── controllers/
│   └── {feature}.controller.ts  # one @ApiTags, one @Roles per handler, no business logic
├── services/
│   └── {feature}.service.ts     # business rules, ownership checks, throws AppException, emits events
├── entities/
│   └── {feature}.entity.ts
├── dto/
│   ├── create-{feature}.dto.ts
│   ├── update-{feature}.dto.ts
│   ├── {feature}-query.dto.ts   # extends PaginationQueryDto
│   └── {feature}-response.dto.ts# controllers NEVER return raw entities
├── mappers/
│   └── {feature}.mapper.ts      # entity → response DTO; the only place that shape is decided
├── guards/                      # optional, module-scoped
├── listeners/                   # optional, @OnEvent handlers
├── processors/                  # optional, @Cron / in-process task processors
└── index.ts                     # optional barrel
```

Non-negotiable rules:

1. Controllers validate and delegate. No repository access, no branching on business state.
2. Services never return entities to controllers except through a mapper.
3. Any method writing to two or more tables runs inside a `QueryRunner` transaction; events are
   emitted **after** `commitTransaction()`.
4. Audit rows (A-3) are written by an `@OnEvent` listener in the `audit` module, not inline in each
   service.
5. A module never imports another module's entity file. It imports the module.
6. Every list query is scoped by `userId` for consumers before any other filter is applied.

---

## 3. Storage contract (`@library/storage`)

Storage is local disk in V1 and object storage later. The seam is the driver interface. **No code
outside `libs/storage` ever touches `fs`, `path.join` on a storage key, or a bucket SDK.**

### 3.1 Driver interface

```typescript
// libs/storage/src/drivers/storage-driver.interface.ts

export interface StoredObject {
  key: string;
  byteSize: number;
  contentType: string;
  etag: string;          // sha256 of the bytes, hex — also the content hash used by the cache
  lastModified: Date;
}

export interface PutOptions {
  contentType: string;
  /** Fails with STORAGE_WRITE_FAILED instead of overwriting when true. Default true. */
  failIfExists?: boolean;
  cacheControl?: string;
}

export interface UploadTicket {
  /** Absolute URL the client PUTs the bytes to. */
  uploadUrl: string;
  /** The key the object will occupy once redeemed. */
  key: string;
  /** Extra fields the client must send. Empty for the local driver; S3 POST policy fields later. */
  fields: Record<string, string>;
  expiresAt: Date;
  /** true when uploadUrl points at an origin the API does not control (S3). */
  isDirect: boolean;
}

export interface StorageDriver {
  readonly name: 'local-disk' | 's3';

  put(key: string, body: Buffer | Readable, options: PutOptions): Promise<StoredObject>;
  get(key: string): Promise<Readable>;
  head(key: string): Promise<StoredObject | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;          // idempotent: false when already absent
  deletePrefix(prefix: string): Promise<number>;  // returns objects removed
  copy(sourceKey: string, destinationKey: string): Promise<StoredObject>;
  list(prefix: string, limit?: number): Promise<StoredObject[]>;

  /** Issues an upload target. Local driver returns an API URL; S3 returns a presigned URL. */
  createUploadTicket(key: string, options: {
    contentType: string;
    maxBytes: number;
    ttlSeconds: number;
    subject?: string;
  }): Promise<UploadTicket>;
}
```

`StorageService` is the only injected dependency. It wraps the driver, adds key construction,
signed-URL issuing, sha256 hashing, `sharp` post-processing and metric emission. It selects the
driver from `STORAGE_DRIVER` (`local` in V1). Adding S3 means adding `s3.driver.ts` and one line in
`storage.module.ts` — no call site changes.

### 3.2 Local-disk driver requirements

| # | Requirement |
| --: | --- |
| 1 | Root is `resolve(process.env.STORAGE_ROOT)`, default `D:/drape-storage`. Resolved **once** at module init and asserted to be an absolute path that is **not** inside the repository root. Startup fails otherwise. |
| 2 | **Path-traversal defence.** Every operation computes `const full = path.resolve(root, key)` and then asserts `full === root \|\| full.startsWith(root + path.sep)`. Failure throws `StorageException(STORAGE_PATH_REJECTED)` and logs at `warn` with the raw key. This check is in one private method, `assertInsideRoot()`, called by every driver method. There is no code path to disk that skips it. |
| 3 | Keys are additionally validated against `/^[a-z0-9][a-z0-9\-/]*\.[a-z0-9]{2,5}$/` with no `..` segment, no leading `/`, no backslash, no NUL, max 512 characters, before `assertInsideRoot`. |
| 4 | Writes are atomic: write to `<root>/.tmp/<uuid>`, `fsync`, then `rename` into place. `.tmp` is created at init and swept of files older than 6 hours by the retention cron. |
| 5 | Parent directories are created with `mkdir -p` semantics under the root only. |
| 6 | `delete` is idempotent — `ENOENT` returns `false`, never throws. |
| 7 | Every write computes sha256 of the bytes while streaming and returns it as `etag`. Callers persist it as the `hash` column. |
| 8 | The root directory is **never** exposed by a static file middleware. The only read path is `GET /api/v1/files/:token`. |
| 9 | Content type is validated against the magic bytes of the buffer, not the client-supplied header, before write. Mismatch → `IMAGE_FORMAT_UNSUPPORTED`. |
| 10 | Free-space check at startup and in `/health/ready`; below `STORAGE_MIN_FREE_MB` the health check reports degraded and an alert fires (E-14). |

### 3.3 Key layout

Keys are built **only** by `storage-key.builder.ts`. String concatenation of a key anywhere else is a
review failure.

```
garments/<garmentId>/<uuid>.<ext>
categories/<categoryId>/<uuid>.<ext>
person-photos/<userId>/<uuid>.<ext>
renders/<userId>/<uuid>.png
thumbnails/<kind>/<uuid>.webp
reference-models/<uuid>.jpg
brand/<uuid>.<ext>
```

```typescript
export type ThumbnailKind = 'garment' | 'render' | 'category' | 'person-blurred' | 'reference-model';

export const StorageKeys = {
  garmentImage:  (garmentId: string, ext: ImageExt) => `garments/${garmentId}/${randomUUID()}.${ext}`,
  categoryCover: (categoryId: string, ext: ImageExt) => `categories/${categoryId}/${randomUUID()}.${ext}`,
  personPhoto:   (userId: string, ext: ImageExt)     => `person-photos/${userId}/${randomUUID()}.${ext}`,
  render:        (userId: string)                    => `renders/${userId}/${randomUUID()}.png`,
  thumbnail:     (kind: ThumbnailKind)               => `thumbnails/${kind}/${randomUUID()}.webp`,
  referenceModel:()                                  => `reference-models/${randomUUID()}.jpg`,
  brandAsset:    (ext: ImageExt)                     => `brand/${randomUUID()}.${ext}`,
} as const;
```

- `ext` is drawn from a closed set: `jpg | jpeg | png | webp | heic | svg` (`svg` only for `brand/`,
  and sanitised before write).
- The `<uuid>` is v4 and unguessable. It is **not** a substitute for an authorisation check.
- `renders/` is always `.png` — that is what the upstream returns.
- Thumbnails are always `.webp`. Sizes: `320w` grid, `640w` detail, `160w` admin table. The width is
  encoded in the filename suffix by `ImageService`, e.g. `thumbnails/render/<uuid>-320.webp`.
- Deleting a consumer deletes the prefixes `person-photos/<userId>/` and `renders/<userId>/`, plus
  every thumbnail key recorded on her rows. `deletePrefix` returns the count, which is written to
  `deletion_log.itemsDeleted` (§9.3 verifiable deletion log).

### 3.4 Signed download URLs

Every read of a stored object goes through a short-lived HMAC token (PRD §9.2).

```
token   = base64url(payload) + "." + base64url(HMAC-SHA256(base64url(payload), STORAGE_URL_SECRET))
payload = JSON.stringify({ key, exp, sub? })        // compact, keys in this order
exp     = Unix seconds
sub     = the userId the token is scoped to (omitted for public assets)
URL     = {APP_API_URL}/api/v1/files/{token}
```

```typescript
export interface SignedUrlPayload {
  /** storage key */
  key: string;
  /** Unix seconds */
  exp: number;
  /** owning userId — present for every private object */
  sub?: string;
}
```

Issuing rules:

| Object class | `sub` | TTL (`STORAGE_URL_TTL_*`) |
| --- | --- | --- |
| `person-photos/**` | required | 300 s |
| `renders/**` | required | 900 s |
| `thumbnails/person-blurred/**` | required — the reviewing **admin's** id (A-34) | 300 s |
| `garments/**`, `categories/**`, `brand/**`, `reference-models/**`, other thumbnails | omitted | 3600 s |

Verification in `GET /api/v1/files/:token`, in this order:

1. Split on the last `.`; reject a malformed token → `FILE_TOKEN_INVALID`.
2. Recompute the HMAC and compare with `crypto.timingSafeEqual`. Mismatch → `FILE_TOKEN_INVALID`.
3. Parse the payload; `exp` in the past → `FILE_TOKEN_EXPIRED`.
4. If `sub` is present: a valid session is required and `session.userId === sub`, **except** that an
   `ADMIN` may read a `thumbnails/person-blurred/**` key whose `sub` is their own id. Any other
   mismatch → `FILE_TOKEN_SUBJECT_MISMATCH`. Every admin read of a blurred moderation thumbnail
   emits `MODERATION_ITEM_VIEWED` to the audit log (A-34, §9.3).
5. `assertInsideRoot(key)`; missing object → `FILE_NOT_FOUND`.
6. Stream with `Cache-Control: private, max-age=<remaining ttl>`, `Content-Type` from `head()`,
   `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`. `sub`-less public assets use
   `Cache-Control: public, max-age=3600`.

The token is opaque to the frontend. Response DTOs never contain a raw storage key — they contain a
ready-to-use `url` field (already signed) plus a `thumbnailUrl`. **A storage key must never cross the
network boundary.**

### 3.5 Uploads

PRD C-15 asks for direct-to-storage upload via a pre-signed URL. The local-disk driver has no
independent storage host, so the pattern is preserved at the interface and adapted at the transport:

1. Client calls `POST /api/v1/files/upload-ticket` with `{ purpose, contentType, byteSize }`.
   `purpose` ∈ `PERSON_PHOTO | GARMENT_IMAGE | CATEGORY_COVER | BRAND_ASSET`. The API authorises the
   purpose against the caller's role, builds the key, and returns an `UploadTicket`.
2. Client `PUT`s the bytes to `ticket.uploadUrl`. For the local driver that is
   `PUT /api/v1/files/upload/:ticket` on the API, streamed straight to disk with no buffering of the
   whole file and a hard `maxBytes` cut-off. For the future S3 driver it is the bucket URL and the
   API is not in the data path — `isDirect` tells the client which it is.
3. Client calls the owning module's finalise endpoint (e.g. `POST /api/v1/person-photos`) with the
   returned `key`. The module verifies the object exists, re-probes it with `sharp`, strips EXIF,
   generates thumbnails, records `hash`/`width`/`height`/`byteSize`, and writes the row.
4. An object with no owning row after 6 hours is swept by the retention cron.

The upload ticket is the same HMAC construction as §3.4 with an extra payload — `{ key, exp, sub,
maxBytes, contentType }` — and a distinct secret domain separator (`"upload:"` prefixed to the signed
string), so a download token can never be replayed as an upload token.

### 3.6 Image processing (`ImageService`, `sharp`)

| Operation | Rule |
| --- | --- |
| EXIF strip | Every `person-photos/**` write is re-encoded with `.rotate().withMetadata({ exif: {} })` — orientation is applied, all other metadata dropped (C-15). Applied server-side even though the client also strips. |
| Thumbnails | Generated on write, never on read. `webp`, quality 78, `fit: 'cover'` for grid, `fit: 'inside'` for detail. |
| Blurred moderation thumbnail | `blur(28)` at 160w, written to `thumbnails/person-blurred/`. The unblurred photo is never readable by an admin (S-10). |
| Watermark (C-23) | Applied **at download time only**, composited by `GET /api/v1/results/:id/download`. Stored renders are clean, so history and re-download stay cheap and the watermark can be restyled without a backfill. Bottom-inline-end, 6 % of the long edge, 55 % opacity, from `brand/` or the packaged default. |
| Quality probe (A-10) | `metadata()` gives dimensions and format; the long-edge, aspect-band and format checks are pure functions over that. Background uniformity and dominant-garment detection run on a 256px downscale. All five checks are pure and unit-tested (E-5). |

### 3.7 Content-hash cache (PRD §8.1 step 4, PRD §8.4)

```
cacheKey = sha256(`${garmentSourceHash}:${personPhotoHash}:${TRYON_API_VERSION}`)
```

`garmentSourceHash` is `garment_images.hash` of the try-on source. `personPhotoHash` is
`person_photos.hash`. Both are the sha256 the driver returned on write. `TRYON_API_VERSION` is an env
value; bumping it invalidates the whole cache without a migration.

**On a hit the render file is copied into the requesting user's own namespace**
(`renders/<userId>/<uuid>.png`) and a new `tryon_results` row is written for her. It is never shared
by reference. This keeps per-user deletion (C-31, C-38) and per-user signed URLs correct, and costs a
file copy instead of a generation. `cacheHit = true` on the job, quota and budget are **not**
decremented (C-22), and the cache row's `hitCount` is incremented.

Replacing or removing a photo retires its cache entries (C-16): every `tryon_cache` row whose
`personPhotoHash` matches the removed photo is deleted, so a later try-on of the same garment
generates afresh. Renders already produced stay in history (C-28).

---

## 4. Domain data model

### 4.0 Rules that apply to every table

1. Primary key is `uuid`, generated by `@PrimaryGeneratedColumn('uuid')`. No sequential ids anywhere.
2. Every timestamp is `timestamptz`. No `timestamp`, no `date` except true calendar dates
   (`consumer_profiles.eventDate`, `enquiries.eventDate`).
3. Every entity extends `BaseEntity` **or** `AppendOnlyEntity` (§2.1). The base class supplies
   `id`, `createdAt`, and — for `BaseEntity` — `updatedAt` and `deletedAt`. Those four columns are
   **not repeated** in the tables below.
4. **Every unique index carries `WHERE "deletedAt" IS NULL`.** Tables on `AppendOnlyEntity` have no
   `deletedAt`, so their unique indexes carry no predicate — they are the only exception, and each is
   called out explicitly below.
5. Money is `decimal(18,2)` with `decimalTransformer`, paired with a `char(3)` currency column
   defaulting to `'PKR'`.
6. Enum columns are PostgreSQL enums. Values are UPPER_SNAKE_CASE and identical in TS, PG and JSON.
7. Every consumer-owned row carries `userId` so ownership is a single predicate (PRD §12).
8. `onDelete` follows: `CASCADE` when the child cannot exist without the parent, `SET NULL` when the
   child must survive the parent, `RESTRICT` when deletion must be blocked. Every FK below states it.
9. Foreign-key columns are always indexed.
10. **`quota_ledger` and `usage_ledger` are append-only. Remaining quota and remaining budget are
    DERIVED with `SUM(delta)` at read time and are NEVER stored as a mutable balance column.** There
    is no `users.remainingQuota` and no `settings.budgetRemaining`. Any such column is a bug.

### 4.1 Enum registry

Every PostgreSQL enum in the schema, in one place.

| PG type | TS type | Values |
| --- | --- | --- |
| `role_enum` | `Role` | `ADMIN`, `CONSUMER` — plus a TS-only `PUBLIC` member used by `@Roles()`, never stored |
| `user_status_enum` | `UserStatus` | `ACTIVE`, `SUSPENDED`, `DEACTIVATED` |
| `locale_enum` | `Locale` | `EN`, `UR` |
| `event_type_enum` | `EventType` | `MEHNDI`, `NIKKAH`, `BARAAT`, `WALIMA`, `ENGAGEMENT`, `RECEPTION`, `OTHER` |
| `budget_band_enum` | `BudgetBand` | `UNDER_100K`, `BAND_100K_250K`, `BAND_250K_500K`, `BAND_500K_1M`, `ABOVE_1M` (PKR) |
| `embellishment_weight_enum` | `EmbellishmentWeight` | `LIGHT`, `MEDIUM`, `HEAVY` |
| `garment_mode_enum` | `GarmentMode` | `SALE`, `RENTAL` |
| `publish_state_enum` | `PublishState` | `DRAFT`, `PUBLISHED`, `ARCHIVED` |
| `test_render_state_enum` | `TestRenderState` | `NONE`, `PENDING`, `APPROVED`, `REJECTED` |
| `photo_moderation_state_enum` | `PhotoModerationState` | `PENDING`, `APPROVED`, `BLOCKED` |
| `job_status_enum` | `JobStatus` | `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED` |
| `job_origin_enum` | `JobOrigin` | `CONSUMER`, `TEST_RENDER` |
| `verdict_enum` | `Verdict` | `LOVE_IT`, `MAYBE`, `NOT_FOR_ME` |
| `reject_reason_enum` | `RejectReason` | `NECKLINE`, `COLOR`, `TOO_HEAVY`, `SILHOUETTE`, `PRICE` |
| `reaction_enum` | `Reaction` | `HEART`, `UNSURE`, `NO` |
| `enquiry_status_enum` | `EnquiryStatus` | `NEW`, `CONTACTED`, `IN_DISCUSSION`, `CLOSED_WON`, `CLOSED_LOST` |
| `quota_reason_enum` | `QuotaReason` | `MONTHLY_GRANT`, `OVERRIDE_GRANT`, `GENERATION_CONSUMED`, `ADMIN_ADJUSTMENT` |
| `usage_reason_enum` | `UsageReason` | `MONTHLY_BUDGET_GRANT`, `CONSUMER_GENERATION`, `TEST_RENDER`, `ADMIN_ADJUSTMENT` |
| `moderation_source_enum` | `ModerationSource` | `UPSTREAM`, `HEURISTIC`, `MANUAL_REPORT` |
| `moderation_state_enum` | `ModerationState` | `PENDING`, `APPROVED`, `REJECTED` |
| `notification_channel_enum` | `NotificationChannel` | `EMAIL`, `SMS`, `IN_APP` |
| `notification_status_enum` | `NotificationStatus` | `PENDING`, `SENDING`, `SENT`, `FAILED`, `CANCELLED` |
| `verification_purpose_enum` | `VerificationPurpose` | `EMAIL_VERIFICATION`, `PASSWORD_RESET`, `PHONE_OTP`, `INVITE` |
| `auth_outcome_enum` | `AuthOutcome` | `SUCCESS`, `INVALID_CREDENTIALS`, `LOCKED`, `TWOFA_FAILED`, `RATE_LIMITED`, `SUSPENDED` |
| `deletion_subject_enum` | `DeletionSubject` | `USER`, `PERSON_PHOTO`, `TRYON_RESULT`, `SHARE_LINK`, `TRYON_JOB`, `EXPORT_ARCHIVE` |
| `deletion_initiator_enum` | `DeletionInitiator` | `CONSUMER`, `ADMIN`, `PURGE_JOB` |
| `settings_value_type_enum` | `SettingsValueType` | `STRING`, `NUMBER`, `BOOLEAN`, `JSON` |

### 4.2 Entities added beyond PRD §12

The PRD §12 block lists nineteen tables. The eleven below (in ten rows) are additions, bringing the
schema to **thirty entities**. Each is required by a numbered requirement the PRD's own table does not
model; none changes product behaviour.

| Table | Why it exists |
| --- | --- |
| `sessions` | Custom server-side sessions (B-6), S-7 durations, A-2 immediate revocation. |
| `policy_versions` | C-12 re-consent when the policy version changes needs a versioned policy body, in both locales. |
| `reference_models` | E-4 / A-11 the built-in reference model photos used by the test-render gate. |
| `moderation_items` | A-34 moderation queue with blurred thumbnails and audited views. |
| `deletion_log` | §9.3 "automated purge with a verifiable deletion log", A-20 confirmation record. |
| `notifications_outbox` | A-25 email + in-app notification, C-19 result-ready notification, §8.3 budget-exhausted "we'll email you". Channel `IN_APP` doubles as the in-app notification store (`readAt`). |
| `tryon_cache` | §8.1 step 4 and step 6 require a cache entry keyed by content hash across users. `tryon_results.cacheKey` alone cannot serve a cross-user lookup without leaking another user's row. |
| `enquiry_items` | A-21 an enquiry contains the shortlisted garments *in her rank order with their renders and per-item notes*. The shortlist keeps changing; the enquiry must be a snapshot. |
| `verification_tokens` | S-6 reset tokens, C-3 email verification and phone OTP, and invite acceptance. One table, `purpose`-discriminated. |
| `auth_attempts` / `ip_blocks` | S-6 lockout with exponential backoff must survive a restart; A-35 abuse view lists accounts hitting rate limits and repeated failures, with IP blocking. |

### 4.3 `users` — module `users`, table `users`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `role` | `Role` | `enum`, `role_enum` | no |
| `email` | `string` | `varchar(320)` — stored lower-cased and trimmed | no |
| `emailVerifiedAt` | `Date \| null` | `timestamptz` | yes |
| `passwordHash` | `string` | `varchar(255)` — Argon2id (S-6) | no |
| `name` | `string` | `varchar(120)` | no |
| `phone` | `string \| null` | `varchar(24)` — E.164 | yes |
| `phoneVerifiedAt` | `Date \| null` | `timestamptz` | yes |
| `twofaSecret` | `string \| null` | `varchar(255)` — AES-256-GCM ciphertext under `TWOFA_ENCRYPTION_KEY`, never plaintext | yes |
| `twofaEnabledAt` | `Date \| null` | `timestamptz` | yes |
| `twofaRecoveryCodes` | `string[] \| null` | `text[]` — bcrypt hashes | yes |
| `status` | `UserStatus` | `enum`, default `ACTIVE` | no |
| `suspendedReason` | `string \| null` | `text` (A-19 required on suspend) | yes |
| `suspendedAt` | `Date \| null` | `timestamptz` | yes |
| `invitedBy` | `string \| null` | `uuid` | yes |
| `lastLoginAt` | `Date \| null` | `timestamptz` | yes |
| `lastActiveAt` | `Date \| null` | `timestamptz` — drives A-16 and the §9.3 30-day photo purge | yes |
| `failedLoginCount` | `number` | `int`, default `0` | no |
| `lockedUntil` | `Date \| null` | `timestamptz` | yes |
| `locale` | `Locale` | `enum`, default `EN` | no |
| `deletionRequestedAt` | `Date \| null` | `timestamptz` — C-38, purge completes within 24 h | yes |

Relations: `invitedBy → users.id` `ManyToOne`, `SET NULL`.
Indexes:
`UQ_users_email UNIQUE (lower("email")) WHERE "deletedAt" IS NULL` ·
`UQ_users_phone UNIQUE ("phone") WHERE "phone" IS NOT NULL AND "deletedAt" IS NULL` ·
`IDX_users_role_status ("role","status")` · `IDX_users_lastActiveAt ("lastActiveAt")`.

One table holds both roles (PRD §12). There is no separate admins table and no code path where
`/signup` can produce `role = ADMIN` (S-4).

### 4.4 `consumer_profiles` — module `users`, table `consumer_profiles`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `userId` | `string` | `uuid` | no |
| `eventDate` | `Date \| null` | `date` | yes |
| `eventType` | `EventType \| null` | `enum` | yes |
| `budgetBand` | `BudgetBand \| null` | `enum` | yes |
| `preferredCategories` | `string[]` | `uuid[]`, default `'{}'` | no |
| `monthlyQuotaOverride` | `number \| null` | `int` — A-18, null means use the global default | yes |
| `notificationPreferences` | `NotificationPreferences` | `jsonb`, default `'{}'` — typed interface, C-7 | no |
| `onboardingCompletedAt` | `Date \| null` | `timestamptz` | yes |

Relations: `userId → users.id` `OneToOne`, `CASCADE`.
Indexes: `UQ_consumer_profiles_userId UNIQUE ("userId") WHERE "deletedAt" IS NULL`.

```typescript
export interface NotificationPreferences {
  emailOnResultReady: boolean;   // default true
  emailOnEnquiryUpdate: boolean; // default true
  emailOnNewArrivals: boolean;   // default false
  smsOnEnquiryUpdate: boolean;   // default false
}
```

### 4.5 `sessions` — module `auth`, table `sessions`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `userId` | `string` | `uuid` | no |
| `tokenHash` | `string` | `char(64)` — sha256 of the opaque 32-byte cookie value; the raw value is never stored | no |
| `csrfSecret` | `string` | `char(64)` — random hex, HMAC key for the double-submit token | no |
| `role` | `Role` | `enum` — snapshot for fast reads; `users.role` remains authoritative and is re-read on every request | no |
| `ip` | `string` | `inet` | no |
| `userAgent` | `string \| null` | `varchar(512)` | yes |
| `lastSeenAt` | `Date` | `timestamptz` | no |
| `expiresAt` | `Date` | `timestamptz` — sliding idle expiry: +12 h admin, +30 d consumer (S-7) | no |
| `absoluteExpiresAt` | `Date` | `timestamptz` — hard ceiling: +7 d admin, +90 d consumer | no |
| `twofaPending` | `boolean` | `boolean`, default `false` — set at login when 2FA is on; only `/auth/2fa/challenge` is reachable | no |
| `twofaVerifiedAt` | `Date \| null` | `timestamptz` | yes |
| `revokedAt` | `Date \| null` | `timestamptz` | yes |
| `revokedReason` | `string \| null` | `varchar(64)` — `LOGOUT`, `LOGOUT_ALL`, `PASSWORD_CHANGED`, `DEACTIVATED`, `SUSPENDED`, `ADMIN_REVOKED` | yes |

Relations: `userId → users.id` `ManyToOne`, `CASCADE`.
Indexes: `UQ_sessions_tokenHash UNIQUE ("tokenHash") WHERE "deletedAt" IS NULL` ·
`IDX_sessions_userId_revokedAt ("userId","revokedAt")` · `IDX_sessions_expiresAt ("expiresAt")`.
Rows are hard-deleted by the retention cron 30 days after `absoluteExpiresAt`.

### 4.6 `verification_tokens` — module `auth`, table `verification_tokens`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `userId` | `string \| null` | `uuid` — null for an invite acceptance before the account exists | yes |
| `purpose` | `VerificationPurpose` | `enum` | no |
| `tokenHash` | `string` | `char(64)` — sha256 of the emailed token | no |
| `codeHash` | `string \| null` | `char(64)` — sha256 of the 6-digit OTP (`PHONE_OTP` only) | yes |
| `destination` | `string` | `varchar(320)` — email or E.164 | no |
| `expiresAt` | `Date` | `timestamptz` — 30 min reset (S-6), 24 h email verify, 10 min OTP, 7 d invite | no |
| `consumedAt` | `Date \| null` | `timestamptz` — single use | yes |
| `attempts` | `number` | `int`, default `0` | no |
| `ip` | `string \| null` | `inet` | yes |

Relations: `userId → users.id` `ManyToOne`, `CASCADE`.
Indexes: `UQ_verification_tokens_tokenHash UNIQUE ("tokenHash") WHERE "deletedAt" IS NULL` ·
`IDX_verification_tokens_userId_purpose ("userId","purpose")` · `IDX_verification_tokens_expiresAt`.

### 4.7 `auth_attempts` — module `auth`, table `auth_attempts` · **append-only**

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `emailHash` | `string` | `char(64)` — sha256 of the lower-cased email; the address itself is never stored here (E-12) | no |
| `userId` | `string \| null` | `uuid` | yes |
| `ip` | `string` | `inet` | no |
| `userAgent` | `string \| null` | `varchar(512)` | yes |
| `outcome` | `AuthOutcome` | `enum` | no |
| `route` | `string` | `varchar(64)` — `LOGIN`, `SIGNUP`, `PASSWORD_RESET`, `OTP`, `TWOFA` | no |

Relations: `userId → users.id`, `SET NULL`. Indexes: `IDX_auth_attempts_emailHash_createdAt` ·
`IDX_auth_attempts_ip_createdAt` · `IDX_auth_attempts_outcome_createdAt`. No unique index.

Backoff (S-6): lockout after 5 failures inside 15 minutes, `lockedUntil = now + 2^(n-5) minutes`
capped at 60 minutes, counted per `emailHash` **and** per `ip` independently.

### 4.8 `ip_blocks` — module `moderation`, table `ip_blocks`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `cidr` | `string` | `cidr` | no |
| `reason` | `string` | `varchar(255)` | no |
| `createdBy` | `string \| null` | `uuid` | yes |
| `expiresAt` | `Date \| null` | `timestamptz` — null means indefinite | yes |

Relations: `createdBy → users.id`, `SET NULL`.
Indexes: `UQ_ip_blocks_cidr UNIQUE ("cidr") WHERE "deletedAt" IS NULL`.

### 4.9 `invites` — module `invites`, table `invites`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `email` | `string` | `varchar(320)` lower-cased | no |
| `role` | `Role` | `enum` — always `ADMIN` in V1 (S-5) | no |
| `tokenHash` | `string` | `char(64)` | no |
| `expiresAt` | `Date` | `timestamptz` — 7 days | no |
| `consumedAt` | `Date \| null` | `timestamptz` | yes |
| `invitedBy` | `string` | `uuid` | no |
| `consumedByUserId` | `string \| null` | `uuid` | yes |

Relations: `invitedBy → users.id` `RESTRICT`; `consumedByUserId → users.id` `SET NULL`.
Indexes: `UQ_invites_tokenHash UNIQUE ("tokenHash") WHERE "deletedAt" IS NULL` ·
`UQ_invites_email_pending UNIQUE ("email") WHERE "consumedAt" IS NULL AND "deletedAt" IS NULL`.

### 4.10 `policy_versions` — module `consents`, table `policy_versions`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `version` | `string` | `varchar(20)` — e.g. `2026.08.1` | no |
| `effectiveFrom` | `Date` | `timestamptz` | no |
| `isCurrent` | `boolean` | `boolean`, default `false` | no |
| `bodyEn` | `string` | `text` — Markdown, covers all five C-11 statements | no |
| `bodyUr` | `string` | `text` | no |
| `summaryEn` | `string` | `text` | no |
| `summaryUr` | `string` | `text` | no |
| `retentionSummary` | `PolicyRetention` | `jsonb` — `{ photoDays: 30, rendersLifetime: true }` (C-11) | no |

Indexes: `UQ_policy_versions_version UNIQUE ("version") WHERE "deletedAt" IS NULL` ·
`UQ_policy_versions_current UNIQUE ("isCurrent") WHERE "isCurrent" = true AND "deletedAt" IS NULL`
— exactly one current policy at a time.

### 4.11 `consents` — module `consents`, table `consents` · **append-only**

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `userId` | `string` | `uuid` | no |
| `policyVersionId` | `string` | `uuid` | no |
| `policyVersion` | `string` | `varchar(20)` — denormalised snapshot so the record reads on its own | no |
| `grantedAt` | `Date` | `timestamptz` | no |
| `ip` | `string` | `inet` | no |
| `userAgent` | `string` | `varchar(512)` | no |
| `locale` | `Locale` | `enum` — which translation she actually read | no |

Relations: `userId → users.id` `CASCADE`; `policyVersionId → policy_versions.id` `RESTRICT`.
Indexes: `IDX_consents_userId_createdAt ("userId","createdAt")`. No unique index — re-consent appends.
Consent is current when a row exists for the user with `policyVersionId` = the current policy;
otherwise `CONSENT_REQUIRED` (none at all) or `CONSENT_STALE` (an older version) (C-12).

### 4.12 `categories` — module `categories`, table `categories`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `name` | `string` | `varchar(80)` | no |
| `nameUr` | `string \| null` | `varchar(80)` | yes |
| `slug` | `string` | `varchar(96)` | no |
| `parentId` | `string \| null` | `uuid` — one level only (A-5) | yes |
| `coverImageKey` | `string \| null` | `varchar(512)` | yes |
| `position` | `number` | `int`, default `0` — drives the browse order (A-6) | no |
| `archived` | `boolean` | `boolean`, default `false` | no |
| `archivedAt` | `Date \| null` | `timestamptz` | yes |
| `publishedGarmentCount` | `number` | `int`, default `0` — denormalised, maintained on publish state change; the A-7 delete guard reads it | no |

Relations: `parentId → categories.id` `ManyToOne`, `RESTRICT`.
Indexes: `UQ_categories_slug UNIQUE ("slug") WHERE "deletedAt" IS NULL` ·
`IDX_categories_parentId_position ("parentId","position")` · `IDX_categories_archived`.
Depth is enforced in the service: a category whose `parentId` is set may not itself be a parent
(`CATEGORY_DEPTH_EXCEEDED`).

### 4.13 `garments` — module `garments`, table `garments`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `sku` | `string` | `varchar(64)` | no |
| `title` | `string` | `varchar(160)` | no |
| `titleUr` | `string \| null` | `varchar(160)` | yes |
| `slug` | `string` | `varchar(200)` | no |
| `categoryId` | `string` | `uuid` | no |
| `colors` | `string[]` | `text[]`, default `'{}'` | no |
| `fabric` | `string \| null` | `varchar(80)` | yes |
| `embellishmentWeight` | `EmbellishmentWeight` | `enum` | no |
| `price` | `number` | `decimal(18,2)` + `decimalTransformer` | no |
| `currency` | `string` | `char(3)`, default `'PKR'` | no |
| `mode` | `GarmentMode` | `enum` | no |
| `deposit` | `number \| null` | `decimal(18,2)` — required when `mode = RENTAL` | yes |
| `description` | `string \| null` | `text` | yes |
| `descriptionUr` | `string \| null` | `text` | yes |
| `sizes` | `string[]` | `text[]`, default `'{}'` | no |
| `styleTags` | `string[]` | `text[]`, default `'{}'` — feeds C-17 search | no |
| `publishState` | `PublishState` | `enum`, default `DRAFT` | no |
| `publishedAt` | `Date \| null` | `timestamptz` | yes |
| `qualityScore` | `number \| null` | `int` 0–100 (A-10) | yes |
| `qualityChecks` | `QualityCheckResult[] \| null` | `jsonb` — per-check outcome and remediation string | yes |
| `qualityOverriddenBy` | `string \| null` | `uuid` — A-10 override, audit-logged | yes |
| `qualityOverriddenAt` | `Date \| null` | `timestamptz` | yes |
| `testRenderId` | `string \| null` | `uuid` → `tryon_results` | yes |
| `testRenderState` | `TestRenderState` | `enum`, default `NONE` | no |
| `testRenderApprovedAt` | `Date \| null` | `timestamptz` | yes |
| `approvedBy` | `string \| null` | `uuid` | yes |
| `flaggedForReview` | `boolean` | `boolean`, default `false` — set by `UPSTREAM_NO_GARMENT_DETECTED` | no |
| `tryOnCount` | `number` | `int`, default `0` | no |
| `loveCount` | `number` | `int`, default `0` | no |
| `maybeCount` | `number` | `int`, default `0` | no |
| `rejectCount` | `number` | `int`, default `0` | no |
| `enquiryCount` | `number` | `int`, default `0` | no |
| `failureCount` | `number` | `int`, default `0` | no |
| `lastTriedAt` | `Date \| null` | `timestamptz` — A-15 "zero try-ons in 30 days" | yes |

Relations: `categoryId → categories.id` `RESTRICT`; `testRenderId → tryon_results.id` `SET NULL`;
`approvedBy`, `qualityOverriddenBy` → `users.id` `SET NULL`.
Indexes: `UQ_garments_sku UNIQUE ("sku") WHERE "deletedAt" IS NULL` ·
`UQ_garments_slug UNIQUE ("slug") WHERE "deletedAt" IS NULL` ·
`IDX_garments_publishState_categoryId ("publishState","categoryId")` ·
`IDX_garments_publishState_createdAt ("publishState","createdAt")` ·
`IDX_garments_testRenderState` · `IDX_garments_flaggedForReview WHERE "flaggedForReview" = true` ·
GIN on `colors`, `sizes`, `styleTags` · GIN trigram on `title` for C-17 search.

The counters are denormalised for A-14 sorting, A-15 catalog health and A-37 leaderboard. They are
maintained by `@OnEvent` listeners and reconciled nightly by a retention-module job — analytics
endpoints (A-36…A-39) compute from source tables, never from these counters.

**Publish state machine.** `DRAFT → PUBLISHED`, `PUBLISHED → ARCHIVED`, `ARCHIVED → PUBLISHED`
(re-evaluated), `PUBLISHED → DRAFT` (unpublish). Any other transition is
`INVALID_PUBLISH_TRANSITION` — the state machine is the **only** thing publishing still refuses.

**The publish conditions are advisory.** A try-on source image, `testRenderState = APPROVED` and
`qualityScore ≥ QUALITY_MIN_SCORE` (or an override) are evaluated on every transition into
`PUBLISHED` by `evaluatePublishAdvisories()`, which returns **all** unmet conditions rather than
the first. None of them prevents the publish. Each one is logged at `warn` and written to the
`GARMENT_PUBLISHED` audit row as `metadata.unmetConditions`, which is what makes the decision
attributable afterwards.

`GarmentResponseDto.publishable` now means "meets every recommendation", not "may publish" — the
console shows the list and offers the button regardless.

The consequence, stated plainly: a garment published with no try-on source appears in the consumer
catalog and fails at generation time, because there is no image to send upstream. Nothing in the
API prevents that. See PRD A-10, A-11 and E-10, all three of which were amended for this.

### 4.14 `garment_images` — module `garments`, table `garment_images`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `garmentId` | `string` | `uuid` | no |
| `storageKey` | `string` | `varchar(512)` | no |
| `thumbnailKey` | `string \| null` | `varchar(512)` | yes |
| `isTryOnSource` | `boolean` | `boolean`, default `false` — the file sent upstream as `garment_image` (A-9) | no |
| `hash` | `string` | `char(64)` — sha256; the `garmentSourceHash` half of the cache key | no |
| `width` | `number` | `int` | no |
| `height` | `number` | `int` | no |
| `byteSize` | `number` | `int` | no |
| `mimeType` | `string` | `varchar(64)` | no |
| `position` | `number` | `int`, default `0` — gallery order | no |
| `altText` | `string \| null` | `varchar(255)` — D-20 alt text on catalog images | yes |

Relations: `garmentId → garments.id` `CASCADE`.
Indexes: `IDX_garment_images_garmentId_position ("garmentId","position")` ·
`UQ_garment_images_source UNIQUE ("garmentId") WHERE "isTryOnSource" = true AND "deletedAt" IS NULL`
— exactly one try-on source per garment · `IDX_garment_images_hash ("hash")`.

### 4.15 `reference_models` — module `tryon`, table `reference_models`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `label` | `string` | `varchar(80)` | no |
| `storageKey` | `string` | `varchar(512)` | no |
| `thumbnailKey` | `string \| null` | `varchar(512)` | yes |
| `hash` | `string` | `char(64)` | no |
| `isDefault` | `boolean` | `boolean`, default `false` | no |
| `position` | `number` | `int`, default `0` | no |
| `active` | `boolean` | `boolean`, default `true` | no |

Indexes: `UQ_reference_models_default UNIQUE ("isDefault") WHERE "isDefault" = true AND "deletedAt" IS NULL`.
Seeded by `reference-models.seeder.ts` (E-4). These are the only person images an admin ever sends
upstream; consumer photos are never used for a test render.

### 4.16 `person_photos` — module `person-photos`, table `person_photos`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `userId` | `string` | `uuid` | no |
| `storageKey` | `string` | `varchar(512)` | no |
| `blurredThumbnailKey` | `string \| null` | `varchar(512)` — the **only** derivative an admin can ever see (S-10, A-34) | yes |
| `hash` | `string` | `char(64)` — the `personPhotoHash` half of the cache key | no |
| `isActive` | `boolean` | `boolean`, default `false` (C-16) | no |
| `label` | `string \| null` | `varchar(60)` — user-chosen, e.g. "daylight" | yes |
| `uploadedAt` | `Date` | `timestamptz` | no |
| `purgeAfter` | `Date` | `timestamptz` — `users.lastActiveAt + 30 days`, recomputed by the purge cron (§9.3) | no |
| `moderationState` | `PhotoModerationState` | `enum`, default `PENDING` | no |
| `width` / `height` | `number` | `int` | no |
| `byteSize` | `number` | `int` | no |
| `mimeType` | `string` | `varchar(64)` | no |

Relations: `userId → users.id` `CASCADE`.
Indexes: `UQ_person_photos_active UNIQUE ("userId") WHERE "isActive" = true AND "deletedAt" IS NULL`
· `IDX_person_photos_userId ("userId")` · `IDX_person_photos_purgeAfter ("purgeAfter")` ·
`IDX_person_photos_hash ("hash")`.

**No admin-facing query may ever select `storageKey` from this table.** The consumer-management
repository methods select an explicit column list that excludes it, and an E-7 test asserts the
serialized admin response contains no `person-photos/` key and no signed URL for one (S-10).

### 4.17 `tryon_jobs` — module `tryon`, table `tryon_jobs`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `userId` | `string` | `uuid` — the consumer, or the admin who ran the test render | no |
| `garmentId` | `string \| null` | `uuid` | yes |
| `personPhotoId` | `string \| null` | `uuid` | yes |
| `referenceModelId` | `string \| null` | `uuid` — set instead of `personPhotoId` for a test render | yes |
| `origin` | `JobOrigin` | `enum` | no |
| `isTestRender` | `boolean` | `boolean`, default `false` — kept per PRD §12; always equals `origin = TEST_RENDER` | no |
| `idempotencyKey` | `string` | `varchar(80)` — client-supplied (§8.1 step 1) | no |
| `status` | `JobStatus` | `enum`, default `QUEUED` | no |
| `cacheHit` | `boolean` | `boolean`, default `false` | no |
| `cacheKey` | `string \| null` | `char(64)` | yes |
| `errorCode` | `string \| null` | `varchar(64)` — an `ErrorCode` value | yes |
| `attempts` | `number` | `int`, default `0` — max 3 (§8.3) | no |
| `batchId` | `string \| null` | `uuid` — A-12 bulk test renders | yes |
| `startedAt` | `Date \| null` | `timestamptz` | yes |
| `finishedAt` | `Date \| null` | `timestamptz` | yes |
| `durationMs` | `number \| null` | `int` — feeds `tryon.latency_ms` (E-13) | yes |

Relations: `userId → users.id` `CASCADE` · `garmentId → garments.id` `SET NULL` ·
`personPhotoId → person_photos.id` `SET NULL` · `referenceModelId → reference_models.id` `SET NULL`.
Indexes: `UQ_tryon_jobs_idem UNIQUE ("userId","idempotencyKey") WHERE "deletedAt" IS NULL` ·
`IDX_tryon_jobs_userId_status ("userId","status")` · `IDX_tryon_jobs_status_createdAt` ·
`IDX_tryon_jobs_batchId` · `IDX_tryon_jobs_garmentId`.

The unique index is the idempotency mechanism: a duplicate insert raises a unique violation, which
the service converts to `IDEMPOTENCY_IN_FLIGHT` when the existing job is `QUEUED`/`RUNNING`, or
returns the completed result when it is `SUCCEEDED`. Jobs are prunable after 90 days — which is
exactly why `tryon_results` carries its own denormalised columns.

### 4.18 `tryon_results` — module `results`, table `tryon_results`

**The critical table. C-24 through C-31 all rest on it. Read this section twice.**

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `jobId` | `string \| null` | `uuid` | **yes** |
| `userId` | `string \| null` | `uuid` | **yes** |
| `garmentId` | `string \| null` | `uuid` | **yes** |
| `personPhotoId` | `string \| null` | `uuid` | **yes** |
| `storageKey` | `string` | `varchar(512)` — the unwatermarked render, `renders/<userId>/<uuid>.png` | no |
| `thumbnailKey` | `string \| null` | `varchar(512)` | yes |
| `cacheKey` | `string` | `char(64)` | no |
| `garmentTitleSnapshot` | `string` | `varchar(160)` | no |
| `garmentCategorySnapshot` | `string` | `varchar(80)` | no |
| `garmentPriceSnapshot` | `number \| null` | `decimal(18,2)` + transformer | yes |
| `garmentCurrencySnapshot` | `string` | `char(3)`, default `'PKR'` | no |
| `personPhotoLabelSnapshot` | `string \| null` | `varchar(60)` — lets C-30 grouping survive photo deletion | yes |
| `isTestRender` | `boolean` | `boolean`, default `false` | no |
| `width` / `height` | `number` | `int` | no |
| `byteSize` | `number` | `int` | no |
| `marketingOptInAt` | `Date \| null` | `timestamptz` — §9.3 per-render explicit opt-in for brand marketing | yes |

Relations — **all four are nullable with `ON DELETE SET NULL`** (PRD §12 note, C-28, C-29):

```typescript
@ManyToOne(() => TryOnJob,      { onDelete: 'SET NULL', nullable: true })  @JoinColumn({ name: 'jobId' })
@ManyToOne(() => User,          { onDelete: 'SET NULL', nullable: true })  @JoinColumn({ name: 'userId' })
@ManyToOne(() => Garment,       { onDelete: 'SET NULL', nullable: true })  @JoinColumn({ name: 'garmentId' })
@ManyToOne(() => PersonPhoto,   { onDelete: 'SET NULL', nullable: true })  @JoinColumn({ name: 'personPhotoId' })
```

Indexes: `IDX_tryon_results_userId_createdAt ("userId","createdAt")` — the history list (C-25) ·
`IDX_tryon_results_userId_garmentId` · `IDX_tryon_results_personPhotoId` — C-30 grouping ·
`IDX_tryon_results_cacheKey` · `IDX_tryon_results_jobId`.

Why every column above is shaped the way it is:

- **`personPhotoId` SET NULL + `personPhotoLabelSnapshot`** — C-28: a render survives deletion or
  replacement of the photo it came from. Deleting a photo nulls the reference; the render and its
  history entry are untouched. Grouping by photo still works, falling back to the label snapshot.
- **`garmentId` SET NULL + `garmentTitleSnapshot`/`garmentCategorySnapshot`/`garmentPriceSnapshot`**
  — C-29: a render stays in history when the garment is unpublished, archived or removed. Garments
  are soft-deleted, so the FK usually survives; the snapshots make history correct even after a hard
  delete. **The history list renders exclusively from the snapshots** — it does not join `garments`.
  It joins only to decide whether to show the "Try it on" action, and hides it with a
  "no longer available" label when the garment is missing, archived or unpublished (C-29).
- **`jobId` SET NULL** — jobs are pruned after 90 days; history is permanent (C-27).
- **`userId` SET NULL** — the column exists so ownership is a single predicate. On account deletion
  the rows are **hard-deleted along with their files**, not orphaned; `SET NULL` is the safety net
  that keeps a foreign-key error from ever blocking a deletion.
- **`deletedAt`** (from `BaseEntity`) is how C-31 individual deletion works: soft-delete the row,
  hard-delete the file and thumbnail immediately, write a `deletion_log` row. The confirmation copy
  says the deletion is permanent, and it is — the image is gone.
- **Renders carry no expiry.** There is no `purgeAfter` on this table, deliberately (C-27, §9.3).

Verdicts are **not** stored here. They live on `shortlist_items`, keyed by `(userId, garmentId)`, and
the history DTO joins them in. One verdict per garment, one source of truth (§4.20).

### 4.19 `tryon_cache` — module `tryon`, table `tryon_cache`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `cacheKey` | `string` | `char(64)` | no |
| `garmentSourceHash` | `string` | `char(64)` | no |
| `personPhotoHash` | `string` | `char(64)` | no |
| `apiVersion` | `string` | `varchar(32)` | no |
| `garmentId` | `string \| null` | `uuid` | yes |
| `storageKey` | `string` | `varchar(512)` — canonical render, copied per user on a hit (§3.7) | no |
| `width` / `height` | `number` | `int` | no |
| `hitCount` | `number` | `int`, default `0` | no |
| `lastHitAt` | `Date \| null` | `timestamptz` | yes |

Relations: `garmentId → garments.id` `SET NULL`.
Indexes: `UQ_tryon_cache_cacheKey UNIQUE ("cacheKey") WHERE "deletedAt" IS NULL` ·
`IDX_tryon_cache_personPhotoHash` — used to retire entries on photo replacement (C-16) ·
`IDX_tryon_cache_garmentId`.

### 4.20 `shortlist_items` — module `shortlist`, table `shortlist_items`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `userId` | `string` | `uuid` | no |
| `garmentId` | `string` | `uuid` | no |
| `verdict` | `Verdict` | `enum` | no |
| `rank` | `number \| null` | `int` — drag-to-rank (C-32); null for `NOT_FOR_ME` | yes |
| `rejectReason` | `RejectReason \| null` | `enum` — C-21 | yes |
| `note` | `string \| null` | `text` — per-item note (C-32) | yes |
| `latestResultId` | `string \| null` | `uuid` — the render shown beside the item | yes |
| `verdictAt` | `Date` | `timestamptz` | no |

Relations: `userId → users.id` `CASCADE` · `garmentId → garments.id` `CASCADE` ·
`latestResultId → tryon_results.id` `SET NULL`.
Indexes: `UQ_shortlist_items_user_garment UNIQUE ("userId","garmentId") WHERE "deletedAt" IS NULL` ·
`IDX_shortlist_items_userId_rank ("userId","rank")` · `IDX_shortlist_items_garmentId_verdict`.

**Verdict semantics — pinned, because it is otherwise ambiguous.** Every verdict from the result view
(C-20) upserts one row keyed `(userId, garmentId)`.
- The **Shortlist** screen shows `LOVE_IT` and `MAYBE`, ordered by `rank`.
- `NOT_FOR_ME` rows are retained for A-38 rejection-reason analytics; they never appear on the
  shortlist, never count toward the budget total, and are excluded from enquiries.
- Changing a verdict updates the same row. There is no second verdict column anywhere.

### 4.21 `share_links` — module `share`, table `share_links`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `userId` | `string` | `uuid` | no |
| `tokenHash` | `string` | `char(64)` | no |
| `label` | `string \| null` | `varchar(60)` — "Ammi", "Sisters" | yes |
| `expiresAt` | `Date` | `timestamptz` — created at `now + 30 days` (C-34) | no |
| `revokedAt` | `Date \| null` | `timestamptz` (C-34) | yes |
| `viewCount` | `number` | `int`, default `0` | no |
| `lastViewedAt` | `Date \| null` | `timestamptz` | yes |

Relations: `userId → users.id` `CASCADE`.
Indexes: `UQ_share_links_tokenHash UNIQUE ("tokenHash") WHERE "deletedAt" IS NULL` ·
`IDX_share_links_userId` · `IDX_share_links_expiresAt`.

A share view resolves the owner's **live** shortlist (`LOVE_IT` + `MAYBE`, by rank) and returns only
`{ garment title, category, price if public, render url }` per item. It never returns her photo, her
other renders, her name, her contact details, her notes, or any other consumer's data (C-33). There
is no snapshot table — revoking the link is the control.

### 4.22 `votes` — module `share`, table `votes`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `shareLinkId` | `string` | `uuid` | no |
| `garmentId` | `string` | `uuid` | no |
| `voterLabel` | `string` | `varchar(60)` — the name the visitor typed; no account required (C-33) | no |
| `voterFingerprint` | `string` | `char(64)` — sha256 of a first-party cookie value; prevents trivial double voting | no |
| `reaction` | `Reaction` | `enum` | no |
| `comment` | `string \| null` | `text` — one per item (C-33) | yes |

Relations: `shareLinkId → share_links.id` `CASCADE` · `garmentId → garments.id` `CASCADE`.
Indexes:
`UQ_votes_link_voter_garment UNIQUE ("shareLinkId","voterFingerprint","garmentId") WHERE "deletedAt" IS NULL`
· `IDX_votes_shareLinkId`.
A second comment on the same item by the same visitor is `VOTE_ALREADY_CAST`; changing the reaction
updates the row.

### 4.23 `enquiries` — module `enquiries`, table `enquiries`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `reference` | `string` | `varchar(20)` — `ENQ-2026-000137`, shown to both sides | no |
| `userId` | `string` | `uuid` | no |
| `message` | `string` | `text` | no |
| `status` | `EnquiryStatus` | `enum`, default `NEW` | no |
| `lostReason` | `string \| null` | `text` — required on `CLOSED_LOST` (A-22) | yes |
| `eventDate` | `Date \| null` | `date` | yes |
| `eventType` | `EventType \| null` | `enum` | yes |
| `budgetBand` | `BudgetBand \| null` | `enum` | yes |
| `contactName` | `string` | `varchar(120)` — snapshot at submission (A-21) | no |
| `contactEmail` | `string` | `varchar(320)` — verified address | no |
| `contactPhone` | `string` | `varchar(24)` — verified, C-3 gate | no |
| `firstRespondedAt` | `Date \| null` | `timestamptz` — A-25 24-hour stale highlight | yes |
| `closedAt` | `Date \| null` | `timestamptz` | yes |
| `assignedTo` | `string \| null` | `uuid` | yes |
| `totalValueSnapshot` | `number \| null` | `decimal(18,2)` — sum of item prices at submission | yes |

Relations: `userId → users.id` `CASCADE` · `assignedTo → users.id` `SET NULL`.
Indexes: `UQ_enquiries_reference UNIQUE ("reference") WHERE "deletedAt" IS NULL` ·
`IDX_enquiries_status_createdAt` · `IDX_enquiries_userId_createdAt` ·
`IDX_enquiries_firstRespondedAt WHERE "firstRespondedAt" IS NULL`.
Transitions: `NEW → CONTACTED → IN_DISCUSSION → CLOSED_WON | CLOSED_LOST`; `NEW → CLOSED_LOST` is
allowed. Anything else is `INVALID_ENQUIRY_TRANSITION`.

### 4.24 `enquiry_items` — module `enquiries`, table `enquiry_items`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `enquiryId` | `string` | `uuid` | no |
| `garmentId` | `string \| null` | `uuid` | yes |
| `resultId` | `string \| null` | `uuid` — the render the admin is allowed to see (S-10) | yes |
| `rank` | `number` | `int` — her order at submission time | no |
| `note` | `string \| null` | `text` | yes |
| `garmentTitleSnapshot` | `string` | `varchar(160)` | no |
| `garmentSkuSnapshot` | `string` | `varchar(64)` | no |
| `garmentPriceSnapshot` | `number \| null` | `decimal(18,2)` | yes |

Relations: `enquiryId → enquiries.id` `CASCADE` · `garmentId → garments.id` `SET NULL` ·
`resultId → tryon_results.id` `SET NULL`.
Indexes: `UQ_enquiry_items_enquiry_rank UNIQUE ("enquiryId","rank") WHERE "deletedAt" IS NULL` ·
`IDX_enquiry_items_garmentId`.

**This table is the sole basis on which an admin may view a render** (S-10). The admin renders query
joins `enquiry_items → tryon_results`; there is no other path from an admin route to a
`renders/**` signed URL, and an E-7 test asserts it.

### 4.25 `enquiry_notes` — module `enquiries`, table `enquiry_notes` · **append-only**

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `enquiryId` | `string` | `uuid` | no |
| `authorId` | `string \| null` | `uuid` | yes |
| `body` | `string` | `text` | no |

Relations: `enquiryId → enquiries.id` `CASCADE` · `authorId → users.id` `SET NULL`.
Indexes: `IDX_enquiry_notes_enquiryId_createdAt`. Admin-only, never returned on a consumer route
(A-24) — enforced by a separate response DTO, not by a flag.

### 4.26 `quota_ledger` — module `quota`, table `quota_ledger` · **append-only**

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `userId` | `string` | `uuid` | no |
| `delta` | `number` | `int` — positive grants, negative consumption | no |
| `reason` | `QuotaReason` | `enum` | no |
| `period` | `string` | `char(7)` — `YYYY-MM` in `Asia/Karachi` | no |
| `jobId` | `string \| null` | `uuid` | yes |
| `actorId` | `string \| null` | `uuid` — the admin, for `ADMIN_ADJUSTMENT` | yes |
| `note` | `string \| null` | `varchar(255)` | yes |

Relations: `userId → users.id` `CASCADE` · `jobId → tryon_jobs.id` `SET NULL` ·
`actorId → users.id` `SET NULL`.
Indexes: `IDX_quota_ledger_userId_period ("userId","period")` ·
`UQ_quota_ledger_job UNIQUE ("jobId") WHERE "jobId" IS NOT NULL` — **no `deletedAt` predicate: this
table is append-only.** This index is what makes a double consumption physically impossible.

```sql
-- remaining quota for a consumer, this period. There is no stored balance.
SELECT COALESCE(SUM(delta), 0) FROM quota_ledger WHERE "userId" = $1 AND period = $2;
```

The monthly grant is lazy: the first quota read in a new period inserts a `MONTHLY_GRANT` row of
`consumer_profiles.monthlyQuotaOverride ?? settings['quota.defaultMonthly']` (default 15, A-28/C-5)
inside a transaction guarded by the same period. Raising an override mid-period appends an
`OVERRIDE_GRANT` for the difference — it never rewrites the earlier row.

### 4.27 `usage_ledger` — module `quota`, table `usage_ledger` · **append-only**

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `delta` | `number` | `int` | no |
| `reason` | `UsageReason` | `enum` | no |
| `period` | `string` | `char(7)` | no |
| `jobId` | `string \| null` | `uuid` | yes |
| `userId` | `string \| null` | `uuid` — who caused it, for the A-33 split | yes |
| `balanceAfter` | `number` | `int` — **advisory snapshot only** | no |
| `actorId` | `string \| null` | `uuid` | yes |
| `note` | `string \| null` | `varchar(255)` | yes |

Relations: `jobId → tryon_jobs.id` `SET NULL` · `userId`, `actorId → users.id` `SET NULL`.
Indexes: `IDX_usage_ledger_period_createdAt ("period","createdAt")` ·
`UQ_usage_ledger_job UNIQUE ("jobId") WHERE "jobId" IS NOT NULL` — no `deletedAt` predicate.

`balanceAfter` exists because PRD §12 lists it. **It is a convenience snapshot for the A-33 burn-rate
chart and is never the authority.** The authoritative remaining budget is always
`SELECT SUM(delta) FROM usage_ledger WHERE period = $1`. Any code that reads `balanceAfter` to make a
decision is a bug. The soft warning fires at 80 % consumed and the hard stop at 100 % (A-29); on hard
stop the catalog stays browsable and `BUDGET_EXHAUSTED` is returned only from the generation path.

Consumer try-ons (`CONSUMER_GENERATION`) and admin test renders (`TEST_RENDER`) are separate reasons
so A-33 can split them. Cache hits write **no** ledger row in either table (C-22, §8.4).

### 4.28 `settings` — module `settings`, table `settings`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `key` | `string` | `varchar(80)` | no |
| `value` | `unknown` | `jsonb` | no |
| `valueType` | `SettingsValueType` | `enum` | no |
| `description` | `string` | `varchar(255)` | no |
| `isPublic` | `boolean` | `boolean`, default `false` — exposed by `GET /settings/brand` | no |
| `updatedBy` | `string \| null` | `uuid` | yes |

Relations: `updatedBy → users.id` `SET NULL`.
Indexes: `UQ_settings_key UNIQUE ("key") WHERE "deletedAt" IS NULL`.

The key registry lives in `shared/constants/settings-keys.constant.ts` and is closed — an unknown key
is `SETTINGS_KEY_UNKNOWN`, and each key declares a Zod-equivalent `class-validator` schema.

| Key | Type | Default | Requirement |
| --- | --- | --- | --- |
| `brand.name` | STRING | `Drape` | A-27 |
| `brand.logoKey` | STRING | `null` | A-27 |
| `brand.primaryColor` | STRING | `#71202F` | A-27, contrast-validated on save (D-20) |
| `brand.whatsappNumber` | STRING | — | A-23, A-27 |
| `brand.instagramHandle` | STRING | — | A-27 |
| `brand.contactEmail` | STRING | — | A-27 |
| `brand.storeAddresses` | JSON | `[]` | A-27 |
| `quota.defaultMonthly` | NUMBER | `15` | A-28, C-5 |
| `quota.requireEmailVerification` | BOOLEAN | `true` | A-28, C-3 |
| `budget.monthlyGenerations` | NUMBER | `2000` | A-29 |
| `budget.warnThresholdPercent` | NUMBER | `80` | A-29 |
| `catalog.showPricesPublicly` | BOOLEAN | `true` | A-30 |
| `sharing.enabled` | BOOLEAN | `true` | A-30 |
| `enquiries.enabled` | BOOLEAN | `true` | A-30 |
| `photos.maxPerConsumer` | NUMBER | `5` | C-16 |
| `quality.minScore` | NUMBER | `70` | A-10 |
| `shortLink.slug` | STRING | `drape` | A-32 |

### 4.29 `moderation_items` — module `moderation`, table `moderation_items`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `personPhotoId` | `string \| null` | `uuid` | yes |
| `userId` | `string \| null` | `uuid` | yes |
| `jobId` | `string \| null` | `uuid` | yes |
| `source` | `ModerationSource` | `enum` | no |
| `reasonCode` | `string` | `varchar(64)` — upstream code or internal heuristic id | no |
| `state` | `ModerationState` | `enum`, default `PENDING` | no |
| `blurredThumbnailKey` | `string \| null` | `varchar(512)` — the only image an admin may open (A-34) | yes |
| `reviewedBy` | `string \| null` | `uuid` | yes |
| `reviewedAt` | `Date \| null` | `timestamptz` | yes |
| `decisionNote` | `string \| null` | `text` | yes |

Relations: `personPhotoId → person_photos.id` `SET NULL` · `userId → users.id` `SET NULL` ·
`jobId → tryon_jobs.id` `SET NULL` · `reviewedBy → users.id` `SET NULL`.
Indexes: `IDX_moderation_items_state_createdAt` · `IDX_moderation_items_userId` ·
`UQ_moderation_items_photo_pending UNIQUE ("personPhotoId") WHERE "state" = 'PENDING' AND "deletedAt" IS NULL`.

Every read of the list **and** every read of a blurred thumbnail writes `MODERATION_ITEM_VIEWED` to
`audit_log` (A-34, §9.3).

### 4.30 `audit_log` — module `audit`, table `audit_log` · **append-only**

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `actorId` | `string \| null` | `uuid` — null for system actions | yes |
| `actorRole` | `Role \| null` | `enum` | yes |
| `action` | `string` | `varchar(80)` — from the closed `AuditAction` registry | no |
| `targetType` | `string` | `varchar(60)` — `GARMENT`, `CATEGORY`, `USER`, `SETTING`, `MODERATION_ITEM`, … | no |
| `targetId` | `string \| null` | `uuid` | yes |
| `targetLabel` | `string \| null` | `varchar(160)` — human-readable snapshot so the log reads after deletion | yes |
| `metadata` | `Record<string, unknown>` | `jsonb`, default `'{}'` — before/after diffs, redacted | no |
| `ip` | `string \| null` | `inet` | yes |
| `userAgent` | `string \| null` | `varchar(512)` | yes |
| `requestId` | `string \| null` | `uuid` | yes |

Relations: `actorId → users.id` `SET NULL`.
Indexes: `IDX_audit_log_actorId_createdAt` · `IDX_audit_log_action_createdAt` ·
`IDX_audit_log_target ("targetType","targetId")`. Filterable by actor, action and date (A-3).
Covered actions (A-3): catalog changes, publishes, deletions, role changes, quota changes, consumer
suspensions, moderation-queue views, settings changes — plus `SIGNUP_ROLE_IGNORED` (S-4) and every
quality override (A-10). `metadata` passes through `redact.util.ts`; photo keys and personal data
never reach it (E-12).

### 4.31 `deletion_log` — module `retention`, table `deletion_log` · **append-only**

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `subjectType` | `DeletionSubject` | `enum` | no |
| `subjectId` | `string` | `uuid` — retained after the row itself is gone | no |
| `userId` | `string \| null` | `uuid` | yes |
| `initiatedBy` | `DeletionInitiator` | `enum` | no |
| `actorId` | `string \| null` | `uuid` | yes |
| `requestedAt` | `Date` | `timestamptz` | no |
| `completedAt` | `Date \| null` | `timestamptz` — must be within 24 h of `requestedAt` (C-38, A-20) | yes |
| `rowsDeleted` | `Record<string, number>` | `jsonb` — `{ "tryon_results": 42, "person_photos": 3 }` | no |
| `storageKeysDeleted` | `number` | `int` | no |
| `bytesReclaimed` | `string` | `bigint` | no |
| `verificationHash` | `string` | `char(64)` — sha256 of the sorted deleted-key list; the "verifiable" in §9.3 | no |
| `failureReason` | `string \| null` | `text` | yes |

Relations: `userId`, `actorId → users.id` `SET NULL`.
Indexes: `IDX_deletion_log_subject ("subjectType","subjectId")` ·
`IDX_deletion_log_completedAt WHERE "completedAt" IS NULL` — the alert query for E-14 purge failure.

### 4.32 `notifications_outbox` — module `notifications`, table `notifications_outbox`

| Column | TS | TypeORM | Null |
| --- | --- | --- | :-: |
| `channel` | `NotificationChannel` | `enum` | no |
| `template` | `string` | `varchar(80)` — closed registry, e.g. `RESULT_READY`, `ENQUIRY_RECEIVED`, `BUDGET_BACK` | no |
| `locale` | `Locale` | `enum` | no |
| `recipientUserId` | `string \| null` | `uuid` | yes |
| `recipientAddress` | `string \| null` | `varchar(320)` — email or E.164; null for `IN_APP` | yes |
| `payload` | `Record<string, unknown>` | `jsonb` — template variables only, never a photo key | no |
| `status` | `NotificationStatus` | `enum`, default `PENDING` | no |
| `attempts` | `number` | `int`, default `0` | no |
| `availableAt` | `Date` | `timestamptz` — backoff schedule | no |
| `sentAt` | `Date \| null` | `timestamptz` | yes |
| `readAt` | `Date \| null` | `timestamptz` — `IN_APP` only | yes |
| `lastError` | `string \| null` | `varchar(512)` | yes |
| `dedupeKey` | `string \| null` | `varchar(160)` | yes |

Relations: `recipientUserId → users.id` `CASCADE`.
Indexes: `IDX_notifications_outbox_status_availableAt WHERE "status" = 'PENDING'` ·
`IDX_notifications_outbox_recipient_read ("recipientUserId","readAt")` ·
`UQ_notifications_outbox_dedupe UNIQUE ("dedupeKey") WHERE "dedupeKey" IS NOT NULL AND "deletedAt" IS NULL`.

Written inside the same transaction as the business change (transactional outbox), drained every 10
seconds by `notifications/processors/outbox.processor.ts` with exponential backoff and a cap of 5
attempts. `channel = IN_APP` rows are the in-app notification store — there is no second table.

### 4.33 Entity → module ownership map

| Module | Entities |
| --- | --- |
| `auth` | `sessions`, `verification_tokens`, `auth_attempts` |
| `users` | `users`, `consumer_profiles` |
| `invites` | `invites` |
| `consents` | `policy_versions`, `consents` |
| `categories` | `categories` |
| `garments` | `garments`, `garment_images` |
| `person-photos` | `person_photos` |
| `tryon` | `tryon_jobs`, `tryon_cache`, `reference_models` |
| `results` | `tryon_results` |
| `shortlist` | `shortlist_items` |
| `share` | `share_links`, `votes` |
| `enquiries` | `enquiries`, `enquiry_items`, `enquiry_notes` |
| `quota` | `quota_ledger`, `usage_ledger` |
| `settings` | `settings` |
| `moderation` | `moderation_items`, `ip_blocks` |
| `audit` | `audit_log` |
| `notifications` | `notifications_outbox` |
| `retention` | `deletion_log` |
| `catalog`, `analytics`, `files`, `health` | none — read-only or infrastructure |

---

## 5. API surface

Base path `/api/v1`. Versioned via `app.setGlobalPrefix('api')` +
`app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })`.

**This table is the single source of truth for both the NestJS route table and the
`@repo/api-client` endpoint map.** CI compares the exported OpenAPI document against the generated
client and fails on any undeclared change (B-4).

Role column:

| Value | `@Roles(...)` | Meaning |
| --- | --- | --- |
| `PUBLIC` | `@Roles(Role.PUBLIC)` + `@Public()` + explicit `@Throttle()` | No session needed. |
| `ANY` | `@Roles(Role.ADMIN, Role.CONSUMER)` | Any authenticated user. |
| `CONSUMER` | `@Roles(Role.CONSUMER)` | Consumer session only. |
| `ADMIN` | `@Roles(Role.ADMIN)` | Admin session only. Every one of these carries an authorisation test (S-11, E-7). |

Every mutating verb (`POST`/`PATCH`/`PUT`/`DELETE`) requires the CSRF header unless marked ⊘.

### 5.1 `auth`

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/auth/csrf` | PUBLIC | Issue the `drape.csrf` cookie and return the matching token. |
| POST | `/auth/signup` ⊘ | PUBLIC | Create a **Consumer** account. A `role` in the payload is stripped and audit-logged (S-4). |
| POST | `/auth/login` ⊘ | PUBLIC | Authenticate. Sets `drape.sid`. Returns `{ user, twofaRequired }`. Generic failure copy (S-6). |
| POST | `/auth/2fa/challenge` | PUBLIC | Complete a `twofaPending` session with a TOTP code. |
| POST | `/auth/logout` | ANY | Revoke the current session and clear cookies. |
| GET | `/auth/me` | ANY | The single role-resolution call used by the web middleware (B-10). |
| GET | `/auth/sessions` | ANY | List the caller's active sessions. |
| DELETE | `/auth/sessions/:sessionId` | ANY | Revoke one of the caller's sessions. |
| DELETE | `/auth/sessions` | ANY | Revoke all other sessions. |
| POST | `/auth/password/forgot` | PUBLIC | Send a reset link. Always 200, always the same body (S-6). |
| POST | `/auth/password/reset` | PUBLIC | Consume a reset token, set a new password, revoke all sessions. |
| POST | `/auth/password/change` | ANY | Change password with the current one; revokes other sessions. |
| POST | `/auth/email/verify/request` | ANY | Re-send the verification email. |
| POST | `/auth/email/verify/confirm` | PUBLIC | Consume an email-verification token. |
| POST | `/auth/phone/otp/request` | CONSUMER | Send a phone OTP (C-3). |
| POST | `/auth/phone/otp/verify` | CONSUMER | Verify the OTP and stamp `phoneVerifiedAt`. |
| POST | `/auth/2fa/setup` | ANY | Return a TOTP secret and provisioning URI. |
| POST | `/auth/2fa/enable` | ANY | Confirm a code, enable 2FA, return recovery codes once. |
| POST | `/auth/2fa/disable` | ANY | Disable 2FA. Rejected for admins (S-8). |
| POST | `/auth/2fa/recovery` | PUBLIC | Complete a `twofaPending` session with a recovery code. |

### 5.2 `users` — admins, consumers, self

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/admin/users` | ADMIN | List admin accounts (A-2). |
| GET | `/admin/users/:userId` | ADMIN | One admin account. |
| PATCH | `/admin/users/:userId/role` | ADMIN | Change role. Rejects self-change and the last active admin. |
| POST | `/admin/users/:userId/deactivate` | ADMIN | Deactivate; revokes live sessions immediately (A-2). |
| POST | `/admin/users/:userId/reactivate` | ADMIN | Reactivate a deactivated admin. |
| GET | `/admin/consumers` | ADMIN | Consumer list: name, email, phone, signup, last active, generations this month, shortlist size, enquiry count, status (A-16). |
| GET | `/admin/consumers/:userId` | ADMIN | Consumer detail. **Never includes her photo** (A-17, S-10). |
| GET | `/admin/consumers/:userId/renders` | ADMIN | Renders attached to her enquiries only, via `enquiry_items` (A-17, S-10). |
| GET | `/admin/consumers/:userId/shortlist` | ADMIN | Her shortlisted garments (A-17). |
| PATCH | `/admin/consumers/:userId/quota` | ADMIN | Set or clear `monthlyQuotaOverride` (A-18). |
| POST | `/admin/consumers/:userId/suspend` | ADMIN | Suspend with a required reason; revokes sessions (A-19). |
| POST | `/admin/consumers/:userId/unsuspend` | ADMIN | Lift a suspension. |
| DELETE | `/admin/consumers/:userId` | ADMIN | Delete the consumer and all data. Requires typing the name (D-17). Completes in 24 h with a `deletion_log` record (A-20). |
| GET | `/me` | ANY | The caller's own profile. |
| PATCH | `/me` | ANY | Update name, phone, locale (C-7). |
| GET | `/me/profile` | CONSUMER | Consumer profile: event date, type, budget band, preferred categories (C-2). |
| PATCH | `/me/profile` | CONSUMER | Update those fields. |
| GET | `/me/notification-preferences` | ANY | Read preferences (C-7). |
| PATCH | `/me/notification-preferences` | ANY | Update preferences. |
| GET | `/me/data` | CONSUMER | Everything stored about her: profile, photos, renders, shortlists, enquiries, consent with its date (C-37). |
| POST | `/me/export` | CONSUMER | Start a data export archive (C-39). |
| GET | `/me/export/:exportId` | CONSUMER | Export status, and the signed download URL when ready. |
| DELETE | `/me` | CONSUMER | Delete her account and all data. Immediate from her view, backend within 24 h (C-38). |
| GET | `/me/notifications` | ANY | In-app notifications (`channel = IN_APP`). |
| POST | `/me/notifications/:notificationId/read` | ANY | Mark one read. |
| POST | `/me/notifications/read-all` | ANY | Mark all read. |

### 5.3 `invites`

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/invites` | ADMIN | List pending and consumed invites. |
| POST | `/invites` | ADMIN | Invite an admin by email; sends a single-use token (S-5, A-2). |
| POST | `/invites/:inviteId/resend` | ADMIN | Re-issue the token and reset the expiry. |
| DELETE | `/invites/:inviteId` | ADMIN | Revoke a pending invite. |
| GET | `/invites/token/:token` | PUBLIC | Validate a token and return `{ email, role, expiresAt }` for the acceptance form. |
| POST | `/invites/token/:token/accept` | PUBLIC | Create the admin account from the invite. 2FA setup is forced immediately after (S-8). |

### 5.4 `settings`

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/settings/brand` | PUBLIC | Public brand config the web app themes from: name, logo url, primary colour, WhatsApp, Instagram, contact email, addresses, and the `showPricesPublicly` / `sharing.enabled` / `enquiries.enabled` toggles. |
| GET | `/settings` | ADMIN | Full settings map (A-27…A-30). |
| PATCH | `/settings` | ADMIN | Update one or more keys; validated against the key registry; audit-logged. |
| POST | `/settings/brand/logo` | ADMIN | Finalise a brand-asset upload and set `brand.logoKey`. |
| GET | `/settings/qr` | ADMIN | PNG QR code for in-store signage (A-32). |
| GET | `/settings/short-link` | ADMIN | The copyable Instagram-bio short link (A-32). |
| GET | `/settings/policy` | ADMIN | The current policy version and body. |
| POST | `/settings/policy` | ADMIN | Publish a new policy version. Triggers re-consent for everyone (C-12). |

### 5.5 `categories`

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/categories` | PUBLIC | The published, non-archived category tree in `position` order (A-6). |
| GET | `/admin/categories` | ADMIN | Full tree including archived, with garment counts. |
| POST | `/admin/categories` | ADMIN | Create a category or one-level sub-category (A-4, A-5). |
| PATCH | `/admin/categories/:categoryId` | ADMIN | Rename, re-parent, set cover image. |
| POST | `/admin/categories/reorder` | ADMIN | Persist a new sort order for a sibling set (A-4). |
| POST | `/admin/categories/:categoryId/archive` | ADMIN | Archive. |
| POST | `/admin/categories/:categoryId/restore` | ADMIN | Un-archive. |
| DELETE | `/admin/categories/:categoryId` | ADMIN | Delete. Blocked while it holds published garments (A-7). |

### 5.6 `garments` (admin)

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/admin/garments` | ADMIN | Catalog list with search, category filter, publish-state filter, sort by newest / most tried / highest star rate (A-14). |
| GET | `/admin/garments/:garmentId` | ADMIN | Full garment including images, quality report and test render. |
| POST | `/admin/garments` | ADMIN | Create a garment (A-8). |
| PATCH | `/admin/garments/:garmentId` | ADMIN | Update garment fields. |
| DELETE | `/admin/garments/:garmentId` | ADMIN | Delete. Requires typing the title (D-17). |
| POST | `/admin/garments/:garmentId/publish` | ADMIN | Publish. Enforces the A-11 test-render gate and the A-10 quality gate. |
| POST | `/admin/garments/:garmentId/unpublish` | ADMIN | Back to draft. |
| POST | `/admin/garments/:garmentId/archive` | ADMIN | Archive; analytics history retained (A-13). |
| POST | `/admin/garments/:garmentId/quality-override` | ADMIN | Override a low quality score with a required reason; audit-logged (A-10). |
| POST | `/admin/garments/bulk` | ADMIN | Bulk publish / unpublish / re-categorise / archive. Returns per-item results (A-12, D-16). |
| POST | `/admin/garments/bulk/estimate` | ADMIN | Cost estimate for a bulk test-render selection, shown before confirming (A-12). |
| GET | `/admin/catalog-health` | ADMIN | Garments missing an approved test render, low quality scores, elevated failure rates, zero try-ons in 30 days (A-15). |

### 5.7 `garment-images`

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/admin/garments/:garmentId/images` | ADMIN | List images in gallery order. |
| POST | `/admin/garments/:garmentId/images` | ADMIN | Finalise an uploaded image against the garment; runs the A-10 validator when it is the try-on source. |
| PATCH | `/admin/garment-images/:imageId` | ADMIN | Update alt text or position. |
| POST | `/admin/garment-images/:imageId/tryon-source` | ADMIN | Designate this image the try-on source; clears the previous one and resets `testRenderState` to `NONE` (A-9). |
| POST | `/admin/garments/:garmentId/images/reorder` | ADMIN | Persist gallery order. |
| DELETE | `/admin/garment-images/:imageId` | ADMIN | Delete an image and its file. |
| POST | `/admin/garment-images/:imageId/revalidate` | ADMIN | Re-run the quality validator (A-10). |

### 5.8 `catalog` (public browse)

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/catalog/garments` | PUBLIC | Published garments with an approved test render only. Filters: `categoryId`, `color`, `priceMin`, `priceMax`, `embellishmentWeight`, `size`, `mode`, `search`. Sort: `newest`, `mostTried`, `priceAsc`, `priceDesc` (C-1, C-17). |
| GET | `/catalog/garments/:slugOrId` | PUBLIC | Garment detail: gallery, price, fabric, sizes (C-18). |
| GET | `/catalog/filters` | PUBLIC | Available filter facets with counts, so the UI never offers an empty filter. |
| GET | `/catalog/new-arrivals` | PUBLIC | Recently published, optionally scoped to `preferredCategories` for a signed-in consumer (C-8). |

`E-10` asserts that no garment lacking an approved test render is ever returned by any route in this
group. Prices are omitted from every response when `catalog.showPricesPublicly` is false (A-30).

### 5.9 `person-photos`

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/person-photos` | CONSUMER | Her saved photos with signed thumbnail URLs (C-16). |
| POST | `/person-photos` | CONSUMER | Finalise an uploaded photo: probe, strip EXIF, thumbnail, hash, moderate. Requires current consent. |
| POST | `/person-photos/:photoId/activate` | CONSUMER | Make this the active photo (C-16). |
| PATCH | `/person-photos/:photoId` | CONSUMER | Rename the label. |
| DELETE | `/person-photos/:photoId` | CONSUMER | Delete the photo and file, retire its cache entries. **Renders survive** (C-16, C-28). |

### 5.10 `consents`

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/consents/policy` | PUBLIC | The current policy version and body in the requested locale (C-11). |
| GET | `/consents/me` | CONSUMER | Her consent state: `{ status: GRANTED \| REQUIRED \| STALE, grantedAt, policyVersion }`. |
| POST | `/consents` | CONSUMER | Record consent with timestamp, IP, user agent and policy version (C-12). |

### 5.11 `tryon`

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| POST | `/tryon` | CONSUMER | Start a try-on: `{ garmentId, personPhotoId?, idempotencyKey }`. Runs the full §8.1 step-3 guard chain, then cache lookup, then upstream. Returns `{ jobId, status, cacheHit, result? }`. |
| GET | `/tryon/jobs` | CONSUMER | Her recent and in-flight jobs — the results tray (C-19). |
| GET | `/tryon/jobs/:jobId` | CONSUMER | Poll one job (the SSE fallback). |
| GET | `/tryon/jobs/:jobId/stream` | CONSUMER | **SSE.** `text/event-stream`, no envelope. Events below. |
| POST | `/tryon/jobs/:jobId/cancel` | CONSUMER | Give up on a job; no quota is consumed either way. |
| GET | `/admin/reference-models` | ADMIN | Reference model photos available for a test render (A-11). |
| POST | `/admin/tryon/test-render` | ADMIN | Run one test render for a garment against a reference model (A-11). |
| POST | `/admin/tryon/test-render/bulk` | ADMIN | Queue a batch; processed at concurrency 1 (A-12, §8.2). Returns `batchId`. |
| GET | `/admin/tryon/batches/:batchId` | ADMIN | Per-item progress and a success/failure summary (D-16). |
| GET | `/admin/tryon/batches/:batchId/stream` | ADMIN | **SSE** progress for the batch. |
| POST | `/admin/garments/:garmentId/test-render/approve` | ADMIN | Approve the stored test render; sets `testRenderState = APPROVED` and unblocks publishing (A-11). |
| POST | `/admin/garments/:garmentId/test-render/reject` | ADMIN | Reject with a reason. The garment is flagged as unproven; publishing is still permitted and records it (A-11). |

**SSE contract** for `/tryon/jobs/:jobId/stream`:

| `event` | `data` | When |
| --- | --- | --- |
| `stage` | `{ stage: 'QUEUED'\|'UPLOADING'\|'GENERATING'\|'FINISHING', jobId, elapsedMs }` | Drives the staged microcopy of the 7-second wait (C-19, §10.3). At least one every 2 s. |
| `succeeded` | `{ jobId, resultId, url, thumbnailUrl, width, height, cacheHit }` | Terminal. |
| `failed` | `{ jobId, errorCode, message }` | Terminal. `message` is the §8.3 consumer copy. |
| `heartbeat` | `{}` (comment frame) | Every 15 s, to keep intermediaries from closing the connection. |

The stream closes after a terminal event. The client reconnects with `Last-Event-ID`; the server
replays the terminal state if the job already finished. A consumer may only stream her own job
(ownership check → masked `JOB_NOT_FOUND`).

### 5.12 `results` / history

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/results` | CONSUMER | History, newest first. Filters: `verdict`, `categoryId`, `personPhotoId`, `search` on garment name. Thumbnails only (C-24, C-25, §9.1). |
| GET | `/results/groups/by-photo` | CONSUMER | History grouped by the photo it was generated from (C-30). |
| GET | `/results/:resultId` | CONSUMER | Full render with the compare image, caption and verdict state. **Costs nothing** (C-26). |
| DELETE | `/results/:resultId` | CONSUMER | Permanently delete one render and its file (C-31). |
| GET | `/results/:resultId/download` | CONSUMER | Watermarked PNG download (C-23). |
| POST | `/results/download` | CONSUMER | Zip of a selected set, watermarked (C-23, §7.5). |
| POST | `/results/:resultId/marketing-opt-in` | CONSUMER | Explicit, per-render opt-in for brand marketing use (§9.3). |
| POST | `/results/:resultId/verdict` | CONSUMER | Record `LOVE_IT` / `MAYBE` / `NOT_FOR_ME` with an optional reject reason. Upserts the `shortlist_items` row (C-20, C-21). |

### 5.13 `shortlist`

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/shortlist` | CONSUMER | `LOVE_IT` + `MAYBE` items in rank order, with the running total against her budget band (C-32). |
| POST | `/shortlist` | CONSUMER | Add a garment (equivalent to a `LOVE_IT` verdict). |
| PATCH | `/shortlist/:itemId` | CONSUMER | Update the note or the verdict. |
| POST | `/shortlist/reorder` | CONSUMER | Persist a drag-to-rank order (C-32). |
| DELETE | `/shortlist/:itemId` | CONSUMER | Remove from the shortlist. |

### 5.14 `share` and public voting

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/share-links` | CONSUMER | Her share links with view counts and expiry (C-34). |
| POST | `/share-links` | CONSUMER | Create a 30-day link. Blocked when `sharing.enabled` is false (A-30). |
| DELETE | `/share-links/:shareLinkId` | CONSUMER | Revoke immediately (C-34). |
| GET | `/share-links/:shareLinkId/votes` | CONSUMER | Reactions and comments left by her recipients. |
| GET | `/share/:token` | PUBLIC | The recipient view: renders only, no photo, no contact details, no other renders (C-33). |
| POST | `/share/:token/votes` | PUBLIC | React and leave one comment per item. Throttled hard. |
| GET | `/share/:token/votes` | PUBLIC | Reactions already left under this link, so a recipient sees their own. |

### 5.15 `enquiries`

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| POST | `/enquiries` | CONSUMER | Submit: shortlist snapshot + event date, type, budget band and message. Requires a verified phone (C-3, C-35). |
| GET | `/enquiries` | CONSUMER | Her enquiry history with current status (C-36). |
| GET | `/enquiries/:enquiryId` | CONSUMER | One of her enquiries. Internal notes are never included (A-24). |
| GET | `/admin/enquiries` | ADMIN | Inbox with status filter, stale-after-24 h flag and search (A-25). |
| GET | `/admin/enquiries/:enquiryId` | ADMIN | Full enquiry: contact details, event, budget, ranked items with renders and notes (A-21). |
| PATCH | `/admin/enquiries/:enquiryId/status` | ADMIN | Move status; a reason is required for `CLOSED_LOST` (A-22). |
| PATCH | `/admin/enquiries/:enquiryId/assign` | ADMIN | Assign to an admin. |
| GET | `/admin/enquiries/:enquiryId/notes` | ADMIN | Internal notes (A-24). |
| POST | `/admin/enquiries/:enquiryId/notes` | ADMIN | Add an internal note. |
| GET | `/admin/enquiries/:enquiryId/whatsapp-link` | ADMIN | A `wa.me` deep link pre-filled with her name and top pieces (A-23). |
| GET | `/admin/enquiries/export` | ADMIN | CSV export of the filtered set (A-26). |

### 5.16 `quota` and budget

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/quota/me` | CONSUMER | `{ period, limit, used, remaining, resetsAt }` — the persistent counter (C-5). |
| GET | `/admin/usage` | ADMIN | Generations this month, remaining budget, 7-day trailing rate, projected exhaustion, consumer-vs-test-render split, cache hits vs billed calls (A-33). |
| GET | `/admin/usage/ledger` | ADMIN | Paginated `usage_ledger` for reconciliation. |
| POST | `/admin/usage/adjust` | ADMIN | Append an `ADMIN_ADJUSTMENT` row to the budget ledger, with a note. |
| GET | `/admin/consumers/:userId/quota-ledger` | ADMIN | That consumer's quota ledger. |
| POST | `/admin/consumers/:userId/quota-adjust` | ADMIN | Append a quota adjustment (A-18). |

### 5.17 `moderation` and abuse

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/admin/moderation` | ADMIN | Queue of flagged photos, blurred thumbnails only. Every call audit-logged (A-34). |
| GET | `/admin/moderation/:itemId` | ADMIN | One item. Audit-logged. |
| POST | `/admin/moderation/:itemId/approve` | ADMIN | Release the photo for generation. |
| POST | `/admin/moderation/:itemId/reject` | ADMIN | Keep it blocked; the consumer sees the neutral message. |
| GET | `/admin/abuse` | ADMIN | Accounts hitting rate limits or repeated failures (A-35). |
| GET | `/admin/abuse/ip-blocks` | ADMIN | Current IP blocks. |
| POST | `/admin/abuse/ip-blocks` | ADMIN | Block an IP or CIDR (A-35). |
| DELETE | `/admin/abuse/ip-blocks/:blockId` | ADMIN | Lift a block. |

### 5.18 `analytics`

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/admin/analytics/overview` | ADMIN | The A-1 landing tiles: new enquiries, budget used, garments awaiting a test render, items flagged for review. |
| GET | `/admin/analytics/funnel` | ADMIN | signups → email verified → photo uploaded → first try-on → ≥1 star → enquiry (A-36). |
| GET | `/admin/analytics/garments` | ADMIN | Leaderboard: most tried, star rate, reject rate, enquiry rate (A-37). |
| GET | `/admin/analytics/rejection-reasons` | ADMIN | Rollup by neckline, colour, weight, silhouette, price (A-38). |
| GET | `/admin/analytics/categories` | ADMIN | Category performance (A-39). |
| GET | `/admin/analytics/activity` | ADMIN | Activity by hour and day (A-39). |
| GET | `/admin/analytics/generation-health` | ADMIN | Latency distribution, failure rate by error code, cache hit rate (E-13). |

### 5.19 `audit`

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/admin/audit` | ADMIN | Append-only audit log, filterable by actor, action and date range (A-3). |
| GET | `/admin/audit/actions` | ADMIN | The closed action registry, for the filter dropdown. |

### 5.20 `files`

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/files/:token` | PUBLIC | Serve a stored object against an HMAC token. `sub`-scoped tokens additionally require a matching session (§3.4). |
| POST | `/files/upload-ticket` | ANY | Issue an upload ticket for a declared purpose, after authorising purpose against role (§3.5). |
| PUT | `/files/upload/:ticket` ⊘ | PUBLIC | Redeem an upload ticket by streaming the bytes. Local driver only; the ticket is the credential. |

### 5.21 `health`

| Method | Path | Role | Purpose |
| --- | --- | :-: | --- |
| GET | `/health` | PUBLIC | Liveness. `@SkipThrottle()`. |
| GET | `/health/ready` | PUBLIC | Readiness: database, storage root writable, free space, TryOn driver configured. |
| GET | `/admin/metrics` | ADMIN | The E-13 metric snapshot for the admin usage screens. |

### 5.22 Rate limits

Global default 100 requests / 60 s, tracked by `userId` or IP. Overrides:

| Route(s) | Limit |
| --- | --- |
| `POST /auth/login`, `POST /auth/2fa/challenge`, `POST /auth/2fa/recovery` | 5 / 60 s |
| `POST /auth/signup` | 5 / 60 s + bot check (§8.4) |
| `POST /auth/password/forgot`, `POST /auth/password/reset` | 3 / 60 s |
| `POST /auth/phone/otp/request`, `POST /auth/email/verify/request` | 3 / 60 s |
| `POST /tryon` | 6 / 60 s **and** `TRYON_RATE_PER_HOUR` per account, plus `TRYON_RATE_PER_IP_HOUR` per IP (C-6) |
| `POST /files/upload-ticket` | 20 / 60 s |
| `POST /share/:token/votes` | 10 / 60 s per IP |
| `POST /admin/garments/bulk`, `POST /admin/tryon/test-render/bulk` | 10 / 60 s |
| `GET /health`, `GET /health/ready` | skipped |

---

## 6. Frontend conventions

### 6.1 Design tokens

Declared once in `packages/ui/src/tokens/tokens.css`, imported by `apps/web/src/styles/globals.css`,
mirrored as typed constants in `tokens.ts`, and mapped to Tailwind utilities by
`@repo/config-tailwind`. **No screen contains a raw hex value, a raw px spacing value, or a font
stack. D-1 is enforced by an ESLint rule banning hex literals and arbitrary Tailwind values in
`apps/web`.**

Only three tokens are overridable at runtime from `GET /settings/brand` (A-27): `--color-brand`,
`--color-brand-hover` and the logo asset. Everything else is compile-time.

#### Typefaces (D-2)

| Role | Family | Loaded via | Usage |
| --- | --- | --- | --- |
| Display | **Fraunces** (variable; `opsz` auto, `SOFT 20`, `WONK 0`, weights 400/600) | `next/font/google`, `--font-display` | Headings, product names, the result-reveal caption heading. **Used with restraint** — never for body copy, never below 18 px, never in the admin console except page titles. |
| Body | **Manrope** (variable, weights 400/500/600/700) | `next/font/google`, `--font-body` | Everything else: body copy, labels, buttons, tables, form fields, numerals. |
| Urdu | **Noto Nastaliq Urdu** (weights 400/600) | `next/font/google`, `--font-urdu` | Applied to the whole document when `lang="ur"`. Nastaliq needs vertical room — see the line-height override below. |
| Mono | **IBM Plex Mono** (400) | `next/font/google`, `--font-mono` | SKUs, references, ids, audit metadata, admin only. |

Fraunces gives warmth and a slightly humanist, hand-cut feel that suits embroidered formalwear
without tipping into wedding-invitation script. Manrope is quiet, has excellent numerals for the
admin tables, and holds at 12 px on a mid-range Android.

```css
/* apps/web/src/styles/fonts + tokens.css */
:root {
  --font-display: var(--next-font-fraunces), Georgia, 'Times New Roman', serif;
  --font-body:    var(--next-font-manrope), system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-urdu:    var(--next-font-noto-nastaliq-urdu), 'Jameel Noori Nastaleeq', serif;
  --font-mono:    var(--next-font-ibm-plex-mono), ui-monospace, monospace;
}
:root:lang(ur), [lang='ur'] {
  --font-display: var(--font-urdu);
  --font-body:    var(--font-urdu);
  --leading-multiplier: 1.85;  /* Nastaliq needs the extra vertical room */
}
```

#### Colour — light ("Daylight") and dark ("Lamplight")

Warm ivory ground, lac-red brand, antique gold accent. Hex is the normative form.

| Token | Light | Dark | Notes |
| --- | --- | --- | --- |
| `--color-canvas` | `#FBF8F3` | `#14100D` | Page background |
| `--color-surface` | `#FFFFFF` | `#1C1714` | Cards, sheets, table body |
| `--color-surface-raised` | `#FFFDFA` | `#241E19` | Popovers, dropdowns, sticky headers |
| `--color-surface-sunken` | `#F3EDE4` | `#0F0C0A` | Wells, image placeholders, skeleton base |
| `--color-ink` | `#1F1A16` | `#F4EDE4` | Primary text — **16.6 : 1** on canvas |
| `--color-ink-muted` | `#6B5F55` | `#B4A697` | Secondary text — **5.9 : 1** light, 8.1 : 1 dark |
| `--color-ink-subtle` | `#7C6F63` | `#8A7D70` | Tertiary text, placeholders — **4.6 : 1** light, 4.8 : 1 dark |
| `--color-line` | `#E4DACB` | `#2E2721` | Hairline borders, table rules |
| `--color-line-strong` | `#A58A63` | `#7B6959` | Input borders, dividers that must read — **3.09 : 1** light, 3.14 : 1 dark, worst ground. Bound by WCAG 2.1 SC 1.4.11 (non-text contrast), not by taste: it is the only thing that identifies an input's boundary, so it may never be lightened back below 3 : 1 |
| `--color-brand` | `#71202F` | `#C96A78` | Lac red. **10.2 : 1** light, 5.4 : 1 dark. Runtime-overridable (A-27) |
| `--color-brand-hover` | `#591626` | `#D9808C` | |
| `--color-brand-active` | `#45101D` | `#E695A0` | |
| `--color-brand-fg` | `#FFF7F2` | `#1A0F11` | Text on a brand fill — 10.4 : 1 |
| `--color-brand-tint` | `#F6E8E9` | `#3A1D24` | Selected rows, quiet brand washes |
| `--color-gold` | `#A67C2E` | `#D6AC63` | Antique gold. **3.6 : 1 light — non-text and large text only** |
| `--color-gold-text` | `#6F4F14` | `#E4C489` | The gold-family colour when text is required — 7.2 : 1 light |
| `--color-gold-tint` | `#F5EAD5` | `#3A2E18` | |
| `--color-success` | `#2F6B4F` | `#63B389` | 5.9 : 1 light |
| `--color-success-tint` | `#E4F0E9` | `#16301F` | |
| `--color-warning` | `#8A5209` | `#E0A44A` | 5.1 : 1 light |
| `--color-warning-tint` | `#FBEEDC` | `#332412` | |
| `--color-danger` | `#A32A22` | `#E8776C` | 6.8 : 1 light |
| `--color-danger-tint` | `#F9E5E2` | `#361714` | |
| `--color-info` | `#2C5A73` | `#7FB4CE` | 7.1 : 1 light |
| `--color-info-tint` | `#E2EDF2` | `#12242D` | |
| `--color-focus` | `#71202F` | `#D6AC63` | 2 px focus ring + 2 px offset, never removed (D-10, D-20) |
| `--color-overlay` | `rgb(31 26 22 / 0.55)` | `rgb(8 6 5 / 0.68)` | Modal scrim |
| `--color-skeleton` | `#EFE7DB` | `#241E19` | |

Rules:
- Text colour is only ever `--color-ink`, `--color-ink-muted`, `--color-ink-subtle`,
  `--color-brand`, `--color-gold-text`, `--color-brand-fg` or a semantic colour. Never `--color-gold`.
- The full palette is asserted by `packages/ui/src/tokens/contrast.spec.ts`, which fails the build if
  any documented pair drops below its stated ratio (D-20). Changing a brand colour via A-27 runs the
  same check server-side and rejects a failing value (`SETTINGS_VALUE_INVALID`).
- Dark mode is opt-in via `class="dark"` on `<html>`, resolved from `prefers-color-scheme` plus a
  stored preference.

#### Type scale (fixed, D-2)

| Token | Size | Line height | Tracking | Family | Used for |
| --- | --- | --- | --- | --- | --- |
| `--text-2xs` | `0.6875rem` / 11px | `1rem` | `+0.04em` | body | Admin table meta, badges, timestamps |
| `--text-xs` | `0.75rem` / 12px | `1.125rem` | `+0.02em` | body | Captions, helper text, admin dense cells |
| `--text-sm` | `0.875rem` / 14px | `1.375rem` | `0` | body | Admin default, form labels, secondary copy |
| `--text-base` | `1rem` / 16px | `1.625rem` | `0` | body | Consumer default body |
| `--text-lg` | `1.125rem` / 18px | `1.75rem` | `0` | body | Lead paragraphs, consent body copy |
| `--text-xl` | `1.375rem` / 22px | `1.875rem` | `-0.005em` | display | Card titles, product names in the grid |
| `--text-2xl` | `1.75rem` / 28px | `2.125rem` | `-0.01em` | display | Section headings, admin page titles |
| `--text-3xl` | `2.25rem` / 36px | `2.5rem` | `-0.015em` | display | Page headings, garment detail title |
| `--text-4xl` | `3rem` / 48px | `3.25rem` | `-0.02em` | display | Consumer hero, result reveal |
| `--text-5xl` | `4rem` / 64px | `4.25rem` | `-0.025em` | display | Landing hero, desktop only |

`--text-4xl` and `--text-5xl` clamp down one step below 640 px. `--text-2xs` is **admin only** and is
never used for anything a consumer must read.

#### Spacing — 4 px base

`--space-0: 0` · `--space-px: 1px` · `--space-1: 0.25rem` · `--space-2: 0.5rem` ·
`--space-3: 0.75rem` · `--space-4: 1rem` · `--space-5: 1.25rem` · `--space-6: 1.5rem` ·
`--space-8: 2rem` · `--space-10: 2.5rem` · `--space-12: 3rem` · `--space-16: 4rem` ·
`--space-20: 5rem` · `--space-24: 6rem` · `--space-32: 8rem`

#### Radii

`--radius-xs: 2px` · `--radius-sm: 4px` · `--radius-md: 8px` · `--radius-lg: 12px` ·
`--radius-xl: 20px` · `--radius-2xl: 28px` · `--radius-full: 9999px`

Consumer surfaces use `--radius-lg` / `--radius-xl`; admin surfaces use `--radius-sm` /
`--radius-md`. Images in the consumer grid use `--radius-lg`; render viewers use `--radius-xs` so
nothing visibly crops the result.

#### Borders

`--border-hairline: 1px` · `--border-medium: 1.5px` · `--border-heavy: 2px` ·
`--border-focus: 2px`. Default border colour `--color-line`; interactive controls
`--color-line-strong`.

#### Shadows — warm-tinted, never pure black

```css
--shadow-xs: 0 1px 2px rgb(60 42 28 / 0.06);
--shadow-sm: 0 2px 4px rgb(60 42 28 / 0.07), 0 1px 2px rgb(60 42 28 / 0.05);
--shadow-md: 0 6px 14px rgb(60 42 28 / 0.09), 0 2px 4px rgb(60 42 28 / 0.05);
--shadow-lg: 0 16px 32px rgb(60 42 28 / 0.12), 0 4px 8px rgb(60 42 28 / 0.06);
--shadow-xl: 0 28px 56px rgb(60 42 28 / 0.16);
--shadow-focus: 0 0 0 2px var(--color-canvas), 0 0 0 4px var(--color-focus);
```

In dark mode the tints become `rgb(0 0 0 / …)` at roughly double the alpha.

#### Motion (D-11)

`--duration-instant: 80ms` · `--duration-fast: 140ms` · `--duration-base: 220ms` ·
`--duration-slow: 380ms` · `--ease-out: cubic-bezier(0.2, 0, 0, 1)` ·
`--ease-in-out: cubic-bezier(0.5, 0, 0.2, 1)`.
Every transition is wrapped by `@media (prefers-reduced-motion: reduce) { * { animation-duration: 1ms !important; transition-duration: 1ms !important; } }`.

#### Admin density scale (D-4)

Set by `data-density` on the admin shell; persisted in the UI store. `comfortable` is the default;
`compact` is offered only when `(pointer: fine)` so the 44 × 44 px touch target floor (D-10) is never
violated on a phone.

| Token | `comfortable` | `compact` |
| --- | --- | --- |
| `--density-row-height` | `44px` | `32px` |
| `--density-cell-px` | `var(--space-4)` | `var(--space-3)` |
| `--density-cell-py` | `var(--space-3)` | `var(--space-1)` |
| `--density-control-height` | `36px` | `28px` |
| `--density-font-size` | `var(--text-sm)` | `var(--text-xs)` |
| `--density-stack-gap` | `var(--space-4)` | `var(--space-2)` |
| `--density-section-gap` | `var(--space-8)` | `var(--space-5)` |

### 6.2 The two layout languages (D-4)

Both sides draw from the same tokens. They do not share a layout language.

| | **Consumer — image-led, generous** | **Admin — dense, tabular** |
| --- | --- | --- |
| Container | `--container-consumer: 1200px`, centred | `--container-admin: 1680px`, full-bleed inside the shell |
| Gutters | `--space-5` @360px → `--space-8` @768 → `--space-12` @1200 | `--space-4` fixed |
| Shell | Top bar 64px + bottom tab bar 56px on mobile; no sidebar | Fixed sidebar `--sidenav-width: 264px` (collapsed `72px`), top bar 56px |
| Vertical rhythm | Section gap `--space-16`; block gap `--space-8` | Section gap `--density-section-gap`; block gap `--density-stack-gap` |
| Spacing multiplier | **1.5×** the admin value for the same semantic gap | **1×** baseline |
| Grid | 2 cols @360, 2 @480, 3 @768, 4 @1200. Gap `--space-4` → `--space-6` | 12-col, gap `--space-4` |
| Card | `--radius-xl`, `--shadow-sm`, image first, 3:4 aspect ratio, text block `--space-4` | `--radius-md`, `--border-hairline`, no shadow, no image unless it is data |
| Type | `--text-base` body, `--text-xl`+ display headings | `--text-sm` body, `--text-2xl` page title only |
| Tables | Avoided. History and shortlist are card lists. | The primary form. Row height `--density-row-height`, sticky header, zebra off, hover `--color-surface-sunken`, selected `--color-brand-tint` |
| Actions | One primary action per screen, full-width on mobile, min 44 × 44 px | Icon buttons `--density-control-height`, bulk action bar docks to the bottom when a selection exists |
| Imagery | Full-bleed renders, pinch-zoom, no chrome over the image except the persistent caption | Thumbnails at 40 px in tables, 160 px in detail panes |
| Keyboard | Standard tab order | `j`/`k` navigate rows, `Enter` open, `a` approve test render, `p` publish, `/` focus search (D-19) |

Both hold from 360 px (D-9). The admin console stays usable on a phone for enquiry handling and
approvals: tables collapse to stacked cards below 768 px, and full catalog editing shows a
"best on a larger screen" notice rather than a broken layout.

### 6.3 `packages/ui` atom inventory

shadcn/ui-derived, Radix-based, `cva` variants, `forwardRef`, exported props interface, RTL-safe.
One folder per atom: `Component.tsx`, `index.ts`, and `Component.test.tsx`.

**Primitives** — `Button` (variants `primary | secondary | ghost | outline | danger | link`; sizes
`sm | md | lg | icon`), `IconButton`, `Link`, `Badge`, `Avatar`, `Spinner`, `Separator`, `Kbd`,
`VisuallyHidden`, `AspectRatio`, `ScrollArea`.

**Forms** — `Input`, `Textarea`, `Label`, `FormField` (label + control + description + error, wired
with `aria-describedby`/`aria-invalid`), `Select` (shadcn/Radix — **not** React Select, per the
locked decision), `MultiSelect`, `Combobox`, `Checkbox`, `RadioGroup`, `Switch`, `Slider`,
`RangeSlider` (price band), `DatePicker`, `FileDropzone` (drag-and-drop + per-file progress, A-9),
`OtpInput`, `PasswordInput` (with strength meter), `ColorSwatchPicker`, `TagInput`.

**Layout** — `Card` (+ `Header`/`Title`/`Description`/`Content`/`Footer`), `Sheet`, `Dialog`,
`AlertDialog`, `Drawer`, `Popover`, `Tooltip`, `DropdownMenu`, `Tabs`, `Accordion`, `Breadcrumbs`,
`Pagination`, `Toolbar`, `Stack`, `Grid`.

**Data** — `Table` (+ `Head`/`Row`/`Cell`, density-aware), `DataTable` (sorting, selection, column
visibility, sticky header, empty/loading/error slots), `DescriptionList`, `Stat`, `ProgressBar`,
`QuotaMeter`, `Sparkline`, `EmptyState`, `ErrorState`, `Skeleton` (aspect-ratio-matched per D-8).

**Feedback** — `Toast` + `Toaster`, `Callout` (`info | success | warning | danger`), `InlineError`,
`ConfirmDialog`, `TypeToConfirmDialog` (D-17).

**Media** — `Image` (wraps `next/image`, mandatory `alt`), `ImageGallery`, `Zoomable`
(pinch/double-tap/scroll zoom, C-20), `CompareToggle` (catalog photo ↔ render, C-20),
`WatermarkPreview`, `BlurredThumbnail` (moderation).

**Providers** — `ThemeProvider` (mode + brand override), `DirectionProvider` (Radix `dir`),
`TooltipProvider`, `ToastProvider`.

Every atom: keyboard-operable, visible `:focus-visible` ring using `--shadow-focus`, disabled and
hover states defined, no physical-side CSS (see §6.7), and a passing `axe-core` assertion in its test.

### 6.4 `packages/api-client`

There are **no bearer tokens anywhere in the frontend**. Authentication is the `drape.sid` httpOnly
cookie; the only header the client adds is the CSRF token. There is no refresh-token interceptor and
no `localStorage`.

#### Browser instance

```typescript
// packages/api-client/src/axios-instance.ts
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL,   // e.g. http://localhost:4000/api/v1
  timeout: 30_000,
  withCredentials: true,                            // the session cookie — B-6
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor
apiClient.interceptors.request.use((config) => {
  const method = (config.method ?? 'get').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = readCookie('drape.csrf');          // readable by JS by design — B-8 double-submit
    if (token) config.headers['X-CSRF-Token'] = token;
  }
  config.headers['X-Request-Id'] = crypto.randomUUID();
  return config;
});
```

`ensureCsrf()` calls `GET /auth/csrf` once per page load before the first mutation if the cookie is
absent, and retries a single time on `CSRF_TOKEN_INVALID`.

#### Server-side instance (Server Components, B-9)

```typescript
// packages/api-client/src/server-instance.ts
import 'server-only';
import axios from 'axios';
import { cookies, headers } from 'next/headers';

/** Forwards the incoming cookie to the API. Never used in a Client Component. */
export async function createServerApiClient() {
  const cookieHeader = (await cookies()).toString();
  const requestId = (await headers()).get('x-request-id') ?? crypto.randomUUID();

  return axios.create({
    baseURL: process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL,
    timeout: 10_000,
    headers: { Cookie: cookieHeader, 'X-Request-Id': requestId },
  });
}
```

There is no proxy route handler in the web app (B-9). Server Components read through this client;
the browser calls the API directly for mutations.

#### Error normalisation

Every rejection reaching application code is an `ApiError` — never a raw `AxiosError`.

```typescript
export class ApiError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;          // an ErrorCode value, or NETWORK_ERROR / REQUEST_TIMEOUT / UNKNOWN_ERROR
  readonly errors: FieldError[];
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;
  readonly isRetryable: boolean;       // true for 5xx, 408, 429 and network failures

  constructor(init: ApiErrorInit) { /* … */ }

  is(code: string): boolean { return this.errorCode === code; }
  isOneOf(...codes: string[]): boolean { return codes.includes(this.errorCode); }
}
```

`message` is the server's message — already user-safe and already through the §9.4 check — so the UI
displays it directly rather than inventing its own copy. Client-side additions: `NETWORK_ERROR`
("You appear to be offline. We'll retry when you're back.") and `REQUEST_TIMEOUT` ("That took too
long. Try again."), both translated locally. On `AUTH_REQUIRED` / `SESSION_EXPIRED` the interceptor
clears the auth store and redirects to `/login?from=<path>` — **once**, guarded by a module flag.

#### TanStack Query defaults

```typescript
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,           // 1 min
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: (failureCount, error) => (error as ApiError).isRetryable && failureCount < 2,
        retryDelay: (i) => Math.min(1000 * 2 ** i, 15_000),
        throwOnError: false,         // states are rendered, not thrown, per D-5
      },
      mutations: { retry: false },
    },
  });
}
```

Per-query overrides: catalog lists `staleTime: 5 * 60_000`; `auth.me` `staleTime: Infinity`
(invalidated explicitly on login/logout); `quota.me` `staleTime: 0` (it changes on every generation);
try-on job status is driven by SSE, not polling, with a 3 s polling fallback when `EventSource` fails.

#### Query-key factory

Hierarchical, `as const`, one root per domain, so invalidation is surgical.

```typescript
export const queryKeys = {
  auth:        { all: ['auth'] as const,
                 me: () => [...queryKeys.auth.all, 'me'] as const,
                 sessions: () => [...queryKeys.auth.all, 'sessions'] as const },
  settings:    { all: ['settings'] as const,
                 brand: () => [...queryKeys.settings.all, 'brand'] as const,
                 admin: () => [...queryKeys.settings.all, 'admin'] as const },
  categories:  { all: ['categories'] as const,
                 tree: (scope: 'public' | 'admin') => [...queryKeys.categories.all, 'tree', scope] as const,
                 detail: (id: string) => [...queryKeys.categories.all, 'detail', id] as const },
  catalog:     { all: ['catalog'] as const,
                 lists: () => [...queryKeys.catalog.all, 'list'] as const,
                 list: (f: CatalogFilters) => [...queryKeys.catalog.lists(), f] as const,
                 details: () => [...queryKeys.catalog.all, 'detail'] as const,
                 detail: (idOrSlug: string) => [...queryKeys.catalog.details(), idOrSlug] as const,
                 facets: () => [...queryKeys.catalog.all, 'facets'] as const },
  garments:    { all: ['garments'] as const, lists: () => …, list: (f) => …, detail: (id) => …,
                 images: (id: string) => [...queryKeys.garments.all, 'images', id] as const,
                 health: () => [...queryKeys.garments.all, 'health'] as const },
  photos:      { all: ['person-photos'] as const, list: () => …, detail: (id) => … },
  consent:     { all: ['consent'] as const, me: () => …, policy: (locale) => … },
  tryon:       { all: ['tryon'] as const, jobs: () => …, job: (id) => …,
                 batch: (batchId: string) => [...queryKeys.tryon.all, 'batch', batchId] as const },
  results:     { all: ['results'] as const, lists: () => …, list: (f: HistoryFilters) => …,
                 detail: (id) => …, byPhoto: () => … },
  shortlist:   { all: ['shortlist'] as const, list: () => … },
  share:       { all: ['share'] as const, links: () => …, link: (id) => …,
                 publicView: (token: string) => [...queryKeys.share.all, 'public', token] as const },
  enquiries:   { all: ['enquiries'] as const, mine: () => …, adminList: (f) => …, detail: (id) => …,
                 notes: (id) => … },
  quota:       { all: ['quota'] as const, me: () => …, adminUsage: (period) => … },
  consumers:   { all: ['consumers'] as const, list: (f) => …, detail: (id) => …, renders: (id) => … },
  moderation:  { all: ['moderation'] as const, list: (f) => …, detail: (id) => …, abuse: () => … },
  analytics:   { all: ['analytics'] as const, overview: () => …, funnel: (r) => …, garments: (r) => …,
                 rejections: (r) => …, categories: (r) => …, activity: (r) => … },
  audit:       { all: ['audit'] as const, list: (f) => … },
  invites:     { all: ['invites'] as const, list: () => … },
  notifications:{ all: ['notifications'] as const, list: () => …, unreadCount: () => … },
} as const;
```

Rule: a mutation invalidates the **narrowest** key that covers what changed. A verdict invalidates
`results.detail(id)`, `results.lists()` and `shortlist.list()` — never `queryKeys.results.all`.

`packages/api-client/src/endpoints/` holds one typed function per route in §5, generated against the
exported OpenAPI document. Feature hooks (`useGetGarments`, `useCreateGarment`, …) live in
`apps/web/src/features/*/hooks/` and call those functions — features never call `apiClient` directly.

### 6.5 `packages/store` — Zustand inventory

Zustand holds **client state only**. Anything the API owns lives in TanStack Query. A `fetch` inside
a store is a review failure.

| Store | State | Persisted |
| --- | --- | --- |
| `useAuthStore` | `user: SessionUser \| null`, `isAuthenticated`, `isHydrated`; `setUser`, `clear`, `hasRole` | No. Hydrated on every load from the server-rendered `/auth/me` result. **Never the authorisation decision** (S-3, B-10). |
| `useUiStore` | `sidebarCollapsed`, `adminDensity: 'comfortable' \| 'compact'`, `themeMode: 'light' \| 'dark' \| 'system'`, `activeModal`, `commandPaletteOpen` | Yes — `localStorage`, key `drape.ui` |
| `useLocaleStore` | `locale: 'en' \| 'ur'`, `direction: 'ltr' \| 'rtl'`; `setLocale` writes the `NEXT_LOCALE` cookie and navigates | Cookie, not `localStorage` — the server needs it |
| `useTryOnStore` | `jobs: Record<jobId, { garmentId, stage, startedAt, resultId?, errorCode? }>`, `trayOpen`, `activePhotoId`; `startJob`, `updateStage`, `completeJob`, `dismissJob` | Session storage — the tray survives a reload while she keeps browsing (C-19) |
| `useCatalogFiltersStore` | `categoryId`, `colors[]`, `priceRange`, `weights[]`, `sizes[]`, `search`, `sort`; mirrored to the URL query string, which is the source of truth for sharing | No |
| `useUploadStore` | `files: Record<clientId, { name, bytes, progress, status, error }>`; per-file progress for A-9 and C-15 | No |
| `useShortlistDraftStore` | `pendingOrder: string[] \| null` — the optimistic order held during a drag, rolled back on failure (C-32, D-18) | No |
| `useAdminSelectionStore` | `selectedIds: Set<string>`, `lastAnchorId` — bulk selection across pages (A-12) | No |
| `useToastStore` | `toasts[]`; `push`, `dismiss` | No |

Every read uses a selector (`useUiStore((s) => s.adminDensity)`) or `useShallow`. Subscribing to a
whole store is a review failure. Stores stay under ~150 lines; split by domain when they grow.

### 6.6 `apps/web` route tree

One app, two shells, one `/login`, one `/dashboard` (S-1, S-2). Locale is a root dynamic segment.
**RSC** = Server Component (the default). **CC** = has `'use client'` at its root.

```
apps/web/src/app/
├── layout.tsx                                  RSC  <html lang dir>, fonts, ThemeProvider, QueryProvider, Toaster
├── error.tsx / not-found.tsx / global-error.tsx CC  D-5 error state
└── [locale]/
    ├── layout.tsx                              RSC  next-intl provider, direction, brand settings fetch
    ├── page.tsx                                RSC  public landing → featured categories + new arrivals (C-1)
    ├── loading.tsx  error.tsx                  RSC/CC
    │
    ├── (public)/
    │   ├── layout.tsx                          RSC  public shell: slim top bar, sign-in call to action
    │   ├── browse/page.tsx                     RSC  catalog grid; filters are a CC island
    │   ├── browse/[categorySlug]/page.tsx      RSC  category-scoped grid (C-17)
    │   ├── garments/[slug]/page.tsx            RSC  garment detail + generateMetadata + JSON-LD (C-18)
    │   ├── garments/[slug]/loading.tsx         RSC  aspect-matched skeleton (D-8)
    │   └── s/[token]/page.tsx                  RSC  share recipient view; voting is a CC island (C-33)
    │
    ├── (auth)/
    │   ├── layout.tsx                          RSC  centred card shell, no nav
    │   ├── login/page.tsx                      RSC shell + CC form (S-1)
    │   ├── signup/page.tsx                     RSC shell + CC form (C-2, S-4)
    │   ├── forgot-password/page.tsx            CC form
    │   ├── reset-password/[token]/page.tsx     RSC validates the token server-side + CC form
    │   ├── verify-email/[token]/page.tsx       RSC consumes the token server-side
    │   ├── two-factor/page.tsx                 CC   TOTP challenge (S-8)
    │   └── invite/[token]/page.tsx             RSC validates + CC acceptance form (S-5)
    │
    ├── dashboard/page.tsx                      RSC  **the S-2 switch**: reads the session server-side,
    │                                                renders <AdminHome/> or <ConsumerHome/>. One URL.
    │
    ├── (consumer)/
    │   ├── layout.tsx                          RSC  ConsumerShell; redirects an admin to /dashboard
    │   ├── consent/page.tsx                    RSC  policy body server-rendered + CC accept form (C-11)
    │   ├── photos/page.tsx                     RSC  saved photos (C-16)
    │   ├── photos/new/page.tsx                 RSC guidance illustrations + CC validator/uploader (C-13, C-14)
    │   ├── renders/page.tsx                    RSC  history list; filters + grouping are CC (C-25, C-30)
    │   ├── renders/[resultId]/page.tsx         RSC  result view: compare, zoom, caption, verdicts (C-26)
    │   ├── renders/[resultId]/@modal/          —    intercepting route for in-grid opening
    │   ├── tryon/[jobId]/page.tsx              CC   the staged 7-second wait + reveal (§10.3)
    │   ├── shortlist/page.tsx                  RSC list + CC drag-to-rank (C-32)
    │   ├── share/page.tsx                      RSC  her share links (C-34)
    │   ├── enquiries/page.tsx                  RSC  enquiry history + status (C-36)
    │   ├── enquiries/new/page.tsx              RSC prefilled + CC form (C-35)
    │   └── account/
    │       ├── page.tsx                        RSC  profile (C-7)
    │       ├── security/page.tsx               RSC + CC  password, 2FA, sessions
    │       ├── notifications/page.tsx          RSC + CC  preferences (C-7)
    │       └── data/page.tsx                   RSC  everything stored about her, export, delete (C-37…C-40)
    │
    ├── admin/
    │   ├── layout.tsx                          RSC  AdminShell; a consumer here gets /no-access (S-9)
    │   ├── page.tsx                            RSC  redirect → /dashboard
    │   ├── categories/page.tsx                 RSC + CC  tree, reorder, archive (A-4…A-7)
    │   ├── catalog/page.tsx                    RSC  garment table; filters/selection are CC (A-14)
    │   ├── catalog/new/page.tsx                RSC + CC  garment editor (A-8)
    │   ├── catalog/[garmentId]/page.tsx        RSC  editor + images + quality report + test render
    │   ├── catalog/[garmentId]/test-render/page.tsx RSC + CC  source vs render, approve/reject (A-11)
    │   ├── catalog/health/page.tsx             RSC  catalog health panel (A-15)
    │   ├── consumers/page.tsx                  RSC  consumer list (A-16)
    │   ├── consumers/[userId]/page.tsx         RSC  detail — no photo, renders only via enquiries (A-17)
    │   ├── enquiries/page.tsx                  RSC  inbox with the 24h stale highlight (A-25)
    │   ├── enquiries/[enquiryId]/page.tsx      RSC  detail, status, notes, WhatsApp (A-21…A-24)
    │   ├── moderation/page.tsx                 RSC  blurred queue (A-34)
    │   ├── abuse/page.tsx                      RSC  rate-limit hits, suspensions, IP blocks (A-35)
    │   ├── usage/page.tsx                      RSC  budget, burn rate, projection (A-33)
    │   ├── analytics/page.tsx                  RSC  funnel, leaderboard, rejections, categories, activity (A-36…A-39)
    │   ├── audit/page.tsx                      RSC  audit log with filters (A-3)
    │   ├── team/page.tsx                       RSC  admins and invites (A-2)
    │   ├── settings/page.tsx                   RSC + CC  brand, quotas, budget, toggles (A-27…A-30)
    │   ├── settings/policy/page.tsx            RSC + CC  policy versions (C-12)
    │   └── preview/page.tsx                    RSC  consumer experience without spending generations (A-31)
    │
    ├── no-access/page.tsx                      RSC  the S-9 screen: plain, links back to the fitting room
    └── offline/page.tsx                        RSC
```

Rules:

- Every segment with data has `loading.tsx` (aspect-ratio-matched skeleton, D-8) and `error.tsx`.
- `'use client'` is pushed to the leaf. A filter bar is a Client Component; the page around it is not.
- `middleware.ts` does locale negotiation and an unauthenticated redirect **for convenience only**.
  It is never the security boundary — every protected page re-verifies the session server-side by
  calling `/auth/me`, and every data operation is independently authorised by the API (S-3, B-10).
- The admin console never renders a raw 403. `INSUFFICIENT_ROLE` routes to `/no-access` (S-9).
- Page components stay under ~50 lines and delegate to a feature component.

### 6.7 i18n and RTL (C-41)

`next-intl` with a `[locale]` root segment. Locales `en` (default, `ltr`) and `ur` (`rtl`).

```typescript
// src/i18n/config.ts
export const locales = ['en', 'ur'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';
export const direction: Record<Locale, 'ltr' | 'rtl'> = { en: 'ltr', ur: 'rtl' };
```

```tsx
// app/layout.tsx
<html lang={locale} dir={direction[locale]} suppressHydrationWarning>
```

- Messages are namespaced per feature: `src/i18n/messages/{en,ur}/{common,auth,catalog,tryon,results,shortlist,share,enquiry,account,admin,errors}.json`. A missing `ur` key falls back to `en` and fails CI in `ur`-complete mode.
- `errors.json` maps every `ErrorCode` to translated copy. The **English** value must be identical to
  the server default in §2.4 — a test asserts it, so the two never drift.
- **Logical CSS properties only.** No `margin-left`, `padding-right`, `left`, `right`, `text-align:
  left/right`, no `ml-*`, `mr-*`, `pl-*`, `pr-*`, `left-*`, `right-*`, `text-left`, `text-right`,
  `border-l-*`, `border-r-*`, `rounded-l-*`, `rounded-r-*`, `space-x-*`. Use `margin-inline-start`,
  `padding-inline-end`, `inset-inline-start`, `text-align: start`, and the Tailwind logical
  equivalents `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`,
  `border-s-*`, `border-e-*`, `rounded-s-*`, `rounded-e-*`, `gap-x-*`.
  `@repo/config-eslint` bans the physical forms with `no-restricted-syntax`; the build fails on them.
  **There are no per-side RTL overrides and no `[dir='rtl']` selectors in the codebase.**
- Directional icons (chevrons, arrows, back buttons) use a single `<DirectionalIcon>` that flips with
  `scaleX(-1)` under `rtl`. Icons that are not directional (search, trash, plus) never flip.
- Numerals stay Latin in both locales — the admin tables and prices depend on it. Dates, currency and
  relative times go through `Intl` with the active locale and `Asia/Karachi`.
- Nastaliq needs vertical room: `[lang='ur']` raises line height by `--leading-multiplier` and drops
  the display face in favour of the Urdu face, since Fraunces has no Arabic-script coverage.
- Every screen is verified in `ur` at 360 px as part of D-5 sign-off, not deferred to milestone 8.

---

## 7. Environment variables

`api` vars live in `backend/.env`. `web` vars live in `frontend/apps/web/.env.*`. Only
`NEXT_PUBLIC_*` reaches the browser. **No secret ever carries the `NEXT_PUBLIC_` prefix, and no
credential has a fallback default in code** (E-2).

The API calls `validateRequiredEnvVars()` before `NestFactory.create()`; the web app validates with
`@t3-oss/env-nextjs` at build time. A missing required variable fails startup or the build, never a
request.

| Name | Svc | Req | Example | Purpose |
| --- | :-: | :-: | --- | --- |
| `NODE_ENV` | api | ✔ | `development` | `development \| staging \| production` (E-1). |
| `API_PORT` | api | — | `4000` | HTTP port. |
| `APP_WEB_URL` | api | ✔ | `http://localhost:3000` | The web origin. Used for links in emails and for the QR/short link. |
| `APP_API_URL` | api | ✔ | `http://localhost:4000` | Public base for signed file URLs. |
| `CORS_ORIGINS` | api | ✔ | `http://localhost:3000` | Comma-separated allow-list. **Never `*`, in any environment** (B-7). |
| `TRUST_PROXY` | api | — | `1` | Hop count for correct client IPs behind a reverse proxy. |
| `LOG_LEVEL` | api | — | `debug` | `debug \| info \| warn \| error`. |
| `EXPOSE_API_DOCS` | api | — | `false` | Mounts `/api/docs` and `/api/docs-json`. **Defaults false everywhere**, and is ignored when `NODE_ENV=production`. The mount is raw Express middleware, so it sits outside the §2.7 guard chain and `check:guards` cannot see it — any network-reachable environment that enables it must put authentication in front of the mount. |
| `DATABASE_URL` | api | ✔ | `postgresql://drape:drape@localhost:5432/drape` | Postgres connection (B-3). |
| `DATABASE_SSL` | api | — | `false` | TLS to the database. |
| `DATABASE_POOL_MAX` | api | — | `10` | Pool ceiling (20–50 in production). |
| `DATABASE_POOL_MIN` | api | — | `2` | Pool floor. |
| `SESSION_COOKIE_NAME` | api | — | `drape.sid` | Session cookie name. |
| `SESSION_COOKIE_DOMAIN` | api | ✔ | `.localhost` / `.example.com` | Parent domain so one cookie covers both origins (B-6). |
| `SESSION_SECRET` | api | ✔ | 64 hex chars | HMAC key for session token derivation. Rotating it logs everyone out. |
| `SESSION_ADMIN_IDLE_HOURS` | api | — | `12` | Admin idle expiry (S-7). |
| `SESSION_CONSUMER_IDLE_DAYS` | api | — | `30` | Consumer idle expiry (S-7). |
| `SESSION_ADMIN_ABSOLUTE_DAYS` | api | — | `7` | Admin hard ceiling. |
| `SESSION_CONSUMER_ABSOLUTE_DAYS` | api | — | `90` | Consumer hard ceiling. |
| `SESSION_COOKIE_SECURE` | api | — | `false` locally, `true` elsewhere | `Secure` flag. Always `true` outside local. |
| `CSRF_COOKIE_NAME` | api | — | `drape.csrf` | Double-submit cookie, readable by JS by design (B-8). |
| `CSRF_SECRET` | api | ✔ | 64 hex chars | HMAC key for CSRF token derivation. |
| `ARGON2_MEMORY_KIB` | api | — | `19456` | Argon2id memory cost (S-6). |
| `ARGON2_TIME_COST` | api | — | `2` | Argon2id iterations. |
| `ARGON2_PARALLELISM` | api | — | `1` | Argon2id lanes. |
| `TWOFA_ENCRYPTION_KEY` | api | ✔ | 64 hex chars | AES-256-GCM key protecting `users.twofaSecret` (S-8). |
| `TWOFA_ISSUER` | api | — | `Drape` | Label in the authenticator app. |
| `STORAGE_DRIVER` | api | — | `local` | `local` in V1; `s3` later without call-site changes. |
| `STORAGE_ROOT` | api | ✔ | `D:/drape-storage` | Absolute path **outside the repository**. Startup fails if it resolves inside it. |
| `STORAGE_URL_SECRET` | api | ✔ | 64 hex chars | HMAC key for signed download and upload tokens (§3.4). |
| `STORAGE_URL_TTL_PHOTO_SECONDS` | api | — | `300` | Person-photo URL TTL. |
| `STORAGE_URL_TTL_RENDER_SECONDS` | api | — | `900` | Render URL TTL. |
| `STORAGE_URL_TTL_PUBLIC_SECONDS` | api | — | `3600` | Garment/category/brand URL TTL. |
| `STORAGE_UPLOAD_TICKET_TTL_SECONDS` | api | — | `900` | Upload ticket TTL. |
| `STORAGE_MAX_UPLOAD_MB` | api | — | `25` | Hard per-file ceiling. |
| `STORAGE_MIN_FREE_MB` | api | — | `2048` | Below this, `/health/ready` degrades and an alert fires (E-14). |
| `TRYON_DRIVER` | api | ✔ | `mock` | `mock \| http`. **`mock` in local and CI** — the upstream account has a 10-image budget. |
| `TRYONCLOUD_BASE_URL` | api | if `http` | `https://api.tryoncloud.example/v1` | Upstream base URL. |
| `TRYONCLOUD_API_KEY` | api | if `http` | — | **API-service-only secret** (B-1, §9.2). Rotated quarterly. |
| `TRYON_API_VERSION` | api | ✔ | `2026-08-01` | Third component of the cache key. Bumping it invalidates the cache (§3.7). |
| `TRYON_TIMEOUT_MS` | api | — | `20000` | Per-attempt upstream timeout (E-11). |
| `TRYON_MAX_ATTEMPTS` | api | — | `3` | Retry ceiling (§8.3). |
| `TRYON_BACKOFF_BASE_MS` | api | — | `800` | Exponential backoff base. |
| `TRYON_TEST_RENDER_CONCURRENCY` | api | — | `1` | Bulk test renders never compete with a live generation (§8.2). |
| `TRYON_MOCK_LATENCY_MS` | api | — | `7000` | Mock driver latency, so the wait UI is exercised honestly. |
| `TRYON_MOCK_FAILURE_RATE` | api | — | `0` | `0`–`1`; used by E-6 to walk the failure taxonomy. |
| `EMAIL_DRIVER` | api | ✔ | `console` | `console \| smtp`. |
| `EMAIL_FROM` | api | ✔ | `Drape <hello@example.com>` | From header. |
| `SMTP_HOST` / `SMTP_PORT` | api | if `smtp` | `smtp.example.com` / `587` | SMTP transport. |
| `SMTP_USER` / `SMTP_PASSWORD` | api | if `smtp` | — | SMTP credentials. |
| `SMTP_SECURE` | api | — | `false` | Implicit TLS. |
| `SMS_DRIVER` | api | ✔ | `console` | `console \| http` (regional SMS gateway). |
| `SMS_HTTP_URL` | api | if `http` | `https://sms.example.pk/send` | SMS gateway endpoint. |
| `SMS_HTTP_API_KEY` | api | if `http` | — | SMS gateway credential. |
| `SMS_SENDER_ID` | api | if `http` | `DRAPE` | Sender id. |
| `OTP_TTL_SECONDS` | api | — | `600` | Phone OTP lifetime (C-3). |
| `PASSWORD_RESET_TTL_MINUTES` | api | — | `30` | Reset link lifetime (S-6). |
| `EMAIL_VERIFY_TTL_HOURS` | api | — | `24` | Verification link lifetime. |
| `INVITE_TTL_DAYS` | api | — | `7` | Admin invite lifetime (S-5). |
| `THROTTLE_TTL_SECONDS` | api | — | `60` | Global throttle window. |
| `THROTTLE_LIMIT` | api | — | `100` | Global throttle limit. |
| `TRYON_RATE_PER_HOUR` | api | — | `20` | Per-account generation ceiling above quota (C-6). |
| `TRYON_RATE_PER_IP_HOUR` | api | — | `40` | Per-IP generation ceiling (C-6). |
| `LOGIN_LOCKOUT_THRESHOLD` | api | — | `5` | Failures before lockout (S-6). |
| `LOGIN_LOCKOUT_MAX_MINUTES` | api | — | `60` | Backoff ceiling. |
| `QUOTA_DEFAULT_MONTHLY` | api | — | `15` | Seed value for `settings['quota.defaultMonthly']` (A-28, C-5). |
| `BUDGET_DEFAULT_MONTHLY` | api | — | `2000` | Seed value for `settings['budget.monthlyGenerations']` (A-29). |
| `BUDGET_WARN_PERCENT` | api | — | `80` | Soft warning threshold (A-29, E-14). |
| `PHOTO_RETENTION_DAYS` | api | — | `30` | Photo purge after last account activity (§9.3). |
| `JOB_RETENTION_DAYS` | api | — | `90` | `tryon_jobs` pruning window. |
| `DELETION_SLA_HOURS` | api | — | `24` | Consumer-initiated deletion SLA (C-38, A-20). |
| `TIMEZONE` | api | — | `Asia/Karachi` | Cron schedules and the ledger `period` boundary. |
| `SEED_ADMIN_EMAIL` | api | ✔ (seed) | `admin@example.com` | First admin (E-4, S-5). |
| `SEED_ADMIN_PASSWORD` | api | ✔ (seed) | — | First admin password. Rotated immediately after the first login. |
| `SEED_ADMIN_NAME` | api | ✔ (seed) | `Studio Admin` | First admin name. |
| `NEXT_PUBLIC_API_BASE_URL` | web | ✔ | `http://localhost:4000/api/v1` | Browser → API base (B-9). |
| `API_INTERNAL_URL` | web | — | `http://localhost:4000/api/v1` | Server-side base for cookie-forwarded fetches; falls back to the public one. |
| `NEXT_PUBLIC_SITE_URL` | web | ✔ | `http://localhost:3000` | Canonical URLs, Open Graph, share links. |
| `NEXT_PUBLIC_APP_ENV` | web | ✔ | `development` | `development \| staging \| production` (E-1). |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | web | — | `en` | Fallback when negotiation finds nothing. |
| `NEXT_PUBLIC_ENABLE_QUERY_DEVTOOLS` | web | — | `true` | TanStack devtools, non-production only. |

**The web service holds no TryOnCloud key, no database URL and no session secret** (B-1, B-2, B-3).
If a variable would give the web app a business decision or an upstream credential, it belongs in the
API instead.

---

## 8. Cross-cutting checklists

Tick every applicable line **before** calling a feature done. These are not a milestone-8 sweep —
milestone 8 verifies them, it does not create them.

### 8.1 Definition of done (PRD §11.5)

- [ ] Every applicable D-5 state implemented (§8.2 below).
- [ ] Server-side authorisation on every route and mutation, **with a test** (S-11, E-7).
- [ ] Object-level ownership checked in the service for every photo, render, job, shortlist item,
      share link and enquiry — with a cross-account test asserting the masked 404 (§9.2).
- [ ] Every error path mapped to an `ErrorCode` and to user-facing copy from §2.4. No screen shows a
      raw status code, a stack trace or an untranslated string.
- [ ] Metrics emitted (E-13): latency, failure rate by error code, cache hit rate, quota consumption,
      budget burn, funnel step.
- [ ] Structured logs carry the request id; no photo URL, storage key, token or personal data appears
      in any log line (E-12).
- [ ] Responsive verified at **360 px**, 768 px and 1280 px (D-9). No horizontal scroll at 360 px.
- [ ] Keyboard verified: full traversal, visible focus, Escape closes, focus returns to the trigger.
- [ ] Screen-reader verified: semantic headings, one `<h1>`, labelled controls, alt text on every
      render and catalog image, `aria-live` on async status changes (D-20).
- [ ] Touch targets ≥ 44 × 44 px (D-10). Hover, active, focus and disabled states all defined.
- [ ] Contrast validated against the tokens; `contrast.spec.ts` green (D-20).
- [ ] `prefers-reduced-motion` respected (D-11).
- [ ] Copy passes the §9.4 shortlisting check (§8.3 below) and the §10.5 standards.
- [ ] Both locales present: `en` and `ur` keys exist, and the screen was viewed in `ur` with
      `dir="rtl"` at 360 px (C-41).
- [ ] CLS below 0.1 on catalog and result screens; skeletons match the content aspect ratio (D-8).
- [ ] Typecheck, lint, unit tests, integration tests and build green for both services; the OpenAPI
      contract check passes; the route-guard check passes (E-16, B-4, B-5).

### 8.2 Required states (D-5)

Every screen ships all applicable states. A screen with only its default state is incomplete.

| State | What it must do | Verified |
| --- | --- | :-: |
| **Default** | The populated, working screen. | ☐ |
| **Loading** | Skeleton matching the real content's aspect ratio and layout — never a bare spinner on a full screen. Long operations (the 7-second wait) get staged, progressing microcopy the user can navigate away from (§10.3). | ☐ |
| **Empty** | Directs the user to the next action, never reports emptiness. "Add your first piece" with the button, not "No garments found". A consumer with no shortlist sees how to start (D-6). | ☐ |
| **Error** | States what happened and what to do next, in the interface's voice. Does not apologise, does not blame the user, is never vague. Offers the retry or the alternative path (D-7). | ☐ |
| **Permission denied** | The S-9 no-access screen: plain language, a link back to the fitting room. Never a raw 403, never a redirect that reveals whether the resource exists. | ☐ |
| **Success** | Confirms in the same words as the action that caused it — the control that says Publish confirms Published (D-13). Includes the undo or next step where one exists. | ☐ |

Additional per-surface states that are easy to forget:

- **Offline / network failure** — `NETWORK_ERROR` with a retry, on any screen that mutates.
- **Quota exhausted** — presents the shortlist and the enquiry action. Never a dead end (§10.3).
- **Budget exhausted** — catalog stays browsable; the message says we'll email when it's back.
- **Consent required / stale** — the hard gate, nothing pre-checked, no visual pressure (C-11).
- **Garment no longer available** — history item labelled, try-on action hidden, render unaffected (C-29).
- **Partial bulk failure** — per-item outcome plus a summary of successes and failures (D-16).
- **Optimistic rollback** — the catalog edit reverts with a clear message on failure (D-18).

### 8.3 Copy check (PRD §9.4 + §10.5)

Run this on **every consumer-facing string** before it ships — button labels, headings, empty states,
error messages, toasts, emails, SMS, alt text and meta descriptions.

1. **Does it promise accuracy?** → rewrite. ("See exactly how it fits" → "See how it might sit.")
2. **Does it frame the render as final rather than indicative?** → rewrite. ("Your look" → "Your
   try-on".)
3. **Does it say "see yourself in" or equivalent?** → rewrite. ("See yourself in this lehenga" →
   "Try this lehenga on".)
4. **Is the shortlisting purpose clear?** → **required**, not optional.

Plus §10.5:

5. Active voice, sentence case, plain verbs, no filler.
6. The control names what happens when used, and keeps the same name across the flow —
   Publish → Published, Delete → Deleted (D-13).
7. Things are named by what the user controls, not by how the system is built — "Your photos", not
   "Person photo entities"; "Try-ons left this month", not "Quota balance" (D-14).
8. Error copy states what happened **and** what to do next (D-7).
9. Both `en` and `ur` values written by the same author in the same pass. Urdu is not a
   machine-translated afterthought.

**Non-negotiable string:** the result view carries a persistent, non-dismissible caption stating that
this is an approximate guide for shortlisting, and that fabric fall, embroidery detail and length will
differ in person (C-20). It is a component (`ShortlistingCaption`), not a per-screen string, so it can
never be omitted or reworded on one screen.

---

## 9. Open items

These are known and deliberately deferred. Nothing below blocks milestone 0–8.

| Item | Decision |
| --- | --- |
| CDN with on-the-fly resizing (§9.1, §13.1) | Not in V1. Pre-generated `webp` variants at three widths plus `Cache-Control` cover the requirement locally. The S3 driver and a CDN land together, behind the same `StorageDriver` interface. |
| Traffic spikes of 50× baseline (§9.1) | Addressed by the cache, thumbnails and pagination. Horizontal scaling of the API container is an infrastructure task, not a code change — the app is stateless apart from SSE connections. |
| Daily backup and tested restore (E-15) | Documented in `docs/RUNBOOK.md`; not executable in this environment (no Docker, no local Postgres). |
| Live database verification | Migrations and integration tests are written and wired. In this environment the executable verification is typecheck, lint, build, and unit/contract tests that stub the data layer. |
| PRD §10.3 cross-references | The v5.0 table cites C-27/C-28/C-19/C-21; the intended targets are C-19 (the wait), C-20 (the reveal), C-11 (consent) and C-13 (photo guidance). Implementation follows the intent. |
