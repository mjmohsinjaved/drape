/**
 * Auth presentation state — ARCHITECTURE.md §6.5.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *  THIS STORE IS PRESENTATION STATE. IT IS **NEVER** AN AUTHORISATION DECISION.
 *
 *  PRD S-3 and B-10, and CLAUDE.md: "Authorisation is decided in the API only. Anything
 *  role-shaped in the web app is presentation and must carry a comment saying so."
 *
 *  Not persisted, deliberately. It is hydrated on every load from the server-rendered
 *  `GET /auth/me` result, so there is no window in which a stale identity outlives its session.
 *  There is no token here either — the session is the httpOnly `drape.sid` cookie (B-6).
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *  **There is no role funnel on this store, and there must not be one.** `hasRole()`,
 *  `useHasRole()`, `selectHasRole()` and `useAuthRole()` all shipped here with zero call sites:
 *  every screen that varies by role resolves it server-side from the session — `requireAdmin`,
 *  `requireConsumer` and the `dashboard` / `account` layouts in `apps/web` — and the API
 *  re-reads `users.role` on every request regardless (S-3, B-10). A second, client-side role
 *  mechanism that nobody calls is one somebody eventually calls *instead of* the live one, and
 *  the two answers differ exactly when it matters: after a role change, a suspension, or a
 *  session that ended under an open tab. If a screen needs the role for presentation, take it
 *  from the server-resolved value the layout already has, or read `user.role` off this store
 *  directly at the one place that needs it — do not reintroduce a general predicate.
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { withDevtools } from '../middleware/devtools.middleware';

import type { SessionUser, UserStatus } from '@repo/api-client';


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
}

const initialState = {
  user: null,
  isAuthenticated: false,
  isHydrated: false,
} satisfies Pick<AuthState, 'user' | 'isAuthenticated' | 'isHydrated'>;

export const useAuthStore = create<AuthState>()(
  withDevtools(
    (set) => ({
      ...initialState,

      setUser: (user) =>
        set({ user, isAuthenticated: user !== null, isHydrated: true }, false, 'auth/setUser'),

      clear: () => set({ ...initialState, isHydrated: true }, false, 'auth/clear'),
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

export const useAuthUser = (): SessionUser | null => useAuthStore(selectAuthUser);
export const useAuthUserId = (): string | null => useAuthStore(selectAuthUserId);
export const useIsAuthenticated = (): boolean => useAuthStore(selectIsAuthenticated);
export const useIsAuthHydrated = (): boolean => useAuthStore(selectIsAuthHydrated);
export const useAuthStatus = (): UserStatus | null => useAuthStore(selectAuthStatus);
export const useAuthDisplayName = (): string | null => useAuthStore(selectAuthDisplayName);
export const useIsEmailVerified = (): boolean => useAuthStore(selectIsEmailVerified);
export const useIsPhoneVerified = (): boolean => useAuthStore(selectIsPhoneVerified);
export const useIsSuspended = (): boolean => useAuthStore(selectIsSuspended);

export const useAuthActions = (): Pick<AuthState, 'setUser' | 'clear'> =>
  useAuthStore(useShallow((state) => ({ setUser: state.setUser, clear: state.clear })));
