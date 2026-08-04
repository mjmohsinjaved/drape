/**
 * Auth presentation state — ARCHITECTURE.md §6.5.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *  THIS STORE IS PRESENTATION STATE. IT IS **NEVER** AN AUTHORISATION DECISION.
 *
 *  PRD S-3 and B-10, and CLAUDE.md: "Authorisation is decided in the API only. Anything
 *  role-shaped in the web app is presentation and must carry a comment saying so."
 *
 *  `hasRole()` decides whether to *render* an admin nav item. It never decides whether an action
 *  is permitted — the API re-reads `users.role` on every request and answers `INSUFFICIENT_ROLE`
 *  regardless of what this store believes. A user who edits this state in a console sees a menu
 *  entry and then a 403; that is the design, not a hole in it.
 *
 *  Not persisted, deliberately. It is hydrated on every load from the server-rendered
 *  `GET /auth/me` result, so there is no window in which a stale identity outlives its session.
 *  There is no token here either — the session is the httpOnly `drape.sid` cookie (B-6).
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { withDevtools } from '../middleware/devtools.middleware';

import type { Role, SessionUser, UserStatus } from '@repo/api-client';


export interface AuthState {
  user: SessionUser | null;
  /** True when a session user is present. Presentation only — see the header. */
  isAuthenticated: boolean;
  /** False until the server-rendered `/auth/me` result has been handed to `setUser`. */
  isHydrated: boolean;

  /** Hydrates from the server. Passing `null` marks the visitor as signed out but hydrated. */
  setUser: (user: SessionUser | null) => void;
  /** Called by the api-client's auth-failure handler and by an explicit logout. */
  clear: () => void;
  /** Presentation only. Never gate a mutation on this. */
  hasRole: (role: Role) => boolean;
}

const initialState = {
  user: null,
  isAuthenticated: false,
  isHydrated: false,
} satisfies Pick<AuthState, 'user' | 'isAuthenticated' | 'isHydrated'>;

export const useAuthStore = create<AuthState>()(
  withDevtools(
    (set, get) => ({
      ...initialState,

      setUser: (user) =>
        set({ user, isAuthenticated: user !== null, isHydrated: true }, false, 'auth/setUser'),

      clear: () => set({ ...initialState, isHydrated: true }, false, 'auth/clear'),

      hasRole: (role) => get().user?.role === role,
    }),
    'auth',
  ),
);

/* ------------------------------------------------------------------- selectors */
/*
 * Every read goes through one of these. Subscribing to the whole store is a review failure.
 *
 * Each selector is a named, module-level function and the hook is a thin wrapper. Zustand v5
 * compares selector *results* by reference, so a stable selector keeps the comparison cheap — and
 * a pure function is directly unit-testable without a React renderer.
 */

export const selectAuthUser = (state: AuthState): SessionUser | null => state.user;
export const selectAuthUserId = (state: AuthState): string | null => state.user?.id ?? null;
export const selectIsAuthenticated = (state: AuthState): boolean => state.isAuthenticated;
export const selectIsAuthHydrated = (state: AuthState): boolean => state.isHydrated;
export const selectAuthRole = (state: AuthState): Role | null => state.user?.role ?? null;
export const selectAuthStatus = (state: AuthState): UserStatus | null => state.user?.status ?? null;
export const selectAuthDisplayName = (state: AuthState): string | null => state.user?.name ?? null;

/** True when the C-3 email gate would block a try-on. The API enforces it; this only renders it. */
export const selectIsEmailVerified = (state: AuthState): boolean =>
  state.user !== null && state.user.emailVerifiedAt !== null;

/** C-3 gate for enquiry submission. Presentation only. */
export const selectIsPhoneVerified = (state: AuthState): boolean =>
  state.user !== null && state.user.phoneVerifiedAt !== null;

/** A-19 — she is suspended, so the UI shows the hold banner instead of the generate button. */
export const selectIsSuspended = (state: AuthState): boolean => state.user?.status === 'SUSPENDED';

/** Presentation only (S-3, B-10) — decides what to *show*, never what to allow. */
export const selectHasRole =
  (role: Role) =>
  (state: AuthState): boolean =>
    state.user?.role === role;

export const useAuthUser = (): SessionUser | null => useAuthStore(selectAuthUser);
export const useAuthUserId = (): string | null => useAuthStore(selectAuthUserId);
export const useIsAuthenticated = (): boolean => useAuthStore(selectIsAuthenticated);
export const useIsAuthHydrated = (): boolean => useAuthStore(selectIsAuthHydrated);
export const useAuthRole = (): Role | null => useAuthStore(selectAuthRole);
export const useAuthStatus = (): UserStatus | null => useAuthStore(selectAuthStatus);
export const useAuthDisplayName = (): string | null => useAuthStore(selectAuthDisplayName);
export const useIsEmailVerified = (): boolean => useAuthStore(selectIsEmailVerified);
export const useIsPhoneVerified = (): boolean => useAuthStore(selectIsPhoneVerified);
export const useIsSuspended = (): boolean => useAuthStore(selectIsSuspended);

/** Presentation only (S-3, B-10). */
export const useHasRole = (role: Role): boolean => useAuthStore(selectHasRole(role));

export const useAuthActions = (): Pick<AuthState, 'setUser' | 'clear'> =>
  useAuthStore(useShallow((state) => ({ setUser: state.setUser, clear: state.clear })));
