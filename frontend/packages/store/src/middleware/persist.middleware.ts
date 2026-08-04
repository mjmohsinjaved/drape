/**
 * The persist wrapper.
 *
 * **Persistence is opt-in and rare.** Only two stores use it:
 *
 * | Store | Storage | Key | Why |
 * | --- | --- | --- | --- |
 * | `useUiStore` | `localStorage` | `drape.ui` | Chrome preferences should survive a browser restart. |
 * | `useTryOnTrayStore` | `sessionStorage` | `drape.tryon-tray` | The tray survives a reload while she keeps browsing (C-19), but does not follow her to a new tab. |
 *
 * Nothing else persists. In particular **the auth store never does**: it is hydrated from the
 * server on every load, and a stale persisted `user` would be a lie the UI told itself (S-3, B-10).
 *
 * Every persisted store declares an explicit key, a `version` and a `migrate`. A schema change
 * without a version bump silently rehydrates old data into a new shape; the migrate function is
 * what makes that impossible.
 */

import { type PersistOptions, type PersistStorage, createJSONStorage } from 'zustand/middleware';

/** Every storage key this workspace writes. One place, so a collision is visible. */
export const PERSIST_KEYS = {
  ui: 'drape.ui',
  tryOnTray: 'drape.tryon-tray',
} as const;

export type PersistKey = (typeof PERSIST_KEYS)[keyof typeof PERSIST_KEYS];

/**
 * `localStorage`, or `undefined` during SSR and in a Node test. Zustand skips hydration when the
 * storage is undefined, which is exactly the behaviour a server render needs.
 */
export function localJsonStorage<T>(): PersistStorage<T> | undefined {
  if (typeof window === 'undefined') return undefined;
  return createJSONStorage<T>(() => window.localStorage);
}

/** `sessionStorage`, same rules. */
export function sessionJsonStorage<T>(): PersistStorage<T> | undefined {
  if (typeof window === 'undefined') return undefined;
  return createJSONStorage<T>(() => window.sessionStorage);
}

export interface DrapePersistOptions<TState, TPersisted> {
  name: PersistKey;
  version: number;
  /** Which slice of the store actually lands in storage. Transient fields must be excluded. */
  partialize: (state: TState) => TPersisted;
  /**
   * Upgrades a payload written by an older `version`. Returning the defaults is a legitimate
   * migration — losing a sidebar preference is cheaper than shipping a crash.
   */
  migrate: (persisted: unknown, fromVersion: number) => TPersisted;
  /**
   * Required, not defaulted: `localStorage` and `sessionStorage` mean different things here, and a
   * silent fallback would put the try-on tray in the wrong one. `undefined` (SSR / a Node test) is
   * a legitimate value — zustand simply skips hydration.
   */
  storage: PersistStorage<TPersisted> | undefined;
}

/**
 * Builds the `persist` options object. Options rather than a middleware wrapper, because a store
 * that is both persisted and instrumented composes as `devtools(persist(fn, …), …)` and wrapping
 * both would fight the mutator types for no benefit.
 */
export function createPersistOptions<TState, TPersisted>({
  name,
  version,
  partialize,
  migrate,
  storage,
}: DrapePersistOptions<TState, TPersisted>): PersistOptions<TState, TPersisted> {
  return { name, version, storage, partialize, migrate };
}
