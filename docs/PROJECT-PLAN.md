# Drape — Delivery Plan

Derived from `PRD-drape-v1.md` (v5.0). Senior-TPM breakdown into workstreams, tasks and sub-tasks.
Every task runs the cycle: **plan → architect → develop → review + test → apply patches**.

---

## 0. Locked decisions

The user is unavailable during delivery, so these are decided and recorded here rather than asked.

| Decision | Choice | Rationale |
|---|---|---|
| Backend layout | NestJS monorepo, **one** deployable app `apps/api` + `libs/*` | PRD §13.1 defines exactly two services (Web, API). §8.2 states no external queue in V1, so **no RabbitMQ**. The skill's monorepo/libs/feature-module conventions are kept. |
| ORM | TypeORM, migrations only, `synchronize: false` | User directive + E-3 |
| DB | PostgreSQL | PRD §13.1 |
| Image storage | **Local disk outside the project**, root from `STORAGE_ROOT` env (default `../drape-storage` resolved to an absolute path outside the repo). DB stores the relative **storage key**; access via short-lived signed URLs issued by the API. | User directive + PRD §9.2 (short-lived pre-signed URLs scoped to owner) |
| Frontend layout | Turborepo + **npm workspaces** (pnpm not installed), `apps/web` single app + `packages/*` | PRD S-2: one `/login`, one `/dashboard` for both roles → one app, two shells |
| Component library | shadcn/ui atoms in `packages/ui` | Skill default |
| State | Zustand (`packages/store`) | Skill default |
| Data fetching | Axios + TanStack Query (`packages/api-client`) | Skill default |
| Dropdowns | shadcn `Select` (no React Select) | Fewer deps; RTL/a11y control needed for C-41 |
| Theming | CSS-variable tokens in `packages/ui`, brand overrides (logo, primary color) fetched from `GET /api/v1/settings/brand` | D-1, A-27 |
| Auth | **Custom server-side sessions**, httpOnly `SameSite=Lax` cookie on parent domain, CSRF double-submit. No NextAuth. | B-6, B-8 |
| TryOnCloud | Pluggable provider behind `TryOnProvider` interface. `TRYON_DRIVER=mock\|http`. Default `mock` in local/CI so the 10-image upstream cap is never burned by tests. | User note "TryOnCloud has a 10 image limit"; keeps §14 validation cheap and the code extensible |
| Email / SMS | Provider interface with `console` driver for local, SMTP + generic SMS HTTP driver for staging/prod | §13.1 |

### Storage layout (outside the project)

```
<STORAGE_ROOT>/                     # e.g. D:\drape-storage  (NOT inside the repo)
├── garments/<garmentId>/<uuid>.<ext>
├── categories/<categoryId>/<uuid>.<ext>
├── person-photos/<userId>/<uuid>.<ext>
├── renders/<userId>/<uuid>.png
├── thumbnails/<kind>/<uuid>.webp
├── reference-models/<uuid>.jpg     # seeded, used by the A-11 test-render gate
└── brand/<uuid>.<ext>
```
DB columns hold the key (`renders/<userId>/<uuid>.png`), never an absolute path — so the root can move between environments.

---

## 1. Workstream map

| WS | Title | PRD coverage | Depends on |
|---|---|---|---|
| **W0** | Foundation: scaffolds, tokens, libs, data model, contract | E-1…E-4, B-4, D-1, D-2, §12 | — |
| **W1** | Identity: sessions, CSRF, login/signup, roles, role-aware dashboard | S-1…S-11, A-2, C-2…C-4, C-7 | W0 |
| **W2** | Catalog admin: categories, garments, images, quality validator | A-4…A-10, A-13, A-14 | W1 |
| **W3** | Try-on engine: guard chain, cache, jobs, SSE, test-render gate | §8.1, §8.2, A-11, A-12, E-5, E-6 | W2 |
| **W4** | Consumer experience: consent, photo, browse, try-on, result, history | C-1, C-8…C-31 | W3 |
| **W5** | Economics: quota, budget, rate limits, verification, failure taxonomy | C-5, C-6, A-18, A-28, A-29, §8.3, §8.4 | W3 |
| **W6** | Engagement: shortlist, share, enquiries, admin inbox, consumer mgmt | C-32…C-36, A-16…A-26 | W4, W5 |
| **W7** | Operations: analytics, catalog health, moderation, purge, audit, alerts | A-3, A-33…A-39, §9.3, E-13, E-14, E-17 | W6 |
| **W8** | Polish: state completeness, copy review, a11y, en/ur + RTL | D-5…D-20, §9.4, §9.5, C-41 | W7 |
| **W9** | Hardening: `/simplify`, `/code-review`, `/security-review`, full build | §11.5 | W8 |

---

## 2. Task breakdown

### W0 — Foundation
- **T0.1** Backend scaffold — `nest-cli.json`, tsconfigs with `@library/*` aliases, `package.json`, `.env.example`, `docker-compose.yml`, jest config
- **T0.2** `libs/common` — exceptions + error codes, response envelope interceptor, exception filter, pagination DTOs, decorators (`@Public`, `@Roles`, `@CurrentUser`, `@ResponseMessage`, `@Csrf`), request-id middleware, structured logger
- **T0.3** `libs/database` — `BaseEntity`, TypeORM data source, migration tooling
- **T0.4** `libs/storage` — `StorageService` (local-disk driver, outside-project root, signed URL token issue/verify, thumbnailing via sharp)
- **T0.5** `libs/notifications` — email + SMS provider interfaces, console/SMTP drivers, templates
- **T0.6** Domain entities — all 20 tables from PRD §12 + `sessions`, split across owning feature modules; initial migration
- **T0.7** Frontend scaffold — turbo, npm workspaces, `packages/config-{typescript,eslint,tailwind}`, `packages/utils`
- **T0.8** Design system — tokens (color/type/space/radii/shadow), two typefaces, `packages/ui` atoms, ThemeProvider, RTL support
- **T0.9** `packages/api-client` — axios instance, interceptors, query client, DTO types, query keys
- **T0.10** `packages/store` — auth/ui Zustand stores
- **T0.11** `apps/web` shell — App Router, providers, error/loading/not-found, middleware
- **T0.12** Seed script — first admin, reference model photos, default settings, sample categories

### W1 — Identity
- **T1.1** Sessions + CSRF (server-side session store, cookie config, double-submit)
- **T1.2** Auth module — signup (consumer-only, role in payload ignored+logged), login, logout, `/auth/me`, lockout + backoff, generic responses
- **T1.3** Password reset — single-use token, 30 min TTL
- **T1.4** Email verification + phone OTP
- **T1.5** ~~2FA (TOTP)~~ — dropped. S-8 now specifies email and password as the only credentials, for both roles.
- **T1.6** Invites — admin-only, single-use emailed token
- **T1.7** Guards — `SessionGuard`, `RolesGuard`, `CsrfGuard`, `ThrottlerGuard`; CI check that every route declares a role
- **T1.8** Users/admin management — invite, change role, deactivate (revokes sessions)
- **T1.9** Web: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`
- **T1.10** Web: role-aware `/dashboard` (server-resolved shell), no-access screen (S-9), account settings
- **T1.11** Authorisation test harness + tests for every admin route (E-7)

### W2 — Catalog admin
- **T2.1** Categories module — CRUD, reorder, archive, one-level sub-categories, cover image, delete-guard
- **T2.2** Garments module — CRUD, publish state machine, search/filter/sort
- **T2.3** Garment images — multi-upload, try-on source designation, gallery ordering
- **T2.4** Image quality validator — long edge, dominant garment, background uniformity, aspect band, format; score + remediation; override logging
- **T2.5** Admin console layout language (dense/tabular) + shell nav
- **T2.6** Web: categories manager, garment list, garment editor, uploader with per-file progress
- **T2.7** Bulk actions + cost estimate confirm (A-12)
- **T2.8** Catalog health panel (A-15)

### W3 — Try-on engine
- **T3.1** `TryOnProvider` abstraction + mock and http drivers, timeout/retry/typed errors
- **T3.2** Guard chain (§8.1 step 3) as composable, unit-tested predicates
- **T3.3** Cache — `sha256(garment_source_hash + person_photo_hash + api_version)`
- **T3.4** Jobs — `tryon_jobs` lifecycle, idempotency keys, attempts
- **T3.5** Results — `tryon_results` persistence, thumbnails, watermarking
- **T3.6** SSE delivery + polling fallback
- **T3.7** Test-render gate — reference model, approve/reject, publish blocker + E-10 test
- **T3.8** Bulk test-render processor at concurrency 1
- **T3.9** Failure taxonomy mapping (§8.3) to error codes + copy
- **T3.10** Structured logging, request-id propagation, metrics

### W4 — Consumer experience
- **T4.1** Consent module — versioned policy, hard gate, re-consent
- **T4.2** Person photos — direct-to-storage upload ticket, EXIF strip, multiple photos, active selection, cache retirement
- **T4.3** Public catalog API — browse, search, filters, garment detail (no auth)
- **T4.4** Web: consent gate, photo guidance (illustrated), client-side validation, uploader
- **T4.5** Web: browse grid, filters, garment detail, Try it on
- **T4.6** Web: the 7-second wait (staged), result reveal, compare, zoom, caption, verdicts, reject reasons
- **T4.7** Web: results tray + inline notification while browsing
- **T4.8** History — API + UI, filters, grouping by photo, individual delete, download set
- **T4.9** Consumer dashboard landing (C-8) + persistent nav

### W5 — Economics
- **T5.1** Quota ledger — append-only, derived balance, monthly period, overrides
- **T5.2** Usage ledger — system budget, 80% warn / 100% hard stop
- **T5.3** Settings module — brand basics, quotas, toggles, preview mode, QR + short link
- **T5.4** Rate limits — per-hour, per-IP, login/signup/reset/OTP/generation
- **T5.5** Web: quota counter, exhaustion screens, budget-exhausted screen
- **T5.6** Integration tests across every failure-taxonomy branch (E-6)

### W6 — Engagement
- **T6.1** Shortlist — drag-to-rank, notes, budget total, cross-device
- **T6.2** Share links — revocable, 30-day expiry, public voting view, one comment per item
- **T6.3** Enquiries — submit, statuses, lost reason, internal notes, WhatsApp deep link, CSV export, notifications
- **T6.4** Admin inbox UI + 24h stale highlight
- **T6.5** Consumer management — list, detail (photo never shown), quota override, suspend, delete
- **T6.6** Web: shortlist, share, enquiry flows + enquiry history

### W7 — Operations
- **T7.1** Audit log — append-only, filterable, written by all mutating flows
- **T7.2** Moderation queue — blurred thumbs, admin-only, every view audited
- **T7.3** Abuse view — rate-limit hits, suspension, IP block
- **T7.4** Analytics — funnel, leaderboard, rejection rollup, category perf, activity heatmap
- **T7.5** Purge job — photo 30-day purge, deletion log, 24h consumer deletion
- **T7.6** Alerting + runbook + backup procedure
- **T7.7** Data controls screen + export archive (C-37…C-40)

### W8 — Polish
- **T8.1** State completeness sweep (default/loading/empty/error/denied/success) on every screen
- **T8.2** Copy review against §9.4 shortlisting-language check + §10.5
- **T8.3** Accessibility audit — WCAG 2.1 AA, keyboard, focus, alt text, contrast
- **T8.4** i18n — English + Urdu, full RTL
- **T8.5** Responsive verification from 360px; reduced-motion

### W9 — Hardening
- **T9.1** Full typecheck + lint + test + build, both services
- **T9.2** `/simplify`
- **T9.3** `/code-review`
- **T9.4** `/security-review`
- **T9.5** Final patch application + README/runbook

---

## 3. Definition of done (per §11.5)

A task is done when it has: all applicable D-5 states, server-side authorisation with a test,
error handling mapped to user-facing copy, metrics emitted, 360px responsive verified,
keyboard/SR access verified, and copy passing §9.4 and §10.5.

---

## 4. Known environment constraints

- No local PostgreSQL and no Docker daemon on this machine. Migrations and integration
  tests that need a live DB are written and wired, but the executable verification in this
  environment is limited to typecheck, lint, build and unit/contract tests that stub the
  data layer. `docker-compose.yml` and `README` document the one-command DB bring-up.
- `docs/PRD-drape-v1.md` §10.3 cross-references (C-27/C-28/C-19/C-21) drift from the v5.0
  numbering; the intended targets are C-19 (wait), C-20 (reveal), C-11 (consent), C-13
  (photo guidance). Implementation follows the intent.
