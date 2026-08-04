/**
 * The C-11 consent gate — PRD C-11 and C-12, ARCHITECTURE.md §5.10 and §4.11.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *  THIS STORE IS NOT THE CONSENT RECORD. The record lives in the append-only `consents` table and
 *  is read through `GET /consents/me` (TanStack Query, `queryKeys.consent.me()`). The try-on guard
 *  chain re-evaluates it server-side on every generation and answers `CONSENT_REQUIRED` (step 4)
 *  or `CONSENT_STALE` (step 5) **before any spend** — whatever this store happens to hold.
 *
 *  What lives here is the *gate's* state: which policy version the current view has acknowledged,
 *  whether the modal is open, and whether she has read to the end of the body. That is UI state,
 *  so it is client state (§6.5).
 *
 *  Not persisted. Persisting an acknowledgement would let a stale local flag suppress a gate the
 *  server still requires after a C-12 policy republish — which is exactly the failure C-12 exists
 *  to prevent.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { withDevtools } from '../middleware/devtools.middleware';

import type { ConsentStatus } from '@repo/api-client';


export interface ConsentState {
  /** Mirrors `GET /consents/me`. Hydrated from the query; never fetched here (§6.5). */
  status: ConsentStatus | null;
  /** The version currently in force, from the same response. */
  currentPolicyVersion: string | null;
  /** The version she agreed to, which may be older — that difference is what makes her `STALE`. */
  grantedPolicyVersion: string | null;
  /** The version this session has ticked in the gate, before the mutation resolves. */
  acknowledgedVersion: string | null;
  /** Whether the C-11 gate modal is on screen. */
  isGateOpen: boolean;
  /** True once she has scrolled the policy body to the end — the tick is disabled until then. */
  hasReadPolicy: boolean;
  /** True between submit and the server's answer, so the gate can disable its confirm button. */
  isSubmitting: boolean;

  /** Hydrates from `GET /consents/me`. */
  setFromServer: (input: {
    status: ConsentStatus;
    currentPolicyVersion: string;
    grantedPolicyVersion: string | null;
  }) => void;
  openGate: () => void;
  closeGate: () => void;
  setHasReadPolicy: (hasRead: boolean) => void;
  /** Ticks the box for a specific version, so a republish mid-session cannot inherit the tick. */
  acknowledge: (version: string) => void;
  submitStart: () => void;
  /** The `POST /consents` mutation succeeded. */
  submitSuccess: (version: string) => void;
  submitFailure: () => void;
  reset: () => void;
}

const initialState = {
  status: null,
  currentPolicyVersion: null,
  grantedPolicyVersion: null,
  acknowledgedVersion: null,
  isGateOpen: false,
  hasReadPolicy: false,
  isSubmitting: false,
} satisfies Omit<
  ConsentState,
  | 'setFromServer'
  | 'openGate'
  | 'closeGate'
  | 'setHasReadPolicy'
  | 'acknowledge'
  | 'submitStart'
  | 'submitSuccess'
  | 'submitFailure'
  | 'reset'
>;

export const useConsentStore = create<ConsentState>()(
  withDevtools(
    (set) => ({
      ...initialState,

      setFromServer: ({ status, currentPolicyVersion, grantedPolicyVersion }) =>
        set(
          (state) => ({
            status,
            currentPolicyVersion,
            grantedPolicyVersion,
            // A republish invalidates an acknowledgement made against the previous version (C-12).
            acknowledgedVersion:
              state.acknowledgedVersion === currentPolicyVersion ? state.acknowledgedVersion : null,
            hasReadPolicy:
              state.currentPolicyVersion === currentPolicyVersion ? state.hasReadPolicy : false,
          }),
          false,
          'consent/setFromServer',
        ),

      openGate: () => set({ isGateOpen: true }, false, 'consent/openGate'),

      closeGate: () => set({ isGateOpen: false }, false, 'consent/closeGate'),

      setHasReadPolicy: (hasReadPolicy) =>
        set({ hasReadPolicy }, false, 'consent/setHasReadPolicy'),

      acknowledge: (version) =>
        set({ acknowledgedVersion: version }, false, 'consent/acknowledge'),

      submitStart: () => set({ isSubmitting: true }, false, 'consent/submitStart'),

      submitSuccess: (version) =>
        set(
          {
            status: 'GRANTED',
            grantedPolicyVersion: version,
            acknowledgedVersion: version,
            isSubmitting: false,
            isGateOpen: false,
          },
          false,
          'consent/submitSuccess',
        ),

      submitFailure: () => set({ isSubmitting: false }, false, 'consent/submitFailure'),

      reset: () => set({ ...initialState }, false, 'consent/reset'),
    }),
    'consent',
  ),
);

/* ------------------------------------------------------------------- selectors */

export const selectConsentStatus = (state: ConsentState): ConsentStatus | null => state.status;

export const selectCurrentPolicyVersion = (state: ConsentState): string | null =>
  state.currentPolicyVersion;

export const selectIsConsentGateOpen = (state: ConsentState): boolean => state.isGateOpen;

export const selectHasReadPolicy = (state: ConsentState): boolean => state.hasReadPolicy;

export const selectIsConsentSubmitting = (state: ConsentState): boolean => state.isSubmitting;

/**
 * True when the gate must be shown before a try-on: no consent at all (`CONSENT_REQUIRED`) or an
 * older policy version (`CONSENT_STALE`). Presentation only — the guard chain decides for real.
 */
export const selectConsentGateRequired = (state: ConsentState): boolean =>
  state.status === 'REQUIRED' || state.status === 'STALE';

/** True when the confirm button may be enabled: read to the end, and ticked for *this* version. */
export const selectCanSubmitConsent = (state: ConsentState): boolean =>
  state.hasReadPolicy &&
  state.currentPolicyVersion !== null &&
  state.acknowledgedVersion === state.currentPolicyVersion &&
  !state.isSubmitting;

export const useConsentStatus = (): ConsentStatus | null => useConsentStore(selectConsentStatus);

export const useCurrentPolicyVersion = (): string | null =>
  useConsentStore(selectCurrentPolicyVersion);

export const useIsConsentGateOpen = (): boolean => useConsentStore(selectIsConsentGateOpen);

export const useHasReadPolicy = (): boolean => useConsentStore(selectHasReadPolicy);

export const useIsConsentSubmitting = (): boolean => useConsentStore(selectIsConsentSubmitting);

export const useConsentGateRequired = (): boolean => useConsentStore(selectConsentGateRequired);

export const useCanSubmitConsent = (): boolean => useConsentStore(selectCanSubmitConsent);

export const useConsentActions = (): Pick<
  ConsentState,
  | 'setFromServer'
  | 'openGate'
  | 'closeGate'
  | 'setHasReadPolicy'
  | 'acknowledge'
  | 'submitStart'
  | 'submitSuccess'
  | 'submitFailure'
  | 'reset'
> =>
  useConsentStore(
    useShallow((state) => ({
      setFromServer: state.setFromServer,
      openGate: state.openGate,
      closeGate: state.closeGate,
      setHasReadPolicy: state.setHasReadPolicy,
      acknowledge: state.acknowledge,
      submitStart: state.submitStart,
      submitSuccess: state.submitSuccess,
      submitFailure: state.submitFailure,
      reset: state.reset,
    })),
  );
