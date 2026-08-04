import { beforeEach, describe, expect, it } from 'vitest';

import { type SessionUser } from '@repo/api-client';

import {
  type AuthState,
  selectAuthDisplayName,
  selectAuthRole,
  selectAuthStatus,
  selectAuthUserId,
  selectHasRole,
  selectIsAuthHydrated,
  selectIsAuthenticated,
  selectIsEmailVerified,
  selectIsPhoneVerified,
  selectIsSuspended,
  useAuthStore,
} from './auth.store';

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
  twofaEnabledAt: null,
  twofaPending: false,
  createdAt: '2026-07-01T00:00:00.000Z',
};

const ADMIN: SessionUser = {
  ...CONSUMER,
  id: 'user-2',
  role: 'ADMIN',
  email: 'admin@example.com',
  name: 'Studio Admin',
  twofaEnabledAt: '2026-07-02T00:00:00.000Z',
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

  it('hasRole compares the session role — presentation only (S-3, B-10)', () => {
    state().setUser(ADMIN);
    expect(state().hasRole('ADMIN')).toBe(true);
    expect(state().hasRole('CONSUMER')).toBe(false);

    state().clear();
    expect(state().hasRole('ADMIN')).toBe(false);
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
    expect(selectAuthRole(signedIn)).toBe('CONSUMER');
    expect(selectAuthRole(signedOut)).toBeNull();
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

  it('selectHasRole builds a stable selector per role', () => {
    const isAdmin = selectHasRole('ADMIN');

    expect(isAdmin({ ...signedIn, user: ADMIN })).toBe(true);
    expect(isAdmin(signedIn)).toBe(false);
    expect(isAdmin(signedOut)).toBe(false);
  });
});
