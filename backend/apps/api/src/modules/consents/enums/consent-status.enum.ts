/**
 * The three answers to "may this consumer upload a photo and generate?" (C-12).
 *
 * **TypeScript-only** — like `Role.PUBLIC` (§4.1), it is never stored. Consent state
 * is *derived* from the `consents` rows against the current `policy_versions` row, so
 * there is nothing to keep in sync and nothing that can go stale: publishing a new
 * policy version moves everyone from `GRANTED` to `STALE` with no write at all.
 */
export enum ConsentStatus {
  /** A `consents` row exists against the current policy version. */
  GRANTED = 'GRANTED',
  /** No `consents` row at all → `CONSENT_REQUIRED`. */
  REQUIRED = 'REQUIRED',
  /** Consented, but to an older version → `CONSENT_STALE` (C-12). */
  STALE = 'STALE',
}
