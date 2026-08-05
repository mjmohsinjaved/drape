/**
 * The bounds every analytics query is written against — ARCHITECTURE §5.18.
 *
 * The rule these serve: **no query in this module may load an unbounded result set into
 * memory.** Every read here is a `COUNT`, a `SUM` or a `GROUP BY` with a window, a
 * `HAVING` floor and a `LIMIT`. An admin dashboard is the one screen that is tempting
 * to write as "load the rows and reduce in JavaScript", and it is the one screen where
 * that stops working first — a year of `tryon_jobs` is not a page.
 */

/** Longest window any analytics route will look back over. A year plus a leap day. */
export const MAX_ANALYTICS_WINDOW_DAYS = 366;

/** Default window when a caller names none — a month reads like a month. */
export const DEFAULT_ANALYTICS_WINDOW_DAYS = 30;

/** Rows returned by the A-37 leaderboard and the A-39 category table. */
export const LEADERBOARD_LIMIT = 25;

/** Ceiling a caller may raise the leaderboard to. */
export const MAX_LEADERBOARD_LIMIT = 100;

/**
 * Below this many try-ons a garment's star rate is noise.
 *
 * A piece tried once and starred once is not "100% loved", and putting it at the top
 * of A-37 would send a buyer after the wrong stock. The floor is applied in SQL, as a
 * `HAVING`, so the excluded rows are never returned rather than filtered afterwards.
 */
export const LEADERBOARD_MIN_TRYONS = 3;

/** Hours in a day and days in a week — the A-39 activity grid. */
export const HOURS_IN_DAY = 24;
export const DAYS_IN_WEEK = 7;

/** E-13 latency buckets, in milliseconds. The upstream call is about seven seconds (C-19). */
export const LATENCY_BUCKETS_MS: readonly number[] = [1_000, 3_000, 5_000, 7_000, 10_000, 20_000];

/** How often the E-14 generation-failure-rate check runs. */
export const GENERATION_HEALTH_SWEEP_MS = 5 * 60_000;

/** E-14 — "generation failure rate above 4%". As a percentage, which is how the copy reads. */
export const GENERATION_FAILURE_THRESHOLD_PERCENT = 4;

/** The window the failure-rate check measures over. */
export const GENERATION_FAILURE_WINDOW_MINUTES = 60;

/**
 * Below this many generations in the window, a rate is not evidence.
 *
 * One failure out of three is 33% and means nothing at all. E-14 asks for an alert on a
 * rate; a rate needs a denominator, and this is the smallest one worth acting on.
 */
export const GENERATION_FAILURE_MIN_SAMPLE = 25;
