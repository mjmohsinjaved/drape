/**
 * The numbers behind §9.3 retention, A-20 and C-38.
 *
 * `PHOTO_RETENTION_DAYS` and `DELETION_SLA_HOURS` are **environment** variables (§7),
 * not constants: they are policy an operator may have to change without a deploy. The
 * values below are the fallbacks and the mechanics — batch sizes, cron cadence — which
 * are not policy and should not be tunable at runtime.
 */

/** §7 default — "person photos deleted 30 days after last account activity" (§9.3). */
export const DEFAULT_PHOTO_RETENTION_DAYS = 30;

/** §7 default — consumer-initiated deletion is honoured within 24 hours (C-38, A-20). */
export const DEFAULT_DELETION_SLA_HOURS = 24;

/**
 * Photographs one purge run will delete.
 *
 * A run is bounded so it cannot hold a connection for minutes on a backlog, and so a
 * shutdown mid-run loses at most one batch of work rather than an hour of it. The cron
 * runs daily and the backlog on any normal day is a handful of rows; the bound is for
 * the abnormal day — the first run after the job has been broken for a fortnight.
 */
export const PURGE_BATCH_SIZE = 200;

/** Accounts one deletion sweep will purge. Each is a multi-table cascade, so it is small. */
export const DELETION_BATCH_SIZE = 10;

/**
 * The photo purge runs once a day, in the small hours of `TIMEZONE`.
 *
 * Nightly rather than hourly because the policy is measured in days: a photograph
 * deleted at 03:00 on day 31 instead of 00:00 has still been deleted 30 days after her
 * last activity, and an hourly cron would be twenty-three extra scans of an index for
 * no change in outcome.
 */
export const PURGE_CRON = '0 3 * * *';

/**
 * The deletion sweep runs every fifteen minutes.
 *
 * C-38 gives 24 hours and promises the consumer it is "immediate from her view". The
 * gap between those two is where trust is lost, so the sweep runs often enough that the
 * real answer is usually minutes — while the *guarantee* stays the SLA, because a
 * guarantee that depends on the queue being short is not a guarantee.
 */
export const DELETION_SWEEP_MS = 15 * 60_000;

/**
 * A deletion request older than this fraction of the SLA is overdue, and the E-14 purge
 * alert fires before the promise is broken rather than after.
 *
 * Alerting at 100% would tell an operator that the SLA has already been missed. At 75%
 * there are six hours left to do something about it.
 */
export const DELETION_SLA_WARNING_FRACTION = 0.75;

/**
 * Renders included in one C-39 export archive.
 *
 * C-5 caps a consumer at fifteen generations a month, so a year of heavy use is under
 * two hundred renders. The cap exists so "how large can an archive be" has an answer
 * that does not depend on how long she has had an account — `buildZipArchive` assembles
 * in memory, and an unbounded archive would be an unbounded allocation.
 */
export const MAX_EXPORT_RENDERS = 500;

/** Total bytes one export archive may reach before it is truncated with a notice inside it. */
export const MAX_EXPORT_BYTES = 256 * 1024 * 1024;

/** How long an export stays downloadable before the purge collects it. */
export const EXPORT_RETENTION_HOURS = 48;

/**
 * Live archives one consumer may hold at a time.
 *
 * `POST /me/export` used to mint a new one on every call with no cap and nothing to
 * collect them, so a consumer who pressed the button eleven times held eleven archives —
 * each up to {@link MAX_EXPORT_RENDERS} full-resolution renders of her body, each live
 * for {@link EXPORT_RETENTION_HOURS}. Three is enough that a download interrupted twice
 * still has a working link, and few enough that "how much of her history is sitting in
 * `exports/`" has an answer that does not depend on how many times she clicked.
 *
 * The oldest beyond the cap is deleted when a new one is written, so the bound holds
 * immediately rather than at the next sweep.
 */
export const MAX_LIVE_EXPORTS_PER_CONSUMER = 3;

/* -------------------------------------------------------------------------------------------------
 * The orphan sweep — ARCHITECTURE §3.5 step 4 and §3.2 requirement 4
 * ---------------------------------------------------------------------------------------------- */

/**
 * §3.5 step 4 — "an object with no owning row after 6 hours is swept by the retention
 * cron". §3.2 requirement 4 uses the same six hours for `<root>/.tmp`.
 *
 * The delay is the whole safety argument. An object is written **before** the row that
 * names it — `UploadTicketService` hands out a ticket, the bytes land, and `POST
 * /person-photos` writes the row afterwards — so for a short window every legitimate
 * upload looks exactly like an orphan. Six hours is several thousand times longer than
 * that window and shorter than any retention promise, which is the property that makes
 * the sweep both safe and worth having.
 */
export const ORPHAN_MIN_AGE_HOURS = 6;

/**
 * The orphan sweep runs hourly, at 25 past.
 *
 * Hourly rather than nightly because the thing being collected is a photograph nobody
 * knows exists: it is invisible to `GET /me/data`, so she cannot delete it, and invisible
 * to `PurgeService`, which iterates rows. Nightly would mean a leaked photograph sits for
 * up to thirty hours instead of up to seven. Offset from the top of the hour so it does
 * not contend with anything else that runs on a round number.
 */
export const ORPHAN_SWEEP_CRON = '25 * * * *';

/**
 * Objects one run will **examine** per namespace.
 *
 * A store with a million renders must not be listed in full on a timer — the run would
 * hold memory and a connection for minutes and the next tick would start on top of it.
 * The listing is bounded, the sweep is idempotent, and a backlog is drained over
 * successive runs rather than in one heroic pass.
 */
export const ORPHAN_SWEEP_LIST_LIMIT = 2_000;

/**
 * Objects one run will **delete** per namespace.
 *
 * Deliberately far below {@link ORPHAN_SWEEP_LIST_LIMIT}: each delete writes a
 * `deletion_log` row (§9.3's "verifiable"), so the bound is on rows written as much as on
 * files removed. A run that hits this bound logs it, and the next run takes the rest.
 */
export const ORPHAN_SWEEP_DELETE_LIMIT = 200;

/** Stale `.tmp` files one run will remove. Same reasoning as the delete limit. */
export const TEMP_SWEEP_LIMIT = 500;

/** Rows shown on each list inside `GET /me/data` (C-37) — one screen's worth, per the PRD. */
export const MY_DATA_PAGE_SIZE = 100;
