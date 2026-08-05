# Drape — operations runbook

PRD E-17. Five scenarios, each with the signal that raises it, the immediate
action, the fix, and how you confirm it is over.

Everything here assumes shell access to the API container and to Postgres.
`STORAGE_ROOT` is a directory **outside** the repository; the database stores
only relative keys, so the two can be moved independently.

---

## 1. Generation budget exhausted

**Signal.** `budget-warning-80` at 80%, `budget-exhausted-admin` at 100%
(PRD A-29, E-14). The usage dashboard shows projected exhaustion from a 7-day
trailing rate, so this should never arrive as a surprise.

**What consumers see.** The catalog stays browsable. Generation returns
`BUDGET_EXHAUSTED` with the §8.3 copy: *"Our fitting room is at capacity today
— we'll email you when it's back."* Shortlists and enquiries keep working;
this is deliberately not a dead end.

**Immediate.** Decide whether this is genuine demand or an incident. Check the
consumer/test-render split on the usage dashboard — a spike in admin test
renders means someone is bulk-running the catalog, which is throttled to
concurrency 1 but still spends.

**Fix.** Raise the monthly budget in Settings, or wait for the period roll.
The budget is derived by summing `usage_ledger`, so there is no counter to
reset and no risk of double-crediting:

```sql
-- what has actually been spent this period
SELECT SUM(delta) FROM usage_ledger WHERE period = to_char(now(), 'YYYY-MM');
```

**Never** edit `usage_ledger` to buy headroom. It is append-only by database
rule, and the derived balance is the only number the guard chain trusts. Raise
the ceiling in Settings instead.

**Confirm.** A test render succeeds and appends exactly one row.

---

## 2. TryOnCloud API key rotation

Quarterly, per PRD §9.2. The key exists **only** in the API service
environment (B-1) — the web service has no code path to it.

1. Issue the new key upstream, leaving the old one live.
2. Set `TRYONCLOUD_API_KEY` in the API environment and restart. The API
   validates its environment at boot and refuses to start on a bad one, so a
   typo fails immediately and visibly rather than at the first generation.
3. Run one admin test render against a reference model. That exercises the
   real driver without touching a consumer's photo.
4. Revoke the old key upstream.

If step 3 fails, the previous container is still healthy — roll back the
environment variable and restart. No data migration is involved.

**Do not** set `TRYON_DRIVER=http` in local or CI. The account carries a
10-image budget and the mock driver is the default everywhere else for that
reason.

---

## 3. Purge job failure

**Signal.** `purge-job-failed` (E-14). The purge deletes person photos 30 days
after last account activity (§9.3).

**What it must never do.** Renders are retained for the life of the account
(C-27) and are excluded from any time-based purge by construction. If a purge
failure is ever accompanied by missing renders, stop and escalate — that is a
different and much more serious bug.

**Diagnose.** The deletion log is the audit trail:

```sql
SELECT id, kind, requested_at, completed_at, verification_hash
FROM deletion_log
WHERE completed_at IS NULL
ORDER BY requested_at;
```

Rows with a null `completed_at` are outstanding work, not lost work — the job
is idempotent and will retry them on the next run.

**Common causes.** `STORAGE_ROOT` unmounted or read-only (the API asserts the
root is outside the repository at boot, but not that it stays writable); a
storage object already gone by hand, which the driver treats as success.

**Consumer-initiated deletion is a 24-hour SLA** (C-38, §9.3). If the job has
been failing longer than that, the outstanding rows are a compliance issue,
not just a backlog. Fix the cause, run the job manually, and confirm every
row has a `completed_at` and a verification hash.

---

## 4. Moderation queue backlog

**Signal.** `moderation-backlog-alert` (E-14, A-34).

Flagged photos are **blocked pending review** — a consumer whose photo is in
the queue cannot generate. A backlog is therefore a queue of people who cannot
use the product, not a housekeeping chore.

**Rules that do not bend while you clear it.** Photos are shown blurred, to
Admins only, and **every view is audit-logged** (S-10, A-34). There is no route
that serves the unblurred original, so the constraint is structural rather than
a matter of care.

**Clear it** from the moderation screen. Approving releases the photo and any
job blocked behind it; rejecting is a neutral request for a different photo —
the consumer is never told what the heuristic saw (§8.3).

**If the backlog is a false-positive spike**, the threshold lives in Settings.
Widening it is a product decision with a privacy cost; record it in the audit
log.

---

## 5. Restore from backup

Daily backups with a **tested** restore procedure (E-15) — tested, not merely
documented. Run this drill against staging on a schedule; a restore path that
has never been executed is not a restore path.

**Two stores, restored together.**

1. **Postgres.** Restore the dump into a fresh database, then run migrations —
   they are reversible and idempotent (E-3). Never run a destructive migration
   without a verified backup.
2. **`STORAGE_ROOT`.** Restore the directory tree. The database holds relative
   keys, so the root may land at a different absolute path; set `STORAGE_ROOT`
   to wherever it now lives.

**They must be restored to the same point in time.** A database newer than the
object store leaves rows pointing at bytes that do not exist; the reverse
leaves orphaned files. If they drift, the database is authoritative — reconcile
by finding rows whose objects are missing:

```sql
SELECT id, storage_key FROM tryon_results WHERE deleted_at IS NULL;
SELECT id, storage_key FROM person_photos;
```

**After any restore, verify:**

- `GET /health/ready` reports both the database and the storage root up.
- One signed file URL resolves — that proves `STORAGE_URL_SECRET` matches the
  restored environment. If it was rotated after the backup, every previously
  issued URL is already dead, which is expected and harmless.
- `npm run seed:check` confirms the settings registry and policy version rows.

**Session behaviour.** Session hashes are HMAC'd with `SESSION_SECRET`. If that
secret differs from the one in use when the backup was taken, every session is
invalid and everyone is logged out. That is the intended behaviour, not a
failure — but tell people before you do it.

---

## Alert reference

| Alert | Threshold | Runbook |
|---|---|---|
| `generation-failure-rate-alert` | failure rate > 4% (E-14) | Check the failure breakdown by error code on the usage dashboard. `UPSTREAM_*` codes are TryOnCloud's; `NO_GARMENT_DETECTED` clusters on one garment mean a bad try-on source, not an outage. |
| `budget-warning-80` / `budget-exhausted-admin` | 80% / 100% | §1 |
| `purge-job-failed` | any failed run | §3 |
| `moderation-backlog-alert` | queue depth | §4 |
| authentication anomalies | lockout rate | Check `auth_attempts` for a single email or IP. Suspension and IP blocking are on the abuse screen (A-35). |

## What never happens during an incident

- No one reads a consumer's photo. There is no route, for any role (S-10).
- No one edits `quota_ledger` or `usage_ledger`. They are append-only by
  database rule; balances are derived by summing them.
- No secret gets a fallback default so a service can limp along. Missing
  configuration fails at boot, loudly, by design (E-2).
