/**
 * ARCHITECTURE.md §5.10 `consents`, §4.10 and §4.11.
 *
 * Consent is current when a row exists for the user against the *current* policy version.
 * Otherwise the guard chain answers `CONSENT_REQUIRED` (none at all) or `CONSENT_STALE` (an older
 * version) — steps 4 and 5, before any spend (C-11, C-12).
 */

import type { IsoDateTime, Uuid } from './common';
import type { ConsentStatus, Locale } from './enums';
import type { PolicyRetention } from './settings';

/**
 * `GET /consents/policy` (PUBLIC) — the current policy version and body in the requested locale
 * (C-11). Covers all five C-11 statements; the summary is what the gate renders inline.
 */
export interface PolicyDocument {
  policyVersionId: Uuid;
  version: string;
  locale: Locale;
  effectiveFrom: IsoDateTime;
  /** Markdown. */
  body: string;
  summary: string;
  retentionSummary: PolicyRetention;
}

/** `GET /consents/me` (CONSUMER) — her consent state. */
export interface MyConsentState {
  status: ConsentStatus;
  grantedAt: IsoDateTime | null;
  /** The version she actually agreed to, which may be older than the current one. */
  policyVersion: string | null;
  /** The version currently in force. Differing from `policyVersion` is what makes her `STALE`. */
  currentPolicyVersion: string;
  currentPolicyVersionId: Uuid;
  /** The locale of the translation she read (§4.11). */
  locale: Locale | null;
}

/**
 * `POST /consents` (CONSUMER) — records consent with timestamp, IP, user agent and policy version
 * (C-12). IP and user agent are taken from the request, never from the payload.
 */
export interface GrantConsentRequest {
  /** Must be the current version; anything else is rejected rather than silently accepted. */
  policyVersionId: Uuid;
  /** Which translation she actually read. */
  locale: Locale;
}

export interface GrantConsentResponse {
  status: 'GRANTED';
  grantedAt: IsoDateTime;
  policyVersion: string;
}
