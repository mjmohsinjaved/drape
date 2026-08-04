/**
 * The devtools wrapper.
 *
 * Redux DevTools is a development affordance, so it is **enabled only outside production**. Rather
 * than conditionally composing the middleware — which changes the store's mutator type and makes
 * every store declaration branch — the middleware is always applied and its own `enabled` flag is
 * gated. When disabled it is a pass-through with no listener and no serialisation cost.
 */

import { type StateCreator } from 'zustand';
import { type DevtoolsOptions, devtools } from 'zustand/middleware';

/** Namespace so all five Drape stores group together in the DevTools store picker. */
export const DEVTOOLS_NAMESPACE = 'drape';

export function isDevtoolsEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function devtoolsOptions(name: string): DevtoolsOptions {
  return {
    name: `${DEVTOOLS_NAMESPACE}/${name}`,
    store: name,
    enabled: isDevtoolsEnabled(),
  };
}

/**
 * Wraps a store initializer in devtools with the shared options.
 *
 * Every `set` call in a wrapped store should pass an action name as its third argument
 * (`set(patch, false, 'auth/setUser')`) — without it the DevTools timeline is a wall of
 * `anonymous` entries and the middleware earns nothing.
 */
export function withDevtools<T>(
  initializer: StateCreator<T, [['zustand/devtools', never]], []>,
  name: string,
): StateCreator<T, [], [['zustand/devtools', never]]> {
  return devtools(initializer, devtoolsOptions(name));
}
