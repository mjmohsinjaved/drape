import { beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthState,
  selectAuthDisplayName,
  selectAuthStatus,
  selectAuthUser,
  selectAuthUserId,
  selectIsAuthHydrated,
  selectIsAuthenticated,
  selectIsEmailVerified,
  selectIsPhoneVerified,
  selectIsSuspended,
  useAuthStore,
} from './auth.store';

import type { SessionUser } from '@repo/api-client';


const CONSUMER: SessionUser = {
  id: 'user-1',
  role: 'CONSUMER',
  email: 'ayesha@example.com',
  name: 'Ayesha',
  phone: '+923001234567',
  status: 'ACTIVE',
  locale: 'EN',
  emailVerifiedAt: '2026-08-01T00:00:00.000Z',
  phoneVerifiedAt: '2026-08-01T00:00:00.000Z',
  twofaEnabled: false,
};

const ADMIN: SessionUser = {
  ...CONSUMER,
  id: 'user-2',
  role: 'ADMIN',
  email: 'admin@example.com',
  name: 'Studio Admin',
  twofaEnabled: true,
};

function state(): AuthState {
  return useAuthStore.getState();
}

describe('useAuthStore — actions', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isHydrated: false }, false);
  });

  it('starts unauthenticated and unhydrated', () => {
    expect(state().user).toBeNull();
    expect(state().isAuthenticated).toBe(false);
    expect(state().isHydrated).toBe(false);
  });

  it('setUser hydrates from the server-rendered /auth/me result', () => {
    state().setUser(CONSUMER);

    expect(state().user).toEqual(CONSUMER);
    expect(state().isAuthenticated).toBe(true);
    expect(state().isHydrated).toBe(true);
  });

  it('setUser(null) marks the visitor signed out but hydrated', () => {
    state().setUser(CONSUMER);
    state().setUser(null);

    expect(state().user).toBeNull();
    expect(state().isAuthenticated).toBe(false);
    // Hydrated, so a guard renders "signed out" rather than a spinner forever.
    expect(state().isHydrated).toBe(true);
  });

  it('clear wipes the identity and keeps the hydrated flag', () => {
    state().setUser(ADMIN);
    state().clear();

    expect(state().user).toBeNull();
    expect(state().isAuthenticated).toBe(false);
    expect(state().isHydrated).toBe(true);
  });

  // S-3 / B-10: the role funnel that used to live here (`hasRole`, `useHasRole`,
  // `selectHasRole`, `useAuthRole`) had no call sites and has been removed. Role is resolved
  // server-side; a second client-side mechanism is one somebody uses instead of the live one.
  it('exposes no role predicate — the API and the server layouts decide (S-3, B-10)', () => {
    state().setUser(ADMIN);

    expect(state()).not.toHaveProperty('hasRole');
    expect(state().user?.role).toBe('ADMIN');
  });

  it('never stores a token — the session is the httpOnly cookie (B-6)', () => {
    state().setUser(CONSUMER);
    const keys = Object.keys(state());

    expect(keys).not.toContain('accessToken');
    expect(keys).not.toContain('token');
    expect(keys).not.toContain('refreshToken');
    expect(JSON.stringify(state().user)).not.toMatch(/token/i);
  });
});

describe('useAuthStore — selectors', () => {
  const signedIn: AuthState = { ...state(), user: CONSUMER, isAuthenticated: true, isHydrated: true };
  const signedOut: AuthState = { ...state(), user: null, isAuthenticated: false, isHydrated: true };

  it('reads identity fields, falling back to null when signed out', () => {
    expect(selectAuthUserId(signedIn)).toBe('user-1');
    expect(selectAuthUserId(signedOut)).toBeNull();
    expect(selectAuthDisplayName(signedIn)).toBe('Ayesha');
    expect(selectAuthDisplayName(signedOut)).toBeNull();
    expect(selectAuthStatus(signedIn)).toBe('ACTIVE');
    expect(selectAuthStatus(signedOut)).toBeNull();
    expect(selectIsAuthenticated(signedIn)).toBe(true);
    expect(selectIsAuthHydrated(signedOut)).toBe(true);
  });

  it('reports the C-3 verification gates', () => {
    expect(selectIsEmailVerified(signedIn)).toBe(true);
    expect(selectIsPhoneVerified(signedIn)).toBe(true);

    const unverified: AuthState = {
      ...signedIn,
      user: { ...CONSUMER, emailVerifiedAt: null, phoneVerifiedAt: null },
    };
    expect(selectIsEmailVerified(unverified)).toBe(false);
    expect(selectIsPhoneVerified(unverified)).toBe(false);

    // Signed out is never "verified", even though `undefined !== null`.
    expect(selectIsEmailVerified(signedOut)).toBe(false);
    expect(selectIsPhoneVerified(signedOut)).toBe(false);
  });

  it('reports A-19 suspension', () => {
    expect(selectIsSuspended(signedIn)).toBe(false);
    expect(selectIsSuspended({ ...signedIn, user: { ...CONSUMER, status: 'SUSPENDED' } })).toBe(true);
  });

  it('ships no role selector for a screen to gate on', () => {
    // The whole point of removing the funnel: there is nothing here to reach for. A screen that
    // needs the role for presentation reads `user.role` at the one place that needs it.
    expect(selectAuthUser({ ...signedIn, user: ADMIN })?.role).toBe('ADMIN');
    expect(selectAuthUser(signedOut)).toBeNull();
  });
});
