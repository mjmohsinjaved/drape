/**
 * The numbers behind the transactional outbox — ARCHITECTURE §4.32.
 *
 * §4.32 fixes two of them in prose: rows are "drained every 10 seconds … with
 * exponential backoff and a cap of 5 attempts". They are constants rather than
 * settings because a delivery schedule is not a thing an admin tunes at runtime, and
 * a `settings` read on every tick would cost a query per ten seconds forever.
 */

/** §4.32 — the drain interval. */
export const OUTBOX_TICK_MS = 10_000;

/** §4.32 — a row that has failed this many times is dead-lettered, not retried again. */
export const OUTBOX_MAX_ATTEMPTS = 5;

/** How many rows one tick claims. Bounds the work a single drain can do. */
export const OUTBOX_BATCH_SIZE = 25;

/** First retry delay. Attempt *n* waits `BASE * 2^(n-1)`, capped by {@link OUTBOX_BACKOFF_MAX_MS}. */
export const OUTBOX_BACKOFF_BASE_MS = 30_000;

/** Ceiling on the backoff, so the fifth attempt is minutes away rather than hours. */
export const OUTBOX_BACKOFF_MAX_MS = 15 * 60_000;

/**
 * A row claimed into `SENDING` that has not moved for this long is presumed abandoned
 * by a process that died mid-delivery, and is returned to `PENDING`.
 *
 * This is the one place the outbox is honestly **at-least-once**: a crash after the
 * provider accepted the message but before the row was marked `SENT` will resend it.
 * `dedupeKey` (§4.32) is the tool that makes a particular message at-most-once; the
 * alternative — never reclaiming — makes it at-most-once by losing it, which is worse
 * for every message this system actually sends.
 */
export const OUTBOX_SENDING_TIMEOUT_MS = 5 * 60_000;

/** `notifications_outbox.lastError` is `varchar(512)` (§4.32). */
export const MAX_LAST_ERROR_LENGTH = 512;

/**
 * How long a delivered **email or SMS** row is kept before it is pruned.
 *
 * An `EMAIL` or `SMS` row that has been sent is a delivery record: it proves a message
 * left, and `attempts`/`lastError` on the rows around it are how an operator sees that a
 * gateway has been failing since Tuesday. None of that needs to be true forever, and
 * nothing was pruning it — the table only ever grew, and every row in it carried template
 * variables written for a person.
 *
 * Thirty days is long enough to answer "did she ever get the confirmation?" for any
 * support ticket worth answering, and short enough that a row is not a permanent record of
 * who was told what.
 *
 * `FAILED` rows are **not** pruned on this schedule. A dead letter is unresolved work; it
 * goes when someone has looked at it.
 */
export const OUTBOX_DELIVERED_RETENTION_DAYS = 30;

/** Rows one prune pass removes. Bounds the statement on the first run after a long gap. */
export const OUTBOX_PRUNE_BATCH_SIZE = 500;

/** The prune runs once a day, at 04:10 — after the 03:00 photo purge, not on top of it. */
export const OUTBOX_PRUNE_CRON = '10 4 * * *';

/** `notifications_outbox.dedupeKey` is `varchar(160)` (§4.32). */
export const MAX_DEDUPE_KEY_LENGTH = 160;

/**
 * E-14 — "generation failure rate above 4%".
 *
 * The threshold is a fraction rather than a percentage so nothing has to remember
 * which unit it is in at a comparison site.
 */
export const GENERATION_FAILURE_RATE_THRESHOLD = 0.04;

/**
 * Below this many generations in the window the failure rate is not evidence of
 * anything — one failure out of three is 33% and means nothing at all. E-14 asks for
 * an alert on a rate, and a rate needs a denominator.
 */
export const GENERATION_FAILURE_MIN_SAMPLE = 25;

/** How often the E-14 generation-failure-rate check runs. */
export const ALERT_SWEEP_MS = 5 * 60_000;

/**
 * The shortest gap between two identical operator alerts.
 *
 * E-14 asks to be told once that something is wrong, not once per sweep until it is
 * fixed. The dedupe key carries the bucket, so a second alert inside the same window
 * loses the unique index and is dropped by the database rather than by a flag in
 * memory that a restart would forget.
 */
export const ALERT_DEDUPE_WINDOW_MS = 60 * 60_000;
