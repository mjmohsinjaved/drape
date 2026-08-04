import { beforeEach, describe, expect, it } from 'vitest';

import { type ConsentStatus } from '@repo/api-client';

import {
  type ConsentState,
  selectCanSubmitConsent,
  selectConsentGateRequired,
  selectConsentStatus,
  selectCurrentPolicyVersion,
  selectHasReadPolicy,
  selectIsConsentGateOpen,
  selectIsConsentSubmitting,
  useConsentStore,
} from './consent.store';

const V1 = '2026.08.1';
const V2 = '2026.09.1';

function state(): ConsentState {
  return useConsentStore.getState();
}

describe('useConsentStore — actions', () => {
  beforeEach(() => {
    state().reset();
  });

  it('starts with nothing known — the gate stays shut until the server answers', () => {
    expect(state().status).toBeNull();
    expect(state().currentPolicyVersion).toBeNull();
    expect(state().acknowledgedVersion).toBeNull();
    expect(state().isGateOpen).toBe(false);
    expect(state().hasReadPolicy).toBe(false);
  });

  it('hydrates from GET /consents/me', () => {
    state().setFromServer({
      status: 'GRANTED',
      currentPolicyVersion: V1,
      grantedPolicyVersion: V1,
    });

    expect(state().status).toBe('GRANTED');
    expect(state().currentPolicyVersion).toBe(V1);
    expect(state().grantedPolicyVersion).toBe(V1);
  });

  it('opens and closes the C-11 gate', () => {
    state().openGate();
    expect(state().isGateOpen).toBe(true);

    state().closeGate();
    expect(state().isGateOpen).toBe(false);
  });

  it('records that she has read the policy body to the end', () => {
    state().setHasReadPolicy(true);
    expect(state().hasReadPolicy).toBe(true);
  });

  it('acknowledges a specific version, not a bare boolean', () => {
    state().acknowledge(V1);
    expect(state().acknowledgedVersion).toBe(V1);
  });

  // C-12: republishing a policy triggers re-consent for everyone. A tick made against the old
  // version must not carry over, or she would grant consent to text she never saw.
  it('drops the acknowledgement when the policy version changes underneath her', () => {
    state().setFromServer({ status: 'REQUIRED', currentPolicyVersion: V1, grantedPolicyVersion: null });
    state().acknowledge(V1);
    state().setHasReadPolicy(true);

    state().setFromServer({ status: 'STALE', currentPolicyVersion: V2, grantedPolicyVersion: V1 });

    expect(state().acknowledgedVersion).toBeNull();
    expect(state().hasReadPolicy).toBe(false);
  });

  it('keeps the acknowledgement when the server confirms the same version', () => {
    state().setFromServer({ status: 'REQUIRED', currentPolicyVersion: V1, grantedPolicyVersion: null });
    state().acknowledge(V1);
    state().setHasReadPolicy(true);

    state().setFromServer({ status: 'REQUIRED', currentPolicyVersion: V1, grantedPolicyVersion: null });

    expect(state().acknowledgedVersion).toBe(V1);
    expect(state().hasReadPolicy).toBe(true);
  });

  it('submitSuccess grants, closes the gate and clears the submitting flag', () => {
    state().setFromServer({ status: 'REQUIRED', currentPolicyVersion: V1, grantedPolicyVersion: null });
    state().openGate();
    state().acknowledge(V1);
    state().submitStart();
    expect(state().isSubmitting).toBe(true);

    state().submitSuccess(V1);

    expect(state().status).toBe('GRANTED');
    expect(state().grantedPolicyVersion).toBe(V1);
    expect(state().isGateOpen).toBe(false);
    expect(state().isSubmitting).toBe(false);
  });

  it('submitFailure leaves the gate open so she can try again', () => {
    state().setFromServer({ status: 'REQUIRED', currentPolicyVersion: V1, grantedPolicyVersion: null });
    state().openGate();
    state().submitStart();

    state().submitFailure();

    expect(state().isSubmitting).toBe(false);
    expect(state().isGateOpen).toBe(true);
    expect(state().status).toBe('REQUIRED');
  });

  it('never stores the consent record itself — that is the append-only table', () => {
    state().setFromServer({ status: 'GRANTED', currentPolicyVersion: V1, grantedPolicyVersion: V1 });
    const keys = Object.keys(state());

    expect(keys).not.toContain('grantedAt');
    expect(keys).not.toContain('ip');
    expect(keys).not.toContain('userAgent');
  });
});

describe('useConsentStore — selectors', () => {
  beforeEach(() => {
    state().reset();
  });

  it('reads each field', () => {
    state().setFromServer({ status: 'STALE', currentPolicyVersion: V2, grantedPolicyVersion: V1 });
    state().openGate();
    state().setHasReadPolicy(true);
    state().submitStart();

    expect(selectConsentStatus(state())).toBe('STALE');
    expect(selectCurrentPolicyVersion(state())).toBe(V2);
    expect(selectIsConsentGateOpen(state())).toBe(true);
    expect(selectHasReadPolicy(state())).toBe(true);
    expect(selectIsConsentSubmitting(state())).toBe(true);
  });

  const gateCases: Array<[ConsentStatus, boolean]> = [
    ['REQUIRED', true],
    ['STALE', true],
    ['GRANTED', false],
  ];

  it.each(gateCases)('gate required for %s === %s', (status, expected) => {
    state().setFromServer({ status, currentPolicyVersion: V1, grantedPolicyVersion: null });
    expect(selectConsentGateRequired(state())).toBe(expected);
  });

  it('does not require the gate before the server has answered', () => {
    expect(selectConsentGateRequired(state())).toBe(false);
  });

  it('only allows submitting once she has read it and ticked it for this version', () => {
    state().setFromServer({ status: 'REQUIRED', currentPolicyVersion: V1, grantedPolicyVersion: null });
    expect(selectCanSubmitConsent(state())).toBe(false);

    state().setHasReadPolicy(true);
    expect(selectCanSubmitConsent(state())).toBe(false);

    state().acknowledge(V1);
    expect(selectCanSubmitConsent(state())).toBe(true);

    // A tick against the previous version does not unlock the button for the new one.
    state().acknowledge(V2);
    expect(selectCanSubmitConsent(state())).toBe(false);
  });

  it('blocks a second submit while the first is in flight', () => {
    state().setFromServer({ status: 'REQUIRED', currentPolicyVersion: V1, grantedPolicyVersion: null });
    state().setHasReadPolicy(true);
    state().acknowledge(V1);
    state().submitStart();

    expect(selectCanSubmitConsent(state())).toBe(false);
  });
});
