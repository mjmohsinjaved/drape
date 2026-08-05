'use client';

import { useEffect } from 'react';

import { setAuthFailureHandler, type SessionUser } from '@repo/api-client';
import { useAuthStore } from '@repo/store';

export interface SessionSyncProps {
  /**
   * The server-resolved `/auth/me` result the route-group layout already holds.
   *
   * **Presentation only.** It is a mirror of a decision the server already made, and nothing in
   * the app is allowed to authorise anything from it: every protected segment re-verifies
   * server-side and every operation is independently authorised by the API (S-3, B-10).
   */
  user: SessionUser | null;
}

/**
 * The bridge between the server-resolved session and the client store — ARCHITECTURE §6.5.
 *
 * Two wires were missing, and each made the other one pointless:
 *
 * 1. **`useAuthStore.setUser` had no caller**, so `isHydrated` stayed false and
 *    `useIsAuthenticated()` reported "signed out" for a signed-in visitor. Nothing depended on
 *    it yet, which is the only reason it was invisible — the first component that trusted it
 *    would have been wrong for every signed-in reader.
 * 2. **`setAuthFailureHandler` was never registered.** The response interceptor documents
 *    exactly this call ("the web app wires this to `useAuthStore.getState().clear()`"), and it
 *    is the only path by which a 401 mid-session can drop the client's copy of the identity. Its
 *    absence meant a session that ended under an open tab left a stale user on screen until the
 *    next full navigation.
 *
 * It renders nothing and is mounted by each route-group layout, which already resolves the user
 * for its shell — so it costs no extra request.
 */
export function SessionSync({ user }: SessionSyncProps) {
  useEffect(() => {
    // Store access outside React, deliberately: the interceptor is module-level and must not
    // capture a render's closure.
    setAuthFailureHandler(() => {
      useAuthStore.getState().clear();
    });
    return () => {
      setAuthFailureHandler(null);
    };
  }, []);

  useEffect(() => {
    // `user` is a fresh object per server render, so this re-syncs on navigation — which is what
    // a session that changed under her should do.
    useAuthStore.getState().setUser(user);
  }, [user]);

  return null;
}
