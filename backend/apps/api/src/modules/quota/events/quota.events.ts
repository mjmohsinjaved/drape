import type { BudgetState } from '../utils/ledger-math';

/**
 * Domain events emitted by `quota` — `domain.action` (§2.2).
 *
 * These exist for PRD E-14 ("alerts on … budget at 80% and 100%") and for the A-29
 * consumer-facing message. They are emitted **after** `commitTransaction()`, and only
 * on the request that actually crossed the threshold — not on every request that
 * happens to be above it. See `crossedThreshold()` in `utils/ledger-math.ts` for why
 * that distinction is the difference between an alert and a pager storm.
 *
 * `notifications` and the alerting sink listen; nothing in this module does. Audit
 * rows are written by the `audit` module's `@OnEvent` listener, from
 * `AUDIT_RECORD_EVENT`, not from these (§2.9 rule 4).
 */
export const QUOTA_EVENTS = {
  /** A-29 / E-14 — the soft warning threshold was crossed by this generation. */
  BUDGET_WARNING_REACHED: 'budget.warning_reached',
  /** A-29 / E-14 — the monthly budget is spent. The catalog stays browsable (§8.3). */
  BUDGET_EXHAUSTED: 'budget.exhausted',
  /** C-5 — a consumer spent her last generation of the period. */
  QUOTA_EXHAUSTED: 'quota.exhausted',
  /** A-18 — a mid-period override raise was granted immediately. */
  QUOTA_OVERRIDE_GRANTED: 'quota.override_granted',
} as const;

export type QuotaEventName = (typeof QUOTA_EVENTS)[keyof typeof QUOTA_EVENTS];

/** Fields every event here carries. */
interface QuotaEventBase {
  /** `YYYY-MM` in `TIMEZONE` (§4.26). */
  readonly period: string;
  readonly occurredAt: Date;
}

export interface BudgetThresholdEvent extends QuotaEventBase {
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  /** 0–100+, one decimal place. */
  readonly percentUsed: number;
  readonly state: BudgetState;
  /** When the budget resets — the "we'll email you when it's back" date (§8.3). */
  readonly resetsAt: Date;
}

export interface ConsumerQuotaExhaustedEvent extends QuotaEventBase {
  readonly userId: string;
  readonly limit: number;
  readonly used: number;
  readonly resetsAt: Date;
}

export interface QuotaOverrideGrantedEvent extends QuotaEventBase {
  readonly userId: string;
  /** The admin who raised it. */
  readonly actorId: string | null;
  /** How much allowance was appended right now — never the new total (A-18, §4.26). */
  readonly granted: number;
  /** The entitlement the raise brought her to. */
  readonly entitlement: number;
}
