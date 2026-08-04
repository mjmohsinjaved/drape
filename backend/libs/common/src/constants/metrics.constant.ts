/**
 * Metric names — PRD E-13, ARCHITECTURE.md §8.1 definition of done.
 *
 * E-13 requires: generation latency, failure rate by error code, cache hit rate,
 * quota consumption, budget burn and the signup funnel.
 *
 * Naming follows §2.2: dot-delimited lower snake, e.g. `tryon.latency_ms`,
 * `quota.consumed`. Names are the wire format for the future Prometheus exporter,
 * so they are declared once, here, and never spelled inline at a call site.
 */

/** Metric name constants. Every emission site imports from this object. */
export const METRICS = {
  // ── Generation latency (E-13) ────────────────────────────────────────────
  /** histogram · end-to-end try-on duration in ms. Tags: `origin`, `cacheHit`, `outcome`. */
  TRYON_LATENCY_MS: 'tryon.latency_ms',
  /** histogram · one upstream attempt in ms, excluding queueing. Tags: `attempt`, `driver`. */
  TRYON_UPSTREAM_LATENCY_MS: 'tryon.upstream_latency_ms',
  /** counter · jobs started. Tags: `origin`. */
  TRYON_STARTED: 'tryon.started',
  /** counter · jobs that reached SUCCEEDED. Tags: `origin`, `cacheHit`. */
  TRYON_SUCCEEDED: 'tryon.succeeded',
  /** counter · jobs that reached FAILED. Tags: `errorCode`, `origin`. */
  TRYON_FAILED: 'tryon.failed',
  /** counter · upstream retries. Tags: `errorCode`, `attempt`. */
  TRYON_RETRIED: 'tryon.retried',
  /** gauge · jobs currently RUNNING. */
  TRYON_IN_FLIGHT: 'tryon.in_flight',

  // ── Failure rate by code (E-13, §2.5) ────────────────────────────────────
  /** counter · every error the global filter serialises. Tags: `errorCode`, `status`, `masked`. */
  ERRORS_BY_CODE: 'errors.by_code',
  /** counter · §8.1 step-3 rejections, tagged with the rejecting code. Tags: `errorCode`. */
  TRYON_GUARD_REJECTED: 'tryon.guard_rejected',
  /** counter · unexpected exceptions mapped to INTERNAL_ERROR. Tags: `exception`. */
  ERRORS_UNHANDLED: 'errors.unhandled',

  // ── Cache hit rate (E-13, §3.7) ──────────────────────────────────────────
  /** counter · content-hash cache hit; render copied, no spend. */
  TRYON_CACHE_HIT: 'tryon.cache_hit',
  /** counter · content-hash cache miss; a generation was required. */
  TRYON_CACHE_MISS: 'tryon.cache_miss',
  /** counter · cache rows retired because a photo was replaced or removed (C-16). */
  TRYON_CACHE_EVICTED: 'tryon.cache_evicted',

  // ── Quota consumption (E-13, §4.26) ──────────────────────────────────────
  /** counter · quota units consumed by a successful generation. Tags: `period`. */
  QUOTA_CONSUMED: 'quota.consumed',
  /** counter · quota units granted. Tags: `period`, `reason`. */
  QUOTA_GRANTED: 'quota.granted',
  /** counter · generations refused because the consumer's quota was spent. */
  QUOTA_EXHAUSTED: 'quota.exhausted',
  /** gauge · derived remaining quota for the caller, at read time. Tags: `period`. */
  QUOTA_REMAINING: 'quota.remaining',

  // ── Budget burn (E-13, §4.27, A-29/A-33) ─────────────────────────────────
  /** counter · platform budget units consumed. Tags: `period`, `reason`. */
  BUDGET_CONSUMED: 'budget.consumed',
  /** gauge · derived remaining monthly budget. Tags: `period`. */
  BUDGET_REMAINING: 'budget.remaining',
  /** gauge · percent of the monthly budget consumed, 0–100. Tags: `period`. */
  BUDGET_BURN_PERCENT: 'budget.burn_percent',
  /** counter · soft warning threshold crossed (BUDGET_WARN_PERCENT, A-29). */
  BUDGET_WARNING_FIRED: 'budget.warning_fired',
  /** counter · generations refused because the monthly budget was spent. */
  BUDGET_EXHAUSTED: 'budget.exhausted',

  // ── Signup funnel (E-13, A-36) ───────────────────────────────────────────
  /** counter · a funnel step was reached. Tags: `step` — one of `FUNNEL_STEPS`. */
  FUNNEL_STEP: 'funnel.step',
  /** counter · account created. */
  FUNNEL_SIGNUP: 'funnel.signup',
  /** counter · email confirmed. */
  FUNNEL_EMAIL_VERIFIED: 'funnel.email_verified',
  /** counter · first person photo uploaded. */
  FUNNEL_PHOTO_UPLOADED: 'funnel.photo_uploaded',
  /** counter · first try-on completed. */
  FUNNEL_FIRST_TRYON: 'funnel.first_tryon',
  /** counter · first shortlist star. */
  FUNNEL_SHORTLISTED: 'funnel.shortlisted',
  /** counter · enquiry submitted. */
  FUNNEL_ENQUIRY: 'funnel.enquiry',

  // ── Platform (E-12, E-14) ────────────────────────────────────────────────
  /** histogram · request duration in ms. Tags: `method`, `route`, `status`. */
  HTTP_REQUEST_DURATION_MS: 'http.request_duration_ms',
  /** counter · requests served. Tags: `method`, `route`, `status`. */
  HTTP_REQUESTS_TOTAL: 'http.requests_total',
  /** counter · requests rejected by the throttler. Tags: `route`. */
  HTTP_RATE_LIMITED: 'http.rate_limited',
  /** counter · CSRF rejections. Tags: `errorCode`. */
  AUTH_CSRF_REJECTED: 'auth.csrf_rejected',
  /** counter · route reached RolesGuard with neither `@Public()` nor `@Roles()` (B-5). */
  AUTH_ROUTE_UNGUARDED: 'auth.route_unguarded',
  /** counter · authorisation refusals. Tags: `route`, `role`. */
  AUTH_DENIED: 'auth.denied',
  /** gauge · free space under STORAGE_ROOT, in MB (E-14). */
  STORAGE_FREE_MB: 'storage.free_mb',
} as const;

/** Union of every declared metric name. */
export type MetricName = (typeof METRICS)[keyof typeof METRICS];

/**
 * The A-36 signup funnel, in order. Used as the `step` tag on `funnel.step`
 * and as the column order of the admin funnel chart.
 */
export const FUNNEL_STEPS = [
  'SIGNUP',
  'EMAIL_VERIFIED',
  'PHOTO_UPLOADED',
  'FIRST_TRYON',
  'SHORTLISTED',
  'ENQUIRY',
] as const;

/** One step of the A-36 funnel. */
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/** Tag keys that may be attached to a metric. Closed set — keeps cardinality bounded. */
export const METRIC_TAG_KEYS = [
  'errorCode',
  'status',
  'masked',
  'origin',
  'outcome',
  'cacheHit',
  'driver',
  'attempt',
  'period',
  'reason',
  'step',
  'method',
  'route',
  'role',
  'exception',
] as const;

/** A permitted metric tag key. */
export type MetricTagKey = (typeof METRIC_TAG_KEYS)[number];

/** Tags attached to a single metric emission. Values are stringified by the sink. */
export type MetricTags = Partial<Record<MetricTagKey, string | number | boolean>>;
