/**
 * The consent contract — ARCHITECTURE §5.10, PRD C-11, C-12.
 *
 * Written against the real `PolicyResponseDto`, `ConsentStatusResponseDto` and
 * `CreateConsentDto`, which differ from the sketch in `@repo/api-client/types/consents`:
 * the policy carries **no `policyVersionId`**, the status names the *current* version as
 * `policyVersion` and hers as `consentedPolicyVersion`, and `POST /consents` takes
 * `{ policyVersion, accepted, locale }` — an explicit `accepted: true`, which is the wire-level
 * expression of C-11's "nothing pre-checked, not skippable".
 */

export type ConsentStatusValue = 'GRANTED' | 'REQUIRED' | 'STALE';
export type ApiLocale = 'EN' | 'UR';

/** C-11's retention statements, as the gate renders them. */
export interface PolicyRetention {
  /** Days a photo is kept after last account activity (§9.3). */
  photoDays: number;
  /** True when renders are kept for the life of the account (C-27). */
  rendersLifetime: boolean;
}

/** `GET /consents/policy` (PUBLIC) — the text she is agreeing to, in her locale. */
export interface PolicyDocument {
  version: string;
  effectiveFrom: string;
  locale: ApiLocale;
  /** Markdown. Covers all five C-11 statements. */
  body: string;
  summary: string;
  retentionSummary: PolicyRetention;
}

/** `GET /consents/me` (CONSUMER). */
export interface MyConsentState {
  status: ConsentStatusValue;
  /** When she last agreed, at any version. Null when she never has. */
  grantedAt: string | null;
  /** The version currently in force — the one she must be at to pass the guard chain. */
  policyVersion: string;
  /** The version she actually agreed to. Differs from `policyVersion` when `STALE`. */
  consentedPolicyVersion: string | null;
}

/**
 * `POST /consents`. `accepted` must be literally `true`: a payload without it is a client that
 * skipped the gate, and the API refuses it.
 */
export interface GrantConsentBody {
  policyVersion: string;
  accepted: true;
  locale?: ApiLocale;
}
