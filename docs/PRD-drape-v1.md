# Product Requirements Document — Virtual Fitting Room

**Working name:** Drape
**Version:** 5.0 — final scope
**Date:** August 2026

---

## 1. Overview

A virtual fitting room for a single formalwear brand, built on the TryOnCloud API.

A Next.js web client and a NestJS API service. One login, one dashboard route that renders one of two experiences based on the signed-in user's role:

- **Admin** — uploads garment images, organises them into categories, controls what is published, handles enquiries.
- **Consumer** — uploads a photo of herself, browses the catalog, and sees garments rendered on her own body.

---

## 2. Scope

### In scope

| Area | Included |
|---|---|
| Shared | Login, signup (Consumer only), role-aware dashboard, password reset, email and phone verification |
| Admin | Categories, garment upload, image quality validation, test renders, publish control, consumer management, enquiries, settings, usage, moderation, analytics |
| Consumer | Profile, browse, consent, photo upload, try-on, compare, shortlist, share, enquiry, own-data controls |
| Quality | Design system and required screen states, engineering standards for testing, observability and delivery |

### Out of scope

- Multi-tenancy or brand signup
- Billing, subscriptions, payments
- Appointments or scheduling
- Ecommerce, cart, checkout
- Native mobile apps
- Size recommendation or body measurement
- Social login

---

## 3. Success metrics

| Metric | Definition | Target |
|---|---|---|
| Signup completion | Accounts created / signup starts | 60% |
| Try-on activation | Accounts with ≥1 generation / accounts created | 65% |
| Generations per active consumer | Median per month | 8–15 |
| Enquiry rate | Accounts submitting an enquiry / active accounts | 15% |
| Cost per enquiry | Generation spend / enquiries | under $4 |
| Return rate | Consumers active in a second week | 35% |
| Generation failure rate | Jobs ending in error | under 4% |
| Catalog health | Published garments with an approved test render | 100% |

---

## 4. Roles

Two roles exist. Every authenticated user is one or the other, stored as a single enum column.

**Admin** — brand staff. Never self-registered: the first is seeded at deployment, the rest are created by invitation from an existing Admin.

**Consumer** — self-registers at `/signup`.

---

## 5. Authentication, roles and routing

- **S-1** One login page at `/login` serving both roles. The user does not choose a role and is never asked which kind of account they hold.
- **S-2** One dashboard route at `/dashboard` in the Web service. After authentication the role is resolved server-side and either the Admin console or the Consumer fitting room renders. The URL is identical for both.
- **S-3** The role is resolved server-side from the session on every request, and the API service is the sole authority. It is never read from a client-supplied parameter, header, query string, or any claim the client can influence. Role resolution in the Web service selects which interface to render and is never an authorisation decision.
- **S-4** `/signup` creates Consumer accounts only. No code path allows this route to produce an Admin. A role passed in the signup payload is ignored and logged.
- **S-5** Admin accounts are created only by the deployment seed script or by invitation from an existing Admin, accepted through a single-use emailed token.
- **S-6** Shared authentication behavior: Argon2 password hashing; password reset by single-use emailed token expiring in 30 minutes; generic responses on reset and login so the forms cannot enumerate accounts; rate limiting by email and by IP; lockout with exponential backoff after repeated failures.
- **S-7** Session duration: Admin 12 hours of inactivity, Consumer 30 days.
- **S-8** 2FA mandatory for Admin, optional for Consumer.
- **S-9** A Consumer requesting an Admin URL receives a clear no-access screen with a link back to the fitting room — never a raw 403, and never a redirect that reveals whether the resource exists.
- **S-10** Admins cannot view consumer photos. They see renders only where a consumer has submitted an enquiry, plus blurred thumbnails in the moderation queue. Enforced in the query layer and covered by test.
- **S-11** Authorisation is enforced server-side on every route and mutation. Every Admin-only route carries an authorisation test.

### Permission matrix

| Capability | Admin | Consumer |
|---|:---:|:---:|
| Log in at `/login` | ✅ | ✅ |
| Self-register at `/signup` | ❌ | ✅ |
| Create / edit garments, upload images | ✅ | ❌ |
| Run test renders | ✅ | ❌ |
| Publish / unpublish garments | ✅ | ❌ |
| Create / reorder / archive categories | ✅ | ❌ |
| Delete garments and images | ✅ | ❌ |
| Browse the published catalog | ✅ | ✅ |
| Upload own photo | ❌ | ✅ |
| Generate try-ons on own photo | ❌ | ✅ |
| Keep and share a shortlist | ❌ | ✅ |
| Submit an enquiry | ❌ | ✅ |
| View and reply to enquiries | ✅ | own only |
| View another consumer's photos or renders | ❌ | ❌ |
| View consumer list and account status | ✅ | ❌ |
| Adjust generation quotas | ✅ | ❌ |
| Review the moderation queue | ✅ | ❌ |
| Suspend a consumer account | ✅ | ❌ |
| Delete own account and all data | ✅ | ✅ |
| Delete a consumer's account and data | ✅ | ❌ |
| Change brand settings and system config | ✅ | ❌ |
| View the audit log | ✅ | ❌ |
| View analytics | ✅ | ❌ |

---

## 6. Admin requirements

### 6.1 Dashboard and account management

- **A-1** Admin landing view on `/dashboard`: new enquiries awaiting reply, generations used against the monthly budget, garments waiting on an approved test render, and items flagged for review.
- **A-2** Admin management: invite by email, change role, deactivate. Deactivation is immediate and revokes live sessions. Accounts are deactivated, never hard-deleted.
- **A-3** Audit log of catalog changes, publishes, deletions, role changes, quota changes, consumer suspensions, moderation queue views and settings changes. Append-only, filterable by actor, action and date.

### 6.2 Categories

- **A-4** Create, rename, reorder and archive categories. Examples: Bridal Lehenga, Sharara, Gharara, Saree, Anarkali, Walima, Mehndi, Nikkah, Groom.
- **A-5** Optional sub-categories, one level deep.
- **A-6** Each category has a display name, cover image and sort position. Ordering drives the consumer browse screen.
- **A-7** A category holding published garments cannot be deleted, only archived.

### 6.3 Garment upload and management

- **A-8** Create a garment with: title, SKU, category, colors, fabric, embellishment weight (light / medium / heavy), price, rental or sale, deposit if rental, description, sizes available.
- **A-9** Upload multiple images per garment by drag-and-drop with per-file progress. One image is designated the **try-on source** — the file sent upstream as `garment_image`. The rest form the gallery.
- **A-10** Image quality validation on upload of a try-on source, producing a score and specific remediation guidance:
  - minimum 2000px on the long edge
  - single dominant garment detected
  - background uniformity
  - aspect ratio within band
  - accepted format — HEIC, WebP, PNG, JPEG
  Below threshold the garment is marked **Needs a better photo**. This does **not** stop it being published: the score and every failed check are shown with their remediation guidance, and publishing proceeds regardless. Whatever was outstanding is written into the `GARMENT_PUBLISHED` audit row. (Superseded: this previously required an explicit logged override before publishing.)
- **A-11** **Test render.** Before publishing, an Admin runs one try-on against a built-in reference model photo. The result is shown beside the source image for approval and stored on the garment. Publishing without an approved test render is **advised against and recorded, not prevented** — the admin decides. (Superseded: this was a hard gate, "no garment reaches the consumer catalog without an approved test render".)
- **A-12** Bulk actions: publish, unpublish, re-categorise, archive, and run test renders across a selection with a cost estimate shown and confirmed before it runs.
- **A-13** Publish states: draft / published / archived. Archived garments retain analytics history.
- **A-14** Catalog list with search, category filter, publish-state filter, and sort by newest, most tried, or highest star rate.
- **A-15** Catalog health panel: garments missing an approved test render, low quality scores, elevated generation failure rates, and zero try-ons in 30 days.

### 6.4 Consumer management

- **A-16** Consumer list: name, email, phone, signup date, last active, generations used this month, shortlist size, enquiry count, account status.
- **A-17** Consumer detail: profile fields, enquiry history, shortlisted garments. Her uploaded photo is never shown; renders appear only where she has submitted an enquiry.
- **A-18** Per-consumer quota override.
- **A-19** Suspend an account with a required reason. Suspension blocks generation and enquiry but preserves data pending review.
- **A-20** Delete a consumer and all associated photos, renders and shortlists. Completes within 24 hours with a confirmation record.

### 6.5 Enquiries

- **A-21** An enquiry contains: consumer name, verified contact details, event date, event type, budget band, shortlisted garments in her rank order with their renders, per-item notes, and her message.
- **A-22** Statuses: new → contacted → in discussion → closed won → closed lost, with a required reason on lost.
- **A-23** One-tap WhatsApp reply opening a thread pre-filled with her name and top pieces.
- **A-24** Internal notes per enquiry, visible only to Admins.
- **A-25** Notification on new enquiry by email and in-app. Enquiries untouched after 24 hours are highlighted.
- **A-26** CSV export.

### 6.6 Settings

- **A-27** Brand basics: logo, primary color, brand name, WhatsApp number, Instagram handle, store addresses, contact email.
- **A-28** Default monthly generation quota per consumer (default 15), and whether email verification is required before the first generation (default yes).
- **A-29** Monthly system-wide generation budget, with a soft warning at 80% and a hard stop at 100%. On hard stop the catalog stays browsable and consumers see a clear message.
- **A-30** Toggles: show prices publicly, enable sharing, enable enquiries.
- **A-31** Preview mode — view the consumer experience without spending generations.
- **A-32** QR code generator for in-store signage, plus a copyable short link for the Instagram bio.

### 6.7 Usage, moderation and analytics

- **A-33** Usage dashboard: generations this month, remaining budget, projected exhaustion from a 7-day trailing rate, split between consumer try-ons and admin test renders, plus cache hits versus billed calls.
- **A-34** Moderation queue for consumer photos flagged upstream or by internal heuristics. Blocked pending review, shown blurred, Admin only, every view audit-logged.
- **A-35** Abuse view: accounts hitting rate limits or repeated failures, with manual suspension and device or IP blocking.
- **A-36** Funnel: signups → email verified → photo uploaded → first try-on → ≥1 star → enquiry.
- **A-37** Garment leaderboard: most tried, star rate, reject rate, enquiry rate.
- **A-38** Rejection reasons rollup by neckline, color, weight, silhouette and price.
- **A-39** Category performance, and activity by hour and day.

---

## 7. Consumer requirements

Mobile-first, targeting a mid-range Android on mobile data.

### 7.1 Account and access

- **C-1** Browsing is public. Catalog, categories, search, filters and garment detail are reachable while signed out. Only actions involving her photo require an account.
- **C-2** Signup requires name, email, password and phone. Event date, event type and budget band are optional and prompted later in context.
- **C-3** Email verification required before the first generation (configurable per A-28). Phone verification by OTP required before submitting an enquiry.
- **C-4** Login at the shared `/login`. On success she lands on `/dashboard`, which renders the fitting room for her role.
- **C-5** Monthly generation quota per account, default 15, shown as a persistent counter. Resets monthly; raisable for an individual by an Admin.
- **C-6** Per-hour and per-IP rate limits apply independently of quota.
- **C-7** Account settings: update profile, change password, enable 2FA, manage notification preferences.

### 7.2 Consumer dashboard

- **C-8** Landing shows photo status, remaining generations this month, shortlist, recent renders, and new arrivals in her preferred categories.
- **C-9** Persistent navigation: Browse, Shortlist, My Renders, Account.
- **C-10** **History** — every try-on she has generated, always available without regenerating. Detailed in §7.5.

### 7.3 Consent and photo

- **C-11** Consent screen at first photo upload — a hard gate, nothing pre-checked, not skippable. States plainly:
  - the photo is used only to generate try-on images for her
  - the processing provider deletes the uploaded photo immediately after generating the result and does not use it for training
  - how long the brand retains her photo and renders
  - that brand staff cannot see her photo, and see her renders only if she submits an enquiry
  - a **Delete my photo and results** control, reachable from every screen afterwards
- **C-12** Consent stored with timestamp, IP, user agent and policy version. Re-consent required when the policy version changes.
- **C-13** Guidance before the picker: full body, front facing, plain background, fitted clothing, good light, phone at chest height. Illustrated with diagrams, not photographs of real people.
- **C-14** Client-side validation before upload: resolution, full-body framing heuristic, blur detection, single subject. Rejections are specific and actionable.
- **C-15** Client-side compression and EXIF stripping. Upload goes directly to storage via a pre-signed URL, never through the app server.
- **C-16** She may hold multiple saved photos and choose which is active. Replacing or removing a photo retires its cache entries, so a future try-on of the same garment generates afresh against the new photo. Renders already produced from that photo stay in her history per C-28.

### 7.4 Browse and try-on

- **C-17** Browse by category, then a grid filtered by color, price band, embellishment weight and size. Search across title, category, color and style tags.
- **C-18** Garment detail: gallery, price, fabric, sizes, and a single prominent **Try it on**.
- **C-19** Loading state covering the roughly 7-second processing window with staged microcopy. She can keep browsing; results collect in a tray and notify inline.
- **C-20** Result view:
  - render full-bleed, pinch to zoom
  - **Compare** toggle between catalog photo and render
  - a persistent, non-dismissible caption stating this is an approximate guide for shortlisting, and that fabric fall, embroidery detail and length will differ in person
  - verdicts: **Love it** / **Maybe** / **Not for me**
- **C-21** "Not for me" optionally captures a one-tap reason — neckline, color, too heavy, silhouette, price.
- **C-22** Re-running the same garment on the same photo serves from cache and consumes no quota.
- **C-23** Downloads carry a discreet brand watermark.

### 7.5 Try-on history

- **C-24** Every successful generation is stored permanently against her account and appears in **History** automatically. She takes no action to save a result.
- **C-25** History lists renders newest first, each showing the render thumbnail beside the catalog image, the garment name, category, price, generation date and her verdict. Filterable by verdict and category, searchable by garment name.
- **C-26** Opening a history item shows the full render with the same compare toggle, zoom, caption and verdict controls as the original result view. Viewing costs nothing: no regeneration, no quota consumed, no photo re-upload.
- **C-27** **Renders persist for the life of the account.** They are not subject to a time-based purge and are removed only when she deletes them individually or deletes her account.
- **C-28** A render survives deletion or replacement of the photo it was generated from. The render is a separate derived artifact, and her history remains intact after she removes the source photo.
- **C-29** A render remains in history when the garment is later unpublished, archived or removed from the catalog. Where the garment is no longer available the item is labelled as such and the try-on action is hidden, but her stored render is unaffected.
- **C-30** Where she has used more than one photo, history can be grouped by photo so she can compare how a piece looked against each.
- **C-31** She can delete individual renders. Deletion is permanent and the confirmation says so.

Renders are downloadable individually or as a set, watermarked per C-23, and included in the data export in C-39.

### 7.6 Shortlist, share, enquire

- **C-32** Shortlist with drag-to-rank, per-item notes, and a running total against her stated budget. Persists across devices.
- **C-33** Share link requiring no account from recipients. They see only the renders on that shortlist, react (heart / unsure / no), and leave one comment per item. They cannot see her photo, her other renders, or her contact details.
- **C-34** Share links are revocable by her at any time and expire after 30 days.
- **C-35** Enquiry: shortlist plus event date, event type, budget band and a message, with profile details pre-filled. Confirmation sets a response expectation and offers a direct WhatsApp thread.
- **C-36** Enquiry history with current status.

### 7.7 Data controls

- **C-37** A single screen showing everything stored about her: profile, photos, renders, shortlists, enquiries, and the consent she granted with its date.
- **C-38** Without contacting anyone she can replace or delete a photo, delete individual renders, revoke share links, and delete her account entirely with all photos, renders and shortlists. Deletion is immediate from her view and completes in the backend within 24 hours.
- **C-39** Data export of her own shortlists and renders as a downloadable archive.
- **C-40** These controls are reachable from the account menu on every screen.

### 7.8 Localization

- **C-41** English and Urdu with full RTL layout.

---

## 8. Integration design

### 8.1 Request path

Neither the browser nor the Next.js Web service ever calls TryOnCloud. The API key exists only in the NestJS API service environment.

1. Browser posts `{garment_id, idempotency_key}` to `POST /api/v1/tryon` on the API service, with the session cookie and CSRF token. The photo is referenced by stored ID, never re-uploaded.
2. A NestJS guard resolves the session to a user and asserts the role is Consumer.
3. Guard chain, entirely before any spend:
   - session valid, account active and not suspended
   - email verified if required by settings
   - consent recorded at the current policy version
   - monthly quota remaining
   - per-hour and per-IP rate limits not exceeded
   - system-wide budget not exhausted
   - garment published with an approved test render
   - the referenced photo belongs to this user
   - idempotency key not already in flight or completed
4. Cache lookup on `sha256(garment_source_hash + person_photo_hash + api_version)`. On hit, return the stored render and consume no quota.
5. On miss, write a `tryon_jobs` row as `running` and call upstream with both images as multipart form data.
6. On success, store the returned PNG, write the cache entry, decrement quota and budget, mark `succeeded`.
7. Client polls or holds an SSE connection on the job ID.

### 8.2 Job handling

The upstream call is synchronous and returns in about seven seconds. Because the API runs as a persistent NestJS process rather than a serverless function, there is no invocation timeout to work around: the request is held open, the `tryon_jobs` row carries state and audit, and no external queue is required in V1.

Admin bulk test renders run through a NestJS task processor at concurrency one, so catalog work never competes with a live consumer generation.

Result delivery is by SSE from the API service. Long-lived connections are a further reason the API must run on a persistent container rather than a serverless platform.

### 8.3 Failure taxonomy

| Condition | Consumer sees | System behavior |
|---|---|---|
| No garment detected | "We're having trouble with this piece — we've been notified. Try another for now." | Flag garment for review, no charge, no retry, no quota consumed |
| Unsupported or corrupt format | "That photo didn't upload properly. Mind trying again?" | Caught at client validation wherever possible |
| Moderation rejection | Neutral request for a different photo | Log to moderation queue, no retry, no detail disclosed |
| Timeout or 5xx | "Taking longer than usual — hang tight." | Exponential backoff, max 3 attempts, then fail cleanly |
| Upstream rate limit | Silent; stays pending | Backoff and retry |
| Personal quota exhausted | "You've used your try-ons this month — your shortlist is saved, and you can send an enquiry any time." | Offer enquiry as the next action |
| System budget exhausted | "Our fitting room is at capacity today — we'll email you when it's back." | Alert Admin immediately, capture interest |

Failed jobs never consume quota or budget.

### 8.4 Cost control

- Content-hash cache across all users; a consumer revisiting a past result reads from history and never triggers a generation
- Idempotency keys prevent double-click double-charging
- Per-account monthly quota
- Email verification before the first generation
- Per-hour and per-IP rate limits above the quota
- Bot protection on signup and on the generation endpoint
- Admin test renders tracked separately from consumer demand
- Quota and budget decrement only on success

---

## 9. Non-functional requirements

### 9.1 Performance
- p95 try-on, cache miss: under 11 seconds end to end
- p95 cache hit: under 400ms
- Catalog grid first contentful paint on 4G: under 2.5s
- Renders served from CDN with responsive variants; history lists load thumbnails only, paginated, with full-resolution renders fetched on open
- Must absorb traffic spikes of 50x baseline

### 9.2 Security
- API key server-side only, rotated quarterly
- Storage access via short-lived pre-signed URLs scoped to the owning user
- Session cookies httpOnly, Secure, SameSite
- Argon2 password hashing; 2FA mandatory for Admin
- Role resolved server-side on every request, per S-3
- Object-level ownership checks on every photo, render, shortlist and enquiry — never inferred from an unguessable ID
- Rate limiting on login, signup, password reset, OTP and generation
- Authorisation tests covering every Admin-only route and every cross-account access attempt
- CORS restricted to the Web origin with credentials; no wildcard origin in any environment
- CSRF protection on all state-changing API endpoints
- Every NestJS endpoint carries an explicit role guard, verified in CI per B-5

### 9.3 Privacy and retention
- Person photos deleted 30 days after last account activity
- Renders retained for the life of the account, per C-27, and removed on individual deletion or account deletion. They carry no automatic expiry, because a stored render is the consumer's own result and re-generating it would cost her quota and the brand money
- Everything belonging to an account is removed on account deletion
- Automated purge with a verifiable deletion log
- Consumer-initiated deletion honored within 24 hours
- Renders never used in brand marketing without a separate, explicit opt-in per render
- No third-party analytics or ad pixels on any page showing a photo or render
- Moderation queue access is audit-logged

### 9.4 Content and copy
The product is presented as a shortlisting tool, not a preview tool. Every consumer-facing string is checked before shipping:
1. Does it promise accuracy? → rewrite
2. Does it frame the render as final rather than indicative? → rewrite
3. Does it say "see yourself in" or equivalent? → rewrite
4. Is the shortlisting purpose clear? → required

### 9.5 Accessibility
WCAG 2.1 AA. Keyboard navigation throughout. Alt text on all renders. Contrast validated against the brand color.

---

## 10. Design and interaction standards

### 10.1 Design system

- **D-1** A token set is defined and committed before any screen is built: color, type scale, spacing scale, radii, border weights, shadow levels. Every screen draws from these tokens; no ad-hoc hex values or one-off spacing.
- **D-2** Two typefaces — a display face used with restraint for headings and product names, and a body face for everything else. The type scale is fixed and documented.
- **D-3** The visual direction derives from the brand's own identity and materials. Default template aesthetics are rejected in review.
- **D-4** The consumer side and the admin console share the token set but not the layout language: the consumer side is image-led and generous with space; the admin console is dense, tabular and built for repetitive work.

### 10.2 Required states

- **D-5** No screen ships without every applicable state designed and implemented: default, loading, empty, error, permission-denied, and success. A screen with only its default state is incomplete.
- **D-6** Empty states direct the user to the next action rather than reporting emptiness. An admin with no garments sees how to add the first; a consumer with no shortlist sees how to start.
- **D-7** Error states state what happened and what to do next, in the interface's voice. They do not apologise, do not blame the user, and are never vague.
- **D-8** Skeletons match the aspect ratio of the content they replace. Cumulative layout shift stays below 0.1 on catalog and result screens.

### 10.3 Moments requiring particular care

These screens carry the product's credibility and receive design attention beyond the baseline.

| Moment | Requirement |
|---|---|
| The 7-second wait (C-27) | A staged, progressing sequence, not a spinner. The user can navigate away and be notified on completion. |
| The result reveal (C-28) | A composed presentation of the render with the compare control immediately available and the shortlisting caption always visible. |
| The consent gate (C-19) | Plain language, generous spacing, no dark patterns, no pre-checked boxes, no visual pressure toward acceptance. |
| Photo guidance (C-21) | Illustrated diagrams, not photographs of people. Clear enough that a first attempt usually passes validation. |
| Quota exhaustion (8.3) | Presents the shortlist and the enquiry action, never a dead end. |
| Admin first run | A guided path from empty catalog to first published garment. |

### 10.4 Responsive and input

- **D-9** Layouts hold from 360px upward. The consumer side is designed mobile-first; the admin console is usable on a phone for enquiry handling and approvals, with full catalog editing optimised for desktop.
- **D-10** Touch targets at least 44×44px. Interactive elements have visible hover, active, focus and disabled states.
- **D-11** Motion is purposeful and short, and `prefers-reduced-motion` is respected throughout.

### 10.5 Copy standards

- **D-12** Active voice, sentence case, plain verbs, no filler.
- **D-13** Controls name what happens when used. An action keeps the same name across the flow — the control that says Publish produces a confirmation that says Published.
- **D-14** Things are named by what the user controls, not by how the system is built.
- **D-15** All consumer-facing copy additionally passes the shortlisting-language check in §9.4.

### 10.6 Admin console specifics

- **D-16** Bulk operations report per-item progress and a summary of successes and failures, never a single opaque result.
- **D-17** Destructive actions require confirmation naming the affected item explicitly. Deleting a garment or a consumer requires typing the name.
- **D-18** Optimistic updates on catalog edits, with rollback and a clear message on failure.
- **D-19** Keyboard shortcuts for repetitive catalog work: navigate the list, open, approve a test render, publish.

### 10.7 Accessibility floor

- **D-20** WCAG 2.1 AA. Visible keyboard focus throughout, full keyboard navigation, alt text on all renders and catalog images, semantic headings, and contrast validated against the brand color at token definition.

---

## 11. Engineering standards

### 11.1 Environments and configuration

- **E-1** Three environments — local, staging, production — each running both services, with separate TryOnCloud keys, storage buckets and databases. Staging never holds production consumer photos. Web and API deploy independently; the OpenAPI contract in B-4 is what keeps them compatible.
- **E-2** All secrets supplied through environment variables. No credential is committed to the repository at any point in its history.
- **E-3** Database migrations are versioned, reversible, and reviewed. No destructive migration runs without a verified backup.
- **E-4** A seed script creates the first Admin and loads the reference model photos used for test renders.

### 11.2 Testing

- **E-5** Unit coverage of the guard chain (8.1 step 3), quota and budget arithmetic, cache key derivation, and image validation rules.
- **E-6** Integration tests for the try-on route covering every branch of the failure taxonomy in 8.3.
- **E-7** Authorisation tests for every Admin-only route, and cross-account access tests asserting that one consumer cannot read another's photos, renders, shortlists or enquiries.
- **E-8** End-to-end test of the full consumer path: signup, verification, consent, photo upload, try-on, shortlist, share, enquiry.
- **E-9** End-to-end test of the full admin path: category creation, garment upload, quality validation, test render, approval, publish.
- **E-10** A test asserts that publishing evaluates every A-10 / A-11 condition and records each unmet one on the `GARMENT_PUBLISHED` audit row — on the bulk route as well as the single one. (Superseded: this previously asserted that no garment lacking an approved test render could appear in the consumer catalog. A-11 is no longer a gate, so that assertion could not survive; the audit record is what replaces it, because it is now the only trace of who published an unproven piece.)

### 11.3 Reliability and observability

- **E-11** Every external call is wrapped with timeout, retry policy and typed error handling. No unhandled promise rejections.
- **E-12** Structured logging with a request ID propagated across the request lifecycle. Consumer photo URLs and personal data never appear in logs.
- **E-13** Metrics collected: generation latency distribution, failure rate by error code, cache hit rate, quota consumption, budget burn rate, signup and verification funnel.
- **E-14** Alerts on: generation failure rate above 4%, budget at 80% and 100%, purge job failure, moderation queue backlog, and authentication anomalies.
- **E-15** Daily database backup with a restore procedure that has been tested, not just documented.

### 11.4 Delivery

- **E-16** Every change passes typecheck, lint, tests and build in CI for both services before merge. CI additionally regenerates the typed API client and fails on an undeclared contract change, and fails on any endpoint missing a role guard. No direct pushes to the main branch.
- **E-17** A runbook covers budget exhaustion, API key rotation, purge job failure, moderation backlog, and restoring from backup.

### 11.5 Definition of done

A feature is complete when it has: all applicable states from D-5 implemented, server-side authorisation with a test, error handling mapped to user-facing copy, its metrics emitted, responsive behavior verified at 360px, keyboard and screen-reader access verified, and copy passing §9.4 and §10.5.

---

## 12. Data model

One `users` table holds both roles.

```
users             id, role, email, email_verified_at, password_hash, name,
                  phone, phone_verified_at, twofa_secret, status,
                  invited_by, last_login_at, created_at
                  -- role: 'admin' | 'consumer'
                  -- status: 'active' | 'suspended' | 'deactivated'
invites           id, email, role, token_hash, expires_at, consumed_at
consumer_profiles user_id, event_date, event_type, budget_band,
                  preferred_categories[], monthly_quota_override
categories        id, name, parent_id, cover_image_key, position, archived
garments          id, sku, title, category_id, colors[], fabric,
                  embellishment_weight, price, mode, deposit, description,
                  sizes[], publish_state, quality_score,
                  test_render_id, test_render_approved_at, approved_by
garment_images    id, garment_id, storage_key, is_tryon_source, hash, w, h
person_photos     id, user_id, storage_key, hash, is_active, uploaded_at,
                  purge_after
consents          id, user_id, policy_version, granted_at, ip, user_agent
tryon_jobs        id, user_id, garment_id, person_photo_id, idempotency_key,
                  status, cache_hit, error_code, attempts, is_test_render,
                  created_at
tryon_results     id, job_id, user_id, garment_id, person_photo_id,
                  storage_key, thumbnail_key, cache_key, deleted_at,
                  created_at
                  -- user_id, garment_id and person_photo_id are carried here
                  -- so history survives job pruning, photo deletion and
                  -- garment removal
shortlist_items   id, user_id, garment_id, verdict, rank, reject_reason, note
share_links       id, user_id, token_hash, revoked_at, expires_at
votes             id, share_link_id, garment_id, voter_label, reaction, comment
enquiries         id, user_id, message, status, lost_reason, created_at
enquiry_notes     id, enquiry_id, author_id, body, created_at
quota_ledger      id, user_id, delta, reason, job_id, period, created_at
usage_ledger      id, delta, reason, job_id, balance_after, created_at
settings          key, value
audit_log         id, actor_id, action, target, metadata, created_at
```

Both ledgers are append-only; remaining quota and remaining budget are derived, never mutable columns. Every consumer-owned row carries `user_id` so ownership is a single predicate.

---

## 13. Stack and architecture

### 13.1 Two deployable services

| Service | Technology | Responsibility |
|---|---|---|
| **Web** | Next.js App Router, TypeScript, React | All UI for both roles. Renders the role-aware dashboard, handles routing, forms and client state. Holds no secrets and no business rules. |
| **API** | NestJS, TypeScript | All business logic, authentication, authorisation, quota and budget enforcement, the TryOnCloud proxy, storage signing, jobs, and every database write. |

| Layer | Choice |
|---|---|
| Database | Postgres via Prisma or TypeORM, owned exclusively by the API |
| Auth | Server-side sessions, httpOnly cookie scoped to the parent domain, Argon2 |
| Storage | Cloudflare R2 or S3, pre-signed URLs issued by the API |
| Images | CDN with on-the-fly resizing |
| Jobs | NestJS scheduled task processor, concurrency 1 for test renders |
| Email and OTP | Transactional email provider plus regional SMS |
| Hosting | Web on any Node host or edge platform; API on a persistent container |

### 13.2 Boundary rules

- **B-1** The TryOnCloud API key exists only in the API service environment. The Web service never holds it, never proxies to TryOnCloud, and has no code path that could.
- **B-2** The Web service holds no business rules. Quota checks, publish-state checks, ownership checks and role checks are enforced in the API. Any equivalent logic in the Web service is presentation only and is never the enforcement point.
- **B-3** The API is the only service with database credentials.
- **B-4** The API exposes a versioned REST surface under `/api/v1`, documented with OpenAPI generated from NestJS decorators. The Web service consumes a typed client generated from that schema, so a contract change fails the build rather than production.
- **B-5** Every API endpoint declares its required role through a guard. An endpoint without an explicit role guard fails CI.

### 13.3 Session handling across services

- **B-6** Web and API are served on the same parent domain — `app.example.com` and `api.example.com` — so a single httpOnly, Secure, SameSite=Lax session cookie scoped to `.example.com` covers both. Tokens are never stored in `localStorage` or exposed to JavaScript.
- **B-7** CORS on the API allows the Web origin only, with credentials enabled. No wildcard origin in any environment.
- **B-8** Because authentication is cookie-based, all state-changing endpoints require a CSRF token via the double-submit pattern.
- **B-9** Next.js server components fetch from the API forwarding the incoming cookie. The browser calls the API directly for mutations. There is no second proxy layer in the Web service.
- **B-10** Role for rendering purposes comes from a single `GET /api/v1/auth/me` call resolved server-side in Next.js middleware. This determines which dashboard shell renders; it is never the authorisation decision. Per S-3, every data operation is independently authorised by the API.

### 13.4 Request flow

```
Browser
   │  (1) navigates
   ▼
Next.js  ── server-side fetch, cookie forwarded ──► NestJS  ──► Postgres
   │  (2) renders admin or consumer shell                 └──► Object storage (signed URLs)
   │
   └─ (3) mutations and try-on calls, credentialed ──────► NestJS ──► TryOnCloud
```

---

## 14. Dependency

The API expects a garment image. Before build starts, run 20 real catalog photos through the API and categorize the results as good, marginal or unusable. If unusable exceeds roughly 30%, source images require reshooting before the catalog can be populated. A-11 exists so this surfaces during admin catalog setup rather than on a consumer's screen.

---

## 15. Build sequence

| Milestone | Contents |
|---|---|
| 0 | Catalog image validation against the API; design token system and type scale defined (D-1, D-2); both service skeletons, environments, CI, OpenAPI client generation and seed script (E-1 to E-4, B-4) |
| 1 | Users table, session and CSRF handling across both origins, unified login, signup, role guards, role-aware `/dashboard`, seed admin, authorisation test harness |
| 2 | Categories, garment CRUD, image upload, quality validator, admin console layout language |
| 3 | Try-on proxy, jobs table, cache, test render gate, structured logging and metrics |
| 4 | Consumer consent, photo upload, browse, try-on, result view and history, including the wait and reveal moments in §10.3 |
| 5 | Quotas, email verification, rate limits, budget cap, failure taxonomy, ownership and cross-account tests |
| 6 | Shortlist, sharing, enquiry, admin inbox, consumer management |
| 7 | Analytics, catalog health, moderation, purge job, audit log, alerting and runbook |
| 8 | State completeness pass across all screens (D-5), copy review, accessibility audit, Urdu and RTL |

Every milestone meets the definition of done in §11.5 before the next begins. States, authorisation tests, error handling and copy are part of each feature, not deferred to milestone 8 — milestone 8 verifies them rather than creating them.
